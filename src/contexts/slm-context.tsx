/* eslint-disable react-hooks/refs */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import type {
  ChatMessage,
  ChatResult,
  GenerateOptions,
  InferenceProvider,
  ModelInfo,
} from '@/inference/inference-provider';
import { LlamaRnProvider } from '@/inference/llama-rn-provider';
import {
  MODEL_CATALOG,
  getModelEntry,
  resolveActiveModelId,
  resolveModelPath,
} from '@/inference/model-catalog';
import { isModelInstalled } from '@/services/model-storage';
import { useSettings } from '@/contexts/settings-context';
import { checkSlmRamGate } from '@/services/slm/slm-ram-gate';
import { getDeviceMemoryModule, isNativeMemoryAvailable } from '@/services/device-memory';
import {
  SlmTaskQueue,
  type SlmTaskLease,
  type SlmTaskReason,
  type SlmLoadStatus as QueueLoadStatus,
  type SlmPolicy as QueuePolicy,
} from '@/services/slm/slm-task-queue';

export type SLMStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SlmPolicy = 'manual' | 'auto';

/** Legacy: 30s background grace before unload. */
const LEGACY_BACKGROUND_UNLOAD_MS = 30_000;
/** Legacy: defer startup load so first render + onboarding hydration win. */
const LEGACY_STARTUP_LOAD_DELAY_MS = 500;
/** Delayed OOM retry — only if free RAM improved since the failure. */
const OOM_SINGLE_RETRY_DELAY_MS = 4000;
/** Concierge chat: keep model loaded briefly after blur (accidental tab switches). */
export const CHAT_UNLOAD_GRACE_MS = 10_000;

export type ChatUnloadGrace = {
  /** Epoch ms when the grace period ends and the chat lease may release. */
  endsAt: number;
  /** Full duration of this grace (for ring progress). */
  durationMs: number;
};

interface SLMContextValue {
  provider: InferenceProvider;
  loadStatus: SLMStatus;
  loadError: string | null;
  currentModelId: string | null;
  modelSizeGB: number | null;
  policy: SlmPolicy;
  setPolicy: (policy: SlmPolicy) => void;
  loadModel: (modelId: string) => Promise<void>;
  unloadModel: () => Promise<void>;
  chat: (
    messages: ChatMessage[],
    onToken: (token: string) => void,
    signal: AbortSignal,
    options?: GenerateOptions,
    onReasoningToken?: (token: string) => void,
  ) => Promise<ChatResult>;
  /** The task queue — the single owner of SLM load/unload lifecycle. */
  taskQueue: SlmTaskQueue;
  /** Acquire an SLM lease for a task. See SlmTaskQueue.acquire(). */
  acquireSlm: (reason: SlmTaskReason) => Promise<SlmTaskLease>;
  /**
   * Active Concierge chat unload grace (blur cooldown). Null when not counting down.
   * Used by SlmStatusIcon for the depleting ring.
   */
  chatUnloadGrace: ChatUnloadGrace | null;
  /** Start (or restart) the chat blur grace countdown. */
  startChatUnloadGrace: (durationMs?: number) => void;
  /** Cancel grace (e.g. Concierge regained focus). */
  cancelChatUnloadGrace: () => void;
}

const SLMContext = createContext<SLMContextValue | null>(null);

