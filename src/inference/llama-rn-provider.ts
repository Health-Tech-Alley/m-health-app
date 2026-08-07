import type {
  ChatResult,
  ChatMessage,
  GenerateOptions,
  InferenceProvider,
  LoadOptions,
  ModelInfo,
} from './inference-provider';
import { effectiveNPredict } from './n-predict';
import { MissingNativeModuleError } from './missing-native-module-error';
import { File } from 'expo-file-system';
import { getModelEntry } from './model-catalog';
import { mapMessagesForModel } from './message-mapping';
import { noThinkChatTemplateForFamily } from './no-think-templates';

/**
 * Remove inline thinking blocks from a raw completion string.
 *
 * Handles `<think>…</think>` and gpt-oss harmony `<|channel|>analysis…` up to
 * the `<|channel|>final`/`<|message|>` transition. Also drops a dangling,
 * unclosed `<think>…` tail (a generation cut off mid-thought), so partial
 * thinking never leaks into the answer.
 */
function stripThinkMarkers(text: string): string {
  if (!text) return '';
  let out = text;
  // Closed <think>…</think> blocks.
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Harmony analysis channel up to the final/answer channel or a message tag.
  out = out.replace(
    /<\|channel\|?>\s*(?:analysis|thinking|thought)[\s\S]*?(?=<\|channel\|?>\s*(?:final|answer)|<\|message\|?>|$)/gi,
    '',
  );
  // Dangling, unclosed thinking tail (cut off mid-thought).
  out = out.replace(/<think>[\s\S]*$/i, '');
  // Any stray channel/control tokens left behind.
  out = out.replace(/<\|[^>]*\|?>/g, '');
  return out;
}

export class LlamaRnProvider implements InferenceProvider {
  private context: any = null;
  private modelInfo: ModelInfo | null = null;
  /** Single-flight lock — concurrent initLlama races crash native llama.rn. */
  private loadInflight: Promise<void> | null = null;
  private loadedPath: string | null = null;
  /**
   * Concierge reasoning mode ('auto' default).
   * 'off' forces direct answers: Gemma disables thinking via reasoning_format,
   * and template-native families (lfm2 / qwen3) get a no-think chat template
   * override so their GGUF's forced <think> injection is skipped.
   * Set by slm-context from app_settings (conciergeReasoning).
   */
  private reasoningMode: 'auto' | 'off' = 'auto';
  /** Catalog id of the loaded model (set via LoadOptions.modelId). */
  private loadedModelId: string | null = null;
  /** n_ctx of the successfully loaded context (prompt budgeting). */
  private loadedNCtx: number | null = null;
  /** True while a completion is streaming — release() stops it first. */
  private activeCompletion = false;

  /** Catalog id of the loaded model, when the load passed one. */
  getLoadedModelId(): string | null {
    return this.loadedModelId;
  }

