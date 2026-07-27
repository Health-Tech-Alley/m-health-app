/**
 * Embedder interface and implementations.
 *
 * Track A uses a deterministic hash-based mock embedder so RAG can be tested
 * end-to-end in Expo Go with zero native dependencies. Track B uses the
 * mdbr-leaf-ir TFLite model (768-d, weight-only INT8) via react-native-fast-tflite.
 *
 * planning/35 §4.
 */

import { Platform } from 'react-native';
import type { Embedder } from './types';

/** Query prefix required by leaf-ir for user/query strings only. */
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

/** Max sequence length for the leaf-ir model. */
const MAX_SEQ_LENGTH = 512;

/**
 * Default wait for first TFLite leaf-ir load (~59 MB INT8). 400ms was far too
 * short and caused every chat turn to hit "TFLite embedder load timeout".
 */
export const DEFAULT_TFLITE_EMBEDDER_LOAD_MS = 20_000;

/**
 * Lazy require so Jest does not parse binary .tflite at import time.
 * Paths match intent-head.json (src/nlu → ../../assets/...).
 * Metro needs a static string literal inside require().
 */
function leafIrInt8Asset(): number {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../assets/models/nlu/mdbr-leaf-ir-int8.tflite') as number;
}

function leafIrFp32Asset(): number {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../assets/models/nlu/mdbr-leaf-ir.tflite') as number;
}

type DelegateList = readonly string[];

/**
 * Leaf-ir is a full encoder-style graph. CoreML/Metal delegates often fail
 * createModel on device (unlike the tiny Alert autoencoder). Prefer CPU first.
 */