export function SLMProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const dynamic = settings.dynamicSlmLoading !== false; // default ON
  const simulateMissing = settings.simulateMissingOptionalFeatures === true;
  // Effective default: when exactly one model is installed it is always the
  // default, regardless of the persisted preference (which may point at a
  // model that is no longer on-device). resolveActiveModelId encodes this.
  const defaultModelId = resolveActiveModelId(settings.demoDefaultModelId, (id) => {
    const entry = MODEL_CATALOG.find((m) => m.id === id);
    return entry ? isModelInstalled(entry) : false;
  });
  const [provider] = useState<InferenceProvider>(() => new LlamaRnProvider());

  // Sync the Concierge reasoning mode (app_settings) into the provider.
  // 'off' forces direct answers — template-native models get a no-think chat
  // template override inside LlamaRnProvider.chat().
  useEffect(() => {
    const mode = settings.conciergeReasoning === 'off' ? 'off' : 'auto';
    provider.setReasoningMode?.(mode);
  }, [provider, settings.conciergeReasoning]);
  const [loadStatus, setLoadStatus] = useState<SLMStatus>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [modelSizeGB, setModelSizeGB] = useState<number | null>(null);
  const [policy, setPolicy] = useState<SlmPolicy>('manual');
  const [chatUnloadGrace, setChatUnloadGrace] = useState<ChatUnloadGrace | null>(null);
  const chatGraceClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  const wasUnloadedRef = useRef<boolean>(false);
  const hasLoadErrorRef = useRef<boolean>(false);

  const cancelChatUnloadGrace = useCallback(() => {
    if (chatGraceClearTimerRef.current) {
      clearTimeout(chatGraceClearTimerRef.current);
      chatGraceClearTimerRef.current = null;
    }
    setChatUnloadGrace(null);
  }, []);

  const startChatUnloadGrace = useCallback(
    (durationMs: number = CHAT_UNLOAD_GRACE_MS) => {
      if (chatGraceClearTimerRef.current) {
        clearTimeout(chatGraceClearTimerRef.current);
        chatGraceClearTimerRef.current = null;
      }
      const endsAt = Date.now() + durationMs;
      setChatUnloadGrace({ endsAt, durationMs });
      // Auto-clear UI state when the window ends (lease release is owned by chat screen).
      // Add a small skew so the chat screen's release/unload runs first.
      chatGraceClearTimerRef.current = setTimeout(() => {
        chatGraceClearTimerRef.current = null;
        setChatUnloadGrace(null);
      }, durationMs + 50);
    },
    [],
  );


  useEffect(() => {
    return () => {
      if (chatGraceClearTimerRef.current) {
        clearTimeout(chatGraceClearTimerRef.current);
      }
    };
  }, []);

  // ── OOM retry state (shared by both modes) ──
  const oomRetryUsedRef = useRef(false);
  const freeMBAtFailRef = useRef<number | null>(null);
  const oomRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to break the circular dependency: scheduleSingleOomRetry → loadModel.
  const loadModelRef = useRef<(modelId: string) => Promise<void>>(() => Promise.resolve());

  const scheduleSingleOomRetry = useCallback(
    (modelId: string) => {
      if (oomRetryUsedRef.current) return;
      if (oomRetryTimerRef.current) return;

      oomRetryTimerRef.current = setTimeout(() => {
        oomRetryTimerRef.current = null;
        oomRetryUsedRef.current = true;

        const gate = checkSlmRamGate(modelId, getModelEntry(modelId)?.preferredNCtx);
        const improved =
          freeMBAtFailRef.current == null ||
          (gate.freeMB != null && gate.freeMB > freeMBAtFailRef.current + 100);

        if (gate.ok && improved && !loadPromiseRef.current) {
          hasLoadErrorRef.current = false;
          void loadModelRef.current(modelId).catch(() => {});
        }
      }, OOM_SINGLE_RETRY_DELAY_MS);
    },
    [],
  );

  const loadModel = useCallback(
    async (modelId: string) => {
      // Developer testing mode: never load a model while the optional-feature
      // surfaces are being simulated as missing (doc 26 §7.3).
      if (simulateMissing) {
        console.log('[SLM] Skipping loadModel — simulateMissingOptionalFeatures is on');
        setLoadStatus('idle');
        setCurrentModelId(null);
        setLoadError(
          'Concierge is disabled in developer testing mode (Simulate missing Concierge / knowledge).',
        );
        return;
      }

      // Single-flight: concurrent acquire + ensureReady + explain must share one load.
      if (loadPromiseRef.current) {
        console.log('[SLM] Joining in-flight loadModel');
        await loadPromiseRef.current;
        if (provider.getModelInfo() !== null) return;
        // Prior load failed — allow a fresh attempt below.
      }

      // Hot-switch: if a *known different* model is resident, release it first.
      // When loadedId is null, provider.loadModel path-matches and either
      // no-ops (same file) or freeContext()+reloads (different file) without
      // deadlocking.
      if (provider.getModelInfo() !== null) {
        const loadedId = provider.getLoadedModelId?.() ?? null;
        if (loadedId === modelId) {
          setLoadStatus('ready');
          setCurrentModelId(modelId);
          return;
        }
        if (loadedId != null && loadedId !== modelId) {
          console.log(`[SLM] Switching model: ${loadedId} → ${modelId}`);
          await provider.release();
          setLoadStatus('idle');
          setCurrentModelId(null);
        }
      }

      const entry = MODEL_CATALOG.find((m) => m.id === modelId);
      if (!entry) {
        const message = `Model not found: ${modelId}`;
        setLoadError(message);
        setLoadStatus('error');
        hasLoadErrorRef.current = true;
        throw new Error(message);
      }

      // Never attempt to load a model whose files are not actually
      // downloaded — llama.rn would fail on a missing GGUF. Fail fast with
      // the download prompt instead of touching the provider.
      if (!isModelInstalled(entry)) {
        const message = `Concierge model is not downloaded: ${entry.displayName}. Open Models to download it.`;
        setLoadError(message);
        setLoadStatus('error');
        hasLoadErrorRef.current = true;
        throw new Error(message);
      }

      // ── Pre-load RAM gate (shared by both modes) ──
      // Preferred n_ctx is 8K (longer conversations). If the 8K KV cache does
      // not fit in free RAM, fall back to 4K so low-RAM devices still load.
      const preferredNCtx = getModelEntry(modelId)?.preferredNCtx ?? 4096;
      let gate = checkSlmRamGate(modelId, preferredNCtx);
      let effectiveNCtx = preferredNCtx;
      if (!gate.ok && preferredNCtx > 4096) {
        const fallback = checkSlmRamGate(modelId, 4096);
        if (fallback.ok) {
          gate = fallback;
          effectiveNCtx = 4096;
        }
      }
      if (!gate.ok) {
        const message = `Not enough free memory to load Concierge. ${gate.reason}`;
        setLoadError(message);
        setLoadStatus('error');
        hasLoadErrorRef.current = true;
        freeMBAtFailRef.current = gate.freeMB;
        scheduleSingleOomRetry(modelId);
        throw new Error(message);
      }

      const run = (async () => {
        setLoadStatus('loading');
        setLoadError(null);
        wasUnloadedRef.current = false;
        hasLoadErrorRef.current = false;
        oomRetryUsedRef.current = false;

        try {
          const path = resolveModelPath(entry.file);
          // Profile-driven n_ctx (8K preferred, RAM-gated down to 4K) + GPU
          // policy (Bonsai Q1_0 offloads to Metal; a future CPU-only quant
          // would set nGpuLayers: 0).
          await provider.loadModel(path, {
            nCtx: effectiveNCtx,
            modelId,
            nGpuLayers: entry.nGpuLayers,
          });
          const info: ModelInfo | null = provider.getModelInfo();
          setCurrentModelId(modelId);
          setModelSizeGB(info ? info.sizeBytes / (1024 * 1024 * 1024) : null);
          setLoadStatus('ready');
          hasLoadErrorRef.current = false;
          oomRetryUsedRef.current = false;
          freeMBAtFailRef.current = null;
          if (oomRetryTimerRef.current) {
            clearTimeout(oomRetryTimerRef.current);
            oomRetryTimerRef.current = null;
          }
        } catch (err: any) {
          const message = err?.message ?? 'Failed to load model';
          setLoadError(message);
          setLoadStatus('error');
          setCurrentModelId(null);
          setModelSizeGB(null);
          hasLoadErrorRef.current = true;
          if (isNativeMemoryAvailable()) {
            try {
              const { freeMB } = getDeviceMemoryModule().getMemoryInfo();
              freeMBAtFailRef.current = freeMB;
            } catch {
              // ignore
            }
          }
          scheduleSingleOomRetry(modelId);
          // Must rethrow so SlmTaskQueue.acquire() does not grant a lease on a
          // failed load (UC3/UC4 explain was getting a lease then crashing in chat).
          throw err instanceof Error ? err : new Error(message);
        }
      })();

      loadPromiseRef.current = run.finally(() => {
        if (loadPromiseRef.current === run) {
          loadPromiseRef.current = null;
        }
      });
      await loadPromiseRef.current;
    },
    [provider, scheduleSingleOomRetry, simulateMissing],
  );

  // Keep the ref current so the OOM retry timer can call loadModel.
  useEffect(() => { loadModelRef.current = loadModel; }, [loadModel]);

  const unloadModel = useCallback(async () => {
    try {
      await provider.release();
    } catch {
      // ignore release errors
    }
    wasUnloadedRef.current = true;
    hasLoadErrorRef.current = false;
    setCurrentModelId(null);
    setModelSizeGB(null);
    setLoadStatus('idle');
    setLoadError(null);
  }, [provider]);

  // When developer testing mode is enabled, release any resident model so no
  // SLM stays loaded while the optional-feature surfaces are simulated as
  // missing. Deferred so the state update does not run synchronously within
  // the effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!simulateMissing || provider.getModelInfo() === null) return;
    const handle = setTimeout(() => {
      void unloadModel();
    }, 0);
    return () => clearTimeout(handle);
  }, [simulateMissing, provider, unloadModel]);

  // Create the task queue once.
  // eslint-disable react-hooks/refs
  const [taskQueue] = useState(
    () =>
      new SlmTaskQueue({
        getLoadStatus: () => 'idle' as QueueLoadStatus,
        getPolicy: () => 'manual' as QueuePolicy,
        getDefaultModelId: () => defaultModelId,
        loadModel,
        unloadModel,
        getLoadPromise: () => null,
        setLoadPromise: () => {},
      }),
  );
  // eslint-enable react-hooks/refs

  // Update the task queue config whenever state changes.
  useEffect(() => {
    taskQueue.updateConfig({
      getLoadStatus: () => loadStatus as QueueLoadStatus,
      getPolicy: () => policy as QueuePolicy,
      getDefaultModelId: () => currentModelId ?? defaultModelId,
      loadModel,
      unloadModel,
      getLoadPromise: () => loadPromiseRef.current,
      setLoadPromise: (p) => {
        loadPromiseRef.current = p;
      },
      autoUnloadMs: dynamic ? 0 : LEGACY_BACKGROUND_UNLOAD_MS,
      forceAutoLoadOnAcquire: dynamic,
    });
  }, [taskQueue, loadStatus, policy, currentModelId, defaultModelId, loadModel, unloadModel, dynamic]);

  // ── Startup load — LEGACY ONLY ──
  useEffect(() => {
    if (dynamic) return; // DYNAMIC: no startup load
    const entry = MODEL_CATALOG.find((m) => m.id === defaultModelId);
    if (!entry || !isModelInstalled(entry)) return;
    if (loadStatus !== 'idle') return;
    const t = setTimeout(() => {
      const gate = checkSlmRamGate(defaultModelId, getModelEntry(defaultModelId)?.preferredNCtx);
      if (!gate.ok) {
        setLoadError(`Not enough free memory to load Concierge. ${gate.reason}`);
        setLoadStatus('error');
        hasLoadErrorRef.current = true;
        freeMBAtFailRef.current = gate.freeMB;
        scheduleSingleOomRetry(defaultModelId);
        return;
      }
      void loadModel(defaultModelId).catch(() => {});
    }, LEGACY_STARTUP_LOAD_DELAY_MS);
    return () => clearTimeout(t);
  }, [dynamic, defaultModelId, loadModel, loadStatus, scheduleSingleOomRetry]);

  // ── AppState — debounced unload / foreground reload ──
  useEffect(() => {
    let unloadTimer: ReturnType<typeof setTimeout> | null = null;

    const clearUnloadTimer = () => {
      if (unloadTimer) {
        clearTimeout(unloadTimer);
        unloadTimer = null;
      }
    };

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        clearUnloadTimer();
        const grace = dynamic ? 0 : LEGACY_BACKGROUND_UNLOAD_MS;
        const fire = () => {
          if (taskQueue.activeLeaseCount === 0) void unloadModel();
        };
        if (grace <= 0) {
          fire();
        } else {
          unloadTimer = setTimeout(fire, grace);
        }
      } else if (state === 'active') {
        clearUnloadTimer();
        if (dynamic) return; // DYNAMIC: never auto-reload on foreground

        // LEGACY: needsReload + RAM gate + load or scheduleSingleOomRetry
        const needsReload = wasUnloadedRef.current || provider.getModelInfo() === null;
        if (!needsReload || loadPromiseRef.current || hasLoadErrorRef.current) return;

        const entry = MODEL_CATALOG.find((m) => m.id === defaultModelId);
        if (!entry || !isModelInstalled(entry)) return;

        const gate = checkSlmRamGate(defaultModelId, getModelEntry(defaultModelId)?.preferredNCtx);
        if (!gate.ok) {
          console.warn('[SLM] Skip foreground reload — RAM gate:', gate.reason);
          setLoadError(`Concierge paused: ${gate.reason}. Free memory and tap to retry.`);
          setLoadStatus('error');
          hasLoadErrorRef.current = true;
          freeMBAtFailRef.current = gate.freeMB;
          scheduleSingleOomRetry(defaultModelId);
          return;
        }
        void loadModel(defaultModelId).catch(() => {});
      }
    });
    return () => {
      sub.remove();
      clearUnloadTimer();
    };
  }, [dynamic, taskQueue, defaultModelId, loadModel, unloadModel, provider, scheduleSingleOomRetry]); // loadStatus intentionally removed — see comment in original

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      provider.release().catch(() => {});
    };
  }, [provider]);

  // ── Toggle hot-switch ──
  const prevDynamicRef = useRef(dynamic);
  useEffect(() => {
    const prev = prevDynamicRef.current;
    prevDynamicRef.current = dynamic;
    if (prev === dynamic) return; // only on transition

    if (!dynamic && loadStatus === 'idle') {
      const entry = MODEL_CATALOG.find((m) => m.id === defaultModelId);
      if (entry && isModelInstalled(entry)) {
        const gate = checkSlmRamGate(defaultModelId, getModelEntry(defaultModelId)?.preferredNCtx);
        if (gate.ok) {
          // Defer to avoid setState-during-effect cascade.
          setTimeout(() => void loadModel(defaultModelId).catch(() => {}), 0);
        }
      }
    }
    if (dynamic && taskQueue.activeLeaseCount === 0 && loadStatus === 'ready') {
      // Defer to avoid setState-during-effect cascade.
      setTimeout(() => void unloadModel(), 0);
    }
  }, [dynamic, loadStatus, defaultModelId, loadModel, unloadModel, taskQueue]);

  const acquireSlm = useCallback(
    (reason: SlmTaskReason) => {
      if (simulateMissing) {
        throw new Error(
          'Concierge is disabled in developer testing mode (Simulate missing Concierge / knowledge).',
        );
      }
      return taskQueue.acquire(reason);
    },
    [taskQueue, simulateMissing],
  );

  const chat = useCallback(
    async (
      messages: ChatMessage[],
      onToken: (token: string) => void,
      signal: AbortSignal,
      options?: GenerateOptions,
      onReasoningToken?: (token: string) => void,
    ): Promise<ChatResult> => {
      if (simulateMissing) {
        throw new Error(
          'Concierge is disabled in developer testing mode (Simulate missing Concierge / knowledge).',
        );
      }
      if (provider.getModelInfo() === null && wasUnloadedRef.current && !hasLoadErrorRef.current) {
        const entry = MODEL_CATALOG.find((m) => m.id === defaultModelId);
        if (entry && isModelInstalled(entry)) {
          console.log('[SLM] Chat auto-loading after unload');
          await loadModel(defaultModelId);
        }
      }
      return provider.chat(messages, onToken, signal, options, onReasoningToken);
    },
    [provider, defaultModelId, loadModel, simulateMissing],
  );

  const value: SLMContextValue = {
    provider,
    loadStatus,
    loadError,
    currentModelId,
    modelSizeGB,
    policy,
    setPolicy,
    loadModel,
    unloadModel,
    chat,
    taskQueue,
    acquireSlm,
    chatUnloadGrace,
    startChatUnloadGrace,
    cancelChatUnloadGrace,
  };

  return <SLMContext.Provider value={value}>{children}</SLMContext.Provider>;
}

export function useSLM(): SLMContextValue {
  const ctx = useContext(SLMContext);
  if (!ctx) {
    throw new Error('useSLM must be used within an SLMProvider');
  }
  return ctx;
}