  async loadModel(path: string, options?: LoadOptions): Promise<void> {
    const cleanPath = path.replace(/^file:\/\//, '');

    // Already loaded this file — no-op (callers often race acquire + ensureReady).
    if (this.context && this.loadedPath === cleanPath) {
      // Keep catalog id in sync when a prior load omitted modelId.
      if (options?.modelId) this.loadedModelId = options.modelId;
      console.log('[LlamaRnProvider] Model already loaded; skipping re-init');
      return;
    }

    // Join in-flight load instead of starting a second native init.
    if (this.loadInflight) {
      console.log('[LlamaRnProvider] Load already in progress; awaiting single-flight');
      await this.loadInflight;
      if (this.context && this.loadedPath === cleanPath) {
        if (options?.modelId) this.loadedModelId = options.modelId;
        return;
      }
      // Previous attempt failed or loaded a different path — fall through once.
    }

    const work = this.loadModelExclusive(cleanPath, options);
    this.loadInflight = work.finally(() => {
      if (this.loadInflight === work) this.loadInflight = null;
    });
    await this.loadInflight;
  }

  /** Free the native context without awaiting loadInflight (avoids self-deadlock). */
  private async freeContext(): Promise<void> {
    if (!this.context) {
      this.modelInfo = null;
      this.loadedPath = null;
      this.loadedModelId = null;
      this.loadedNCtx = null;
      return;
    }
    // Abort any in-flight completion BEFORE releasing the native context —
    // killing llama.rn mid-stream can abort the whole process (Metro reload).
    if (this.activeCompletion) {
      try {
        this.context.stopCompletion?.();
      } catch (err) {
        console.warn('[LlamaRnProvider] stopCompletion failed:', err);
      }
      this.activeCompletion = false;
    }
    try {
      await this.context.release();
    } catch (err) {
      console.warn('[LlamaRnProvider] context.release failed:', err);
    }
    this.context = null;
    this.modelInfo = null;
    this.loadedPath = null;
    this.loadedModelId = null;
    this.loadedNCtx = null;
  }

  private async loadModelExclusive(cleanPath: string, options?: LoadOptions): Promise<void> {
    let llamaRn: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      llamaRn = require('llama.rn');
    } catch {
      throw new MissingNativeModuleError(
        'This screen requires a dev build (expo-dev-client) — llama.rn is not available in Expo Go.',
      );
    }

    // Release any prior context before a new mmap (never two contexts at once).
    // Must NOT call release() here — release() awaits loadInflight, and we ARE
    // the in-flight load (self-deadlock → chat hangs, then Metro reloads).
    if (this.context) {
      console.log('[LlamaRnProvider] Freeing prior context before loading a different model');
      await this.freeContext();
    }

    // resolveModelPath often returns a file:// URI; File accepts that form.
    const pathForFs = cleanPath.startsWith('/') ? `file://${cleanPath}` : cleanPath;
    console.log('[LlamaRnProvider] Loading model from:', pathForFs);

    const file = new File(pathForFs);
    if (!file.exists) {
      throw new Error(`Model file not found at: ${pathForFs}`);
    }

    const fileSize = file.size;
    console.log('[LlamaRnProvider] Model file size:', (fileSize / 1_073_741_824).toFixed(2), 'GB');

    if (fileSize < 100_000_000) {
      throw new Error(
        `Model file appears corrupted (${(fileSize / 1_048_576).toFixed(1)} MB). ` +
        'Expected at least 100 MB. Try re-downloading the model.',
      );
    }

    // Surface the full error object from llama.rn — the JS bridge often
    // masks the native NSError as a generic "Failed to load model" string.
    const describeLlamaErr = (err: any): string => {
      if (!err) return 'unknown';
      const parts: string[] = [err.message || err.toString() || 'no message'];
      if (err.code !== undefined) parts.push(`code=${err.code}`);
      if (err.userInfo) parts.push(`userInfo=${JSON.stringify(err.userInfo)}`);
      if (err.nativeStack) parts.push(`nativeStack=${err.nativeStack}`);
      return parts.join(' | ');
    };

    // Preferred context from the catalog profile. Both models prefer 8K
    // (longer conversations); the SLM context RAM-gates it down to 4K on
    // low-RAM devices. Fall back down the ladder on load failure.
    //
    // GPU policy: `options.nGpuLayers` comes from the catalog.
    // - Gemma: -1 (Metal) with CPU fallback on the last rung.
    // - Bonsai 8B (1-bit Q1_0): -1 — Q1_0 has Metal kernels in llama.rn 0.12.x.
    // - LFM2.5 (lfm2, Q4_K_M): -1 — standard Metal kernels (vendored lfm2.cpp
    //   + hybrid memory); CPU fallback rung applies.
    // - A future CPU-only quant (e.g. TQ2_0 ternary, which has no Metal
    //   kernels and hard-crashes under Metal offload) must set nGpuLayers: 0.
    const preferredCtx = options?.nCtx ?? 4096;
    const preferredGpu = options?.nGpuLayers ?? -1;
    const forceCpu = preferredGpu === 0;
    const capCtx = (n: number) => Math.max(2048, Math.min(n, 8192));
    const ctxAttempts = [capCtx(preferredCtx), 4096, 3072, 2048];
    const attempts: { nCtx: number; gpuLayers: number; label: string }[] = [];
    const pushAttempt = (nCtx: number, gpuLayers: number) => {
      if (attempts.some((a) => a.nCtx === nCtx && a.gpuLayers === gpuLayers)) return;
      const gpuLabel = gpuLayers === 0 ? 'gpu=0 (CPU-only)' : `gpu=${gpuLayers}`;
      attempts.push({ nCtx, gpuLayers, label: `n_ctx=${nCtx} ${gpuLabel}` });
    };
    for (const n of ctxAttempts) {
      pushAttempt(n, forceCpu ? 0 : preferredGpu);
    }
    // Metal models: final CPU-only safety rung after GPU attempts fail.
    if (!forceCpu) {
      pushAttempt(2048, 0);
    }

    console.log(
      `[LlamaRnProvider] Load plan modelId=${options?.modelId ?? 'unknown'} ` +
        `forceCpu=${forceCpu} attempts=${attempts.map((a) => a.label).join(' → ')}`,
    );

    let lastErr: any = null;
    let usedNCtx = preferredCtx;
    for (const a of attempts) {
      try {
        console.log(`[LlamaRnProvider] Attempting initLlama (${a.label})`);
        this.context = await llamaRn.initLlama({
          model: cleanPath,
          n_ctx: a.nCtx,
          n_gpu_layers: a.gpuLayers,
          // Speed: flash attention (prefill) + q8_0 KV cache (decode + RAM).
          // 'auto' enables FA where the backend supports it (Metal) and falls
          // back silently otherwise; q8_0 KV is supported on all backends.
          flash_attn_type: 'auto',
          cache_type_k: 'q8_0',
          cache_type_v: 'q8_0',
          // Batch sizing: 1024/512 is the llama.rn-recommended prefill
          // throughput point; larger batches speed up long RAG prompts.
          n_batch: 1024,
          n_ubatch: 512,
        });
        console.log(`[LlamaRnProvider] Model loaded successfully with ${a.label}`);
        lastErr = null;
        this.loadedPath = cleanPath;
        this.loadedModelId = options?.modelId ?? null;
        usedNCtx = a.nCtx;
        this.loadedNCtx = a.nCtx;
        break;
      } catch (err: any) {
        lastErr = err;
        this.context = null;
        this.loadedNCtx = null;
        this.loadedModelId = null;
        const detail = describeLlamaErr(err);
        console.warn(`[LlamaRnProvider] ${a.label} failed: ${detail}`);
        if (err?.stack) console.warn(`[LlamaRnProvider] stack: ${err.stack}`);
      }
    }

    if (lastErr || !this.context) {
      this.loadedPath = null;
      this.loadedNCtx = null;
      this.loadedModelId = null;
      const detail = describeLlamaErr(lastErr);
      console.error('[LlamaRnProvider] All load attempts failed. Last error:', detail);
      const hint = forceCpu
        ? ' This model runs on CPU (no Metal offload). Free device RAM, close other apps, unload any other Concierge model, and retry.'
        : fileSize > 2_000_000_000
          ? ' The model is large (~2.9 GB). Free device RAM, close other apps, unload Concierge, and retry. Avoid opening Explain while chat is also loading the model.'
          : '';
      throw new Error(`Failed to load model: ${detail}.${hint}`);
    }

    this.modelInfo = {
      sizeBytes: this.context.model?.size ?? fileSize,
      description: this.context.model?.desc ?? 'Unknown model',
      nCtx: usedNCtx,
    };
  }