function leafIrDelegateAttempts(): DelegateList[] {
  const attempts: DelegateList[] = [[]]; // CPU always first
  if (Platform.OS === 'ios') {
    attempts.push(['core-ml']);
    attempts.push(['metal']);
  } else if (Platform.OS === 'android') {
    attempts.push(['nnapi']);
    attempts.push(['android-gpu']);
  }
  return attempts;
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Deterministic hash-based mock embedder (Track A).
 *
 * Not semantically meaningful, but stable and fast. It tokenizes on whitespace,
 * hashes each token into the vector dimensions, and averages. This lets the
 * fused retriever return deterministic results for testing and UI development.
 */
export class HashMockEmbedder implements Embedder {
  readonly dimensions = 128;

  async embed(text: string, _opts?: { isQuery?: boolean }): Promise<number[]> {
    // Hash mock ignores isQuery; signature matches Embedder / leaf-ir path.
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
    const vec = new Array(this.dimensions).fill(0);
    if (tokens.length === 0) return vec;

    for (const token of tokens) {
      for (let i = 0; i < this.dimensions; i++) {
        const h = djb2(`${token}:${i}`);
        vec[i] += ((h % 2000) - 1000) / 1000;
      }
    }

    for (let i = 0; i < this.dimensions; i++) {
      vec[i] /= tokens.length;
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return vec;
    return vec.map((v) => v / norm);
  }
}

function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * Load WordPiece vocab from bundled tokenizer.json (Metro resolves .json reliably;
 * bare .txt requires often fail outside Expo's default asset pipeline).
 */
function loadVocabFromTokenizerJson(): Map<string, number> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const raw = require('../../assets/models/nlu/tokenizer/tokenizer.json') as {
    model?: { vocab?: Record<string, number> };
  };
  const vocabObj = raw?.model?.vocab;
  if (!vocabObj || typeof vocabObj !== 'object') {
    throw new Error('tokenizer.json missing model.vocab');
  }
  const map = new Map<string, number>();
  for (const [token, id] of Object.entries(vocabObj)) {
    if (typeof id === 'number') map.set(token, id);
  }
  if (map.size < 100) {
    throw new Error(`tokenizer.json vocab too small (${map.size})`);
  }
  return map;
}

/**
 * BertTokenizer — lightweight WordPiece tokenizer for leaf-ir.
 *
 * Loads the HF tokenizer.json from assets/models/nlu/tokenizer/ and
 * implements encode() → input_ids + attention_mask.
 */
class BertTokenizer {
  private vocab: Map<string, number> = new Map();
  private invVocab: Map<number, string> = new Map();
  private doLowerCase = true;
  private maxLen = MAX_SEQ_LENGTH;

  // Special tokens
  readonly PAD_ID = 0;
  readonly UNK_ID = 100;
  readonly CLS_ID = 101;
  readonly SEP_ID = 102;

  async load(_vocabPath?: string): Promise<void> {
    const map = loadVocabFromTokenizerJson();
    this.vocab = map;
    this.invVocab = new Map<number, string>();
    for (const [token, id] of map) {
      this.invVocab.set(id, token);
    }
    console.log(`[BertTokenizer] Loaded vocab (${map.size} tokens) from tokenizer.json`);
  }

  /**
   * Tokenize text into WordPiece token IDs.
   */
  encode(text: string, maxLength?: number): { inputIds: number[]; attentionMask: number[] } {
    const max = maxLength ?? this.maxLen;
    const normalized = this.doLowerCase ? text.toLowerCase() : text;

    // Basic whitespace + punctuation tokenization
    const tokens = normalized
      .replace(/([.,!?;:(){}[\]"'`~@#$%^&*+=|\\/<>_-])/g, ' $1 ')
      .split(/\s+/)
      .filter(Boolean);

    // WordPiece subword tokenization
    const subTokens: string[] = [];
    for (const token of tokens) {
      if (token.length > 200) {
        subTokens.push(token.slice(0, 200));
        continue;
      }
      const wordPieces = this.wordPieceTokenize(token);
      subTokens.push(...wordPieces);
    }

    // Build final sequence: [CLS] + tokens + [SEP], truncated to maxLen - 2
    const maxTokens = max - 2;
    const truncated = subTokens.slice(0, maxTokens);
    const inputIds = [this.CLS_ID];
    for (const t of truncated) {
      inputIds.push(this.vocab.get(t) ?? this.UNK_ID);
    }
    inputIds.push(this.SEP_ID);

    // Pad to maxLength
    const attentionMask = new Array(inputIds.length).fill(1);
    while (inputIds.length < max) {
      inputIds.push(this.PAD_ID);
      attentionMask.push(0);
    }

    return { inputIds, attentionMask };
  }

  private wordPieceTokenize(token: string): string[] {
    if (this.vocab.has(token)) return [token];
    if (token.length === 0) return [];

    const pieces: string[] = [];
    let start = 0;

    while (start < token.length) {
      let end = token.length;
      let found = false;

      while (start < end) {
        let substr = token.slice(start, end);
        if (start > 0) substr = '##' + substr;
        if (this.vocab.has(substr)) {
          pieces.push(substr);
          found = true;
          start = end;
          break;
        }
        end--;
      }

      if (!found) {
        pieces.push(token[start] ?? '[UNK]');
        start++;
      }
    }

    return pieces;
  }
}

/**
 * TfliteEmbedder — real embedding model via react-native-fast-tflite.
 *
 * Loads the mdbr-leaf-ir INT8 TFLite model (768-d) and runs inference
 * with the BertTokenizer. Applies query prefix on query strings only.
 *
 * planning/35 §4.
 */
export class TfliteEmbedder implements Embedder {
  readonly dimensions = 768;

  private interpreter: unknown = null;
  private tokenizer: BertTokenizer | null = null;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private lastLoadError: string | null = null;

  /**
   * Load the TFLite model and tokenizer.
   */
  async load(modelPath?: string, tokenizerDir?: string): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this._load(modelPath, tokenizerDir).finally(() => {
      // Allow retry after a failed load (do not stick on a dead promise).
      if (!this.loaded) {
        this.loadPromise = null;
      }
    });
    return this.loadPromise;
  }

  getLastLoadError(): string | null {
    return this.lastLoadError;
  }

  private logModelIO(): void {
    const model = this.interpreter as {
      inputs?: unknown;
      outputs?: unknown;
    } | null;
    if (!model) return;
    console.log('[TfliteEmbedder] Inputs:', model.inputs);
    console.log('[TfliteEmbedder] Outputs:', model.outputs);
  }

  private async _load(modelPath?: string, tokenizerDir?: string): Promise<void> {
    const t0 = Date.now();
    this.lastLoadError = null;
    try {
      this.tokenizer = new BertTokenizer();
      await this.tokenizer.load(tokenizerDir);

      const { loadTensorflowModel } = require('react-native-fast-tflite') as {
        loadTensorflowModel: (
          source: number | string,
          delegates?: readonly string[],
        ) => Promise<unknown>;
      };

      type Candidate = { label: string; source: number | string };
      const candidates: Candidate[] = modelPath
        ? [{ label: 'custom', source: modelPath }]
        : [
            { label: 'int8', source: leafIrInt8Asset() },
            { label: 'fp32', source: leafIrFp32Asset() },
          ];

      const errors: string[] = [];
      for (const cand of candidates) {
        for (const delegates of leafIrDelegateAttempts()) {
          const delLabel = delegates.length ? delegates.join('+') : 'cpu';
          try {
            console.log(
              `[TfliteEmbedder] Trying ${cand.label} delegates=[${delLabel}]…`,
            );
            this.interpreter = await loadTensorflowModel(cand.source, [
              ...delegates,
            ]);
            this.loaded = true;
            console.log(
              `[TfliteEmbedder] Loaded leaf-ir ${cand.label} (${delLabel}) ` +
                `768-d in ${Date.now() - t0}ms`,
            );
            this.logModelIO();
            return;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${cand.label}/${delLabel}: ${msg}`);
            console.warn(
              `[TfliteEmbedder] ${cand.label}/${delLabel} failed:`,
              msg,
            );
          }
        }
      }

      throw new Error(
        `All leaf-ir TFLite load attempts failed:\n${errors.join('\n')}`,
      );
    } catch (err) {
      this.loaded = false;
      this.interpreter = null;
      this.lastLoadError = err instanceof Error ? err.message : String(err);
      console.error('[TfliteEmbedder] Initialization failed:', err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  /**
   * Embed text into a 768-d vector.
   * If isQuery is true, prepends the IR query prefix.
   *
   * react-native-fast-tflite v3: `run(ArrayBuffer[])` in model.inputs order.
   */
  async embed(text: string, opts?: { isQuery?: boolean }): Promise<number[]> {
    if (!this.loaded || !this.tokenizer || !this.interpreter) {
      throw new Error('TfliteEmbedder not loaded');
    }

    const input = opts?.isQuery ? QUERY_PREFIX + text : text;
    const { inputIds, attentionMask } = this.tokenizer.encode(input);

    const model = this.interpreter as {
      inputs: Array<{ name: string; dataType: string; shape: number[] }>;
      outputs: Array<{ name: string; dataType: string; shape: number[] }>;
      run: (input: ArrayBuffer[]) => Promise<ArrayBuffer[]>;
    };

    // Leaf-ir expects int64 input_ids + attention_mask shaped [1, 512].
    const seqLen = Math.max(
      inputIds.length,
      ...model.inputs.map((t) => {
        const last = t.shape?.[t.shape.length - 1];
        return typeof last === 'number' && last > 0 ? last : 0;
      }),
      1,
    );

    const padTo = (arr: number[], len: number, pad: number) => {
      const out = arr.slice(0, len);
      while (out.length < len) out.push(pad);
      return out;
    };
    const idsPadded = padTo(inputIds, seqLen, 0);
    const maskPadded = padTo(attentionMask, seqLen, 0);

    const toTensorBuffer = (values: number[], dataType: string): ArrayBuffer => {
      const dtype = (dataType || 'int64').toLowerCase();
      const n = values.length;
      if (dtype.includes('32') && !dtype.includes('64')) {
        const a = new Int32Array(values);
        return a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength);
      }
      // Device log: leaf-ir input_ids / attention_mask are int64
      const buf = new ArrayBuffer(n * 8);
      const view = new BigInt64Array(buf);
      for (let i = 0; i < n; i++) view[i] = BigInt(values[i] | 0);
      return buf;
    };

    const buffers: ArrayBuffer[] = model.inputs.map((tensor) => {
      const n = tensor.name.toLowerCase();
      const values = n.includes('mask') ? maskPadded : idsPadded;
      return toTensorBuffer(values, tensor.dataType);
    });

    const outputs = await model.run(buffers);
    if (!outputs?.[0]) {
      throw new Error('TfliteEmbedder: empty model output');
    }
    const rawOutput = new Float32Array(outputs[0]);
    // sentence_embedding may be [1, 768] — take first 768 floats
    const dim = this.dimensions;
    const vector =
      rawOutput.length >= dim
        ? Array.from(rawOutput.slice(0, dim))
        : Array.from(rawOutput);

    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return vector;
    return vector.map((v) => v / norm);
  }

  /**
   * Check if the TFLite model is loaded and ready.
   */
  isReady(): boolean {
    return this.loaded;
  }
}

// Singleton instance for the NLU embedder
let sharedTfliteEmbedder: TfliteEmbedder | null = null;

/**
 * Get the shared TfliteEmbedder instance (lazy singleton).
 */
export function getSharedTfliteEmbedder(): TfliteEmbedder {
  if (!sharedTfliteEmbedder) {
    sharedTfliteEmbedder = new TfliteEmbedder();
  }
  return sharedTfliteEmbedder;
}

/**
 * Check if TFLite NLU is available (native module present).
 */
export function isTfliteNluAvailable(): boolean {
  try {
    require('react-native-fast-tflite');
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the default embedder based on platform availability.
 * Prefers TFLite (Track B); falls back to HashMock (Track A).
 *
 * Note: TFLite load is async — callers that need a ready embedder should use
 * `createReadyEmbedder()` (with timeout and explicit dev fallback policy).
 */
export function createDefaultEmbedder(options?: {
  allowDevelopmentFallback?: boolean;
}): Embedder {
  if (isTfliteNluAvailable()) {
    const embedder = getSharedTfliteEmbedder();
    // Trigger async load but return immediately (lazy init)
    embedder.load().catch(() => {
      console.warn('[createDefaultEmbedder] TFLite preload failed');
    });
    return embedder;
  }
  if (__DEV__ && options?.allowDevelopmentFallback) {
    return new HashMockEmbedder();
  }
  throw new Error('TFLite NLU embedder unavailable');
}

/**
 * Resolve an embedder that is safe for the chat NLU hot path.
 * Waits for TFLite first load (default 20s); on timeout/failure may return HashMock in dev.
 */
export async function createReadyEmbedder(
  timeoutMs = DEFAULT_TFLITE_EMBEDDER_LOAD_MS,
  options?: { allowDevelopmentFallback?: boolean },
): Promise<Embedder> {
  const allowDevFallback = __DEV__ && options?.allowDevelopmentFallback === true;
  if (!isTfliteNluAvailable()) {
    if (allowDevFallback) return new HashMockEmbedder();
    throw new Error('TFLite NLU module unavailable');
  }
  const embedder = getSharedTfliteEmbedder();
  if (embedder.isReady()) return embedder;
  const t0 = Date.now();
  try {
    await Promise.race([
      embedder.load(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `TFLite embedder load timeout after ${timeoutMs}ms` +
                  (embedder.getLastLoadError()
                    ? ` (last error: ${embedder.getLastLoadError()})`
                    : ''),
              ),
            ),
          timeoutMs,
        ),
      ),
    ]);
    if (embedder.isReady()) {
      console.log(
        `[createReadyEmbedder] ready in ${Date.now() - t0}ms backend=tflite`,
      );
      return embedder;
    }
  } catch (err) {
    if (!allowDevFallback) {
      throw err instanceof Error ? err : new Error('TFLite embedder load failed');
    }
    console.warn('[createReadyEmbedder] using development HashMock fallback:', err);
  }
  if (allowDevFallback) return new HashMockEmbedder();
  throw new Error('TFLite embedder did not become ready');
}

/**
 * Kick off leaf-ir load at app start so the first chat turn does not race a cold load.
 */
export function preloadTfliteEmbedder(): void {
  if (!isTfliteNluAvailable()) return;
  const embedder = getSharedTfliteEmbedder();
  if (embedder.isReady()) return;
  void embedder.load().catch((err) => {
    console.warn('[preloadTfliteEmbedder] failed:', err);
  });
}