  async release(): Promise<void> {
    // Wait for any in-flight load so we do not release mid-init (native crash).
    // Only wait when we are NOT that in-flight load (exclusive uses freeContext).
    if (this.loadInflight) {
      try {
        await this.loadInflight;
      } catch {
        // ignore load failure; still clear state below
      }
    }
    await this.freeContext();
  }

  getModelInfo(): ModelInfo | null {
    return this.modelInfo;
  }

  /** Set the Concierge reasoning mode ('auto' | 'off'). See class docs. */
  setReasoningMode(mode: 'auto' | 'off'): void {
    this.reasoningMode = mode;
  }

  /** Context window size of the loaded model (tokens). */
  getContextSize(): number {
    return this.loadedNCtx ?? this.modelInfo?.nCtx ?? 4096;
  }

  async chat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    signal: AbortSignal,
    options?: GenerateOptions,
    onReasoningToken?: (token: string) => void,
  ): Promise<ChatResult> {
    if (!this.context) {
      throw new Error('Model not loaded');
    }

    const t0 = Date.now();
    let tokensGenerated = 0;

    // Cap n_predict so generation cannot overflow remaining context.
    // Unlimited (-1) explain was filling the whole window after a large prompt.
    const nCtx = this.getContextSize();
    const approxPromptTokens = Math.ceil(
      messages.reduce((n, m) => n + (m.content?.length ?? 0), 0) / 4,
    );
    const remaining = Math.max(128, nCtx - approxPromptTokens - 32);
    let nPredict = effectiveNPredict(options);
    if (nPredict < 0 || nPredict > remaining) {
      nPredict = remaining;
      console.log(
        `[LlamaRnProvider] n_predict capped to ${nPredict} (n_ctx=${nCtx}, prompt~${approxPromptTokens})`,
      );
    }
    if (approxPromptTokens + 64 >= nCtx) {
      throw new Error(
        `Context is full (prompt ~${approxPromptTokens} tokens, model n_ctx=${nCtx}). ` +
          'The explanation prompt was too large for the loaded context window. Try again after unloading Concierge, or free memory so a larger n_ctx can load.',
      );
    }

    // Streaming reasoning/answer splitter.
    //
    // Two ways a model surfaces its <think> content while streaming:
    //   (a) llama.rn populates `data.reasoning_content` per token — clean, we
    //       just forward it to onReasoningToken.
    //   (b) llama.rn does NOT split it and the thinking arrives inline in
    //       `data.token` wrapped in markers (`<think>…</think>`, or gpt-oss
    //       harmony `<|channel|>analysis…<|channel|>final…`). This is what
    //       Gemma 4 E2B does in practice, and why the indicator never showed:
    //       the first <think> token hit onToken → the UI thought the answer
    //       had started and hid the ellipsis/progress bar.
    //
    // We handle (b) with a tiny state machine: while inside a thinking block
    // route tokens to onReasoningToken; once the closing marker is seen route
    // the rest to onToken. Markers can straddle token boundaries, so we keep a
    // small carry buffer and only emit text we know is past any partial marker.
    let insideThink = false;
    let carry = '';
    // Longest marker tail we might need to hold back to detect a split marker.
    const MAX_MARKER = 24;
    const OPEN_MARKERS = [/<think>/i, /<\|channel\|?>\s*(analysis|thinking|thought)/i];
    const CLOSE_MARKERS = [/<\/think>/i, /<\|channel\|?>\s*(final|answer)/i, /<\|message\|?>/i];

    const firstMatch = (text: string, patterns: RegExp[]): { index: number; length: number } | null => {
      let best: { index: number; length: number } | null = null;
      for (const p of patterns) {
        const m = p.exec(text);
        if (m && (best === null || m.index < best.index)) {
          best = { index: m.index, length: m[0].length };
        }
      }
      return best;
    };

    const routeAnswer = (text: string) => {
      if (!text) return;
      tokensGenerated++;
      onToken(text);
    };

    // Process the carry buffer, peeling off answer/thinking segments as markers
    // are found. `flush` (end of stream) emits any remaining held-back text.
    const drain = (flush: boolean) => {
      // Keep processing while we can find a definitive marker transition.
      // Loop because a single chunk can contain open+close (e.g. a whole
      // short <think>…</think> in one token).
      while (true) {
        if (insideThink) {
          const close = firstMatch(carry, CLOSE_MARKERS);
          if (close) {
            const think = carry.slice(0, close.index);
            if (think) onReasoningToken?.(think);
            carry = carry.slice(close.index + close.length);
            insideThink = false;
            continue;
          }
          // No close yet. Emit thinking up to the safe tail (keep MAX_MARKER
          // back in case the close marker is split across chunks).
          if (!flush && carry.length > MAX_MARKER) {
            const safe = carry.slice(0, carry.length - MAX_MARKER);
            if (safe) onReasoningToken?.(safe);
            carry = carry.slice(carry.length - MAX_MARKER);
          } else if (flush) {
            if (carry) onReasoningToken?.(carry);
            carry = '';
          }
          break;
        } else {
          const open = firstMatch(carry, OPEN_MARKERS);
          if (open) {
            const answer = carry.slice(0, open.index);
            if (answer) routeAnswer(answer);
            carry = carry.slice(open.index + open.length);
            insideThink = true;
            continue;
          }
          if (!flush && carry.length > MAX_MARKER) {
            const safe = carry.slice(0, carry.length - MAX_MARKER);
            routeAnswer(safe);
            carry = carry.slice(carry.length - MAX_MARKER);
          } else if (flush) {
            routeAnswer(carry);
            carry = '';
          }
          break;
        }
      }
    };

    return new Promise<ChatResult>((resolve, reject) => {
      const abortHandler = () => {
        this.context.stopCompletion();
        reject(new DOMException('Aborted', 'AbortError'));
      };

      signal.addEventListener('abort', abortHandler);

      const reasoningOff = this.reasoningMode === 'off';
      // 'off': force reasoning off for every model. In 'auto' the per-turn
      // reasoningFormat comes from the NLU-decided profile (FAST → 'none',
      // DEEP → 'auto').
      const reasoningFormat = reasoningOff ? 'none' : options?.reasoningFormat ?? 'none';
      const enableThinking = reasoningFormat === 'auto';
      // Family-aware message mapping: Gemma 4 gets a <|think|> prefix on the
      // system turn when thinking; Qwen3-family (Bonsai) gets a direct-answer
      // nudge when thinking is off (its template forces <think> anyway).
      const entry = getModelEntry(this.loadedModelId);
      const mappedMessages = mapMessagesForModel(messages, entry, enableThinking);
      // Template-native families (lfm2 / qwen3) get the no-think chat template
      // whenever THIS turn runs without reasoning — either the global 'off'
      // override or an NLU-decided FAST turn. Gemma honors 'none' natively.
      const chatTemplate =
        reasoningFormat === 'none'
          ? noThinkChatTemplateForFamily(entry?.family)
          : undefined;

      // Family-aware sampling defaults. When the caller leaves sampling at
      // the shared Gemma defaults (1.0 / 0.95 / 64) while a non-Gemma model
      // is loaded, apply that model's catalog sampling (e.g. Bonsai 8B
      // 0.7 / 0.95 / 20). Explicit non-default values always win.
      const gemmaSampling = { temperature: 1.0, topP: 0.95, topK: 64 };
      const callerSampling = {
        temperature: options?.temperature ?? gemmaSampling.temperature,
        topP: options?.topP ?? gemmaSampling.topP,
        topK: options?.topK ?? gemmaSampling.topK,
      };
      const atGemmaDefaults =
        callerSampling.temperature === gemmaSampling.temperature &&
        callerSampling.topP === gemmaSampling.topP &&
        callerSampling.topK === gemmaSampling.topK;
      const sampling =
        atGemmaDefaults && entry && entry.family !== 'gemma4'
          ? {
              temperature: entry.sampling.temperature,
              topP: entry.sampling.topP,
              topK: entry.sampling.topK,
            }
          : callerSampling;

      this.activeCompletion = true;
      this.context
        .completion(
          {
            messages: mappedMessages,
            n_predict: nPredict,
            temperature: sampling.temperature,
            top_p: sampling.topP,
            top_k: sampling.topK,
            jinja: true,
            enable_thinking: enableThinking,
            reasoning_format: reasoningFormat,
            ...(chatTemplate ? { chat_template: chatTemplate } : {}),
          },
          (data: any) => {
            // Case (a): llama.rn already separated the reasoning channel.
            if (data && typeof data.reasoning_content === 'string' && data.reasoning_content.length > 0) {
              onReasoningToken?.(data.reasoning_content);
              return;
            }
            // Case (b): inline text — run it through the marker splitter so
            // <think> content goes to onReasoningToken and the answer goes to
            // onToken. This is what drives the ellipsis/progress-bar phase.
            if (typeof data.token === 'string' && data.token.length > 0) {
              carry += data.token;
              drain(false);
            }
          },
        )
        .then((result: any) => {
          this.activeCompletion = false;
          signal.removeEventListener('abort', abortHandler);
          // Flush any text still held in the marker carry buffer so the last
          // answer/thinking fragment is delivered to the callbacks.
          drain(true);

          // llama.rn parses the model's structured output (e.g. Gemma/gpt-oss
          // harmony channels) into `content` (the answer) and
          // `reasoning_content` (the thinking).
          const structuredAnswer: string = (result?.content ?? '').trim();
          const reasoning: string = (result?.reasoning_content ?? '').trim();

          // Final answer resolution. Prefer llama.rn's parsed `content`. If it
          // didn't split the channels, `result.text` holds the raw stream that
          // may still contain <think>…</think> markers — strip them here so the
          // returned answer never leaks the thought process.
          //
          // Important: when structured content is empty but we streamed answer
          // tokens via onToken (tokensGenerated > 0 and not only reasoning), do
          // not return empty — callers that overwrite UI with result.text would
          // blank a visible stream. Prefer stripped raw text in that case.
          const rawText: string = (result?.text ?? '');
          const strippedRaw = stripThinkMarkers(rawText).trim();
          const sawReasoning = reasoning.length > 0 || insideThink || /<think>/i.test(rawText);
          let answer: string =
            structuredAnswer || strippedRaw || (sawReasoning ? '' : rawText.trim());
          if (!answer && strippedRaw) {
            answer = strippedRaw;
          }
          if (!answer && rawText.trim() && !sawReasoning) {
            answer = rawText.trim();
          }

          resolve({
            text: answer,
            tokensGenerated,
            latencyMs: Date.now() - t0,
            reasoningContent: reasoning || undefined,
          });
        })
        .catch((err: any) => {
          this.activeCompletion = false;
          signal.removeEventListener('abort', abortHandler);
          if (err.name === 'AbortError' || signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
          } else {
            reject(err);
          }
        });
    });
  }
}
