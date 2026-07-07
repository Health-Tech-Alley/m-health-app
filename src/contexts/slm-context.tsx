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
import { DEFAULT_SLM_MODEL_ID, MODEL_CATALOG, resolveModelPath } from '@/inference/model-catalog';
import { isModelInstalled } from '@/services/model-storage';
import { useSettings } from '@/contexts/settings-context';
import {
  SlmTaskQueue,
  type SlmTaskLease,
  type SlmTaskReason,
  type SlmLoadStatus as QueueLoadStatus,
  type SlmPolicy as QueuePolicy,
} from '@/services/slm/slm-task-queue';

export type SLMStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SlmPolicy = 'manual' | 'auto';

/** D1: 30s background grace before unload (was 0/immediate). */
const BACKGROUND_UNLOAD_MS = 30_000;
/** D1: defer startup load so first render + onboarding hydration win. */
const STARTUP_LOAD_DELAY_MS = 500;

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
}

const SLMContext = createContext<SLMContextValue | null>(null);

export function SLMProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const defaultModelId = settings.demoDefaultModelId ?? DEFAULT_SLM_MODEL_ID;
  const [provider] = useState<InferenceProvider>(() => new LlamaRnProvider());
  const [loadStatus, setLoadStatus] = useState<SLMStatus>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [modelSizeGB, setModelSizeGB] = useState<number | null>(null);
  const [policy, setPolicy] = useState<SlmPolicy>('manual');
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  // Survives the AppState 'active' / unload race. The unload itself
  // transitions loadStatus from 'ready' to 'idle' asynchronously; if the
  // user foregrounds mid-unload, the AppState 'active' handler must
  // still know "we just unloaded — reload now." This ref is the single
  // source of truth for that decision.
  const wasUnloadedRef = useRef<boolean>(false);
  // Track error state to prevent reload loops. Updated in loadModel/unloadModel.
  const hasLoadErrorRef = useRef<boolean>(false);

  const loadModel = useCallback(async (modelId: string) => {
    const entry = MODEL_CATALOG.find((m) => m.id === modelId);
    if (!entry) {
      setLoadError(`Model not found: ${modelId}`);
      setLoadStatus('error');
      hasLoadErrorRef.current = true;
      return;
    }

    setLoadStatus('loading');
    setLoadError(null);
    wasUnloadedRef.current = false;
    hasLoadErrorRef.current = false;

    try {
      const path = resolveModelPath(entry.file);
      await provider.loadModel(path, { nCtx: 8192 });
      const info: ModelInfo | null = provider.getModelInfo();
      setCurrentModelId(modelId);
      setModelSizeGB(info ? info.sizeBytes / (1024 * 1024 * 1024) : null);
      setLoadStatus('ready');
      hasLoadErrorRef.current = false;
    } catch (err: any) {
      setLoadError(err.message ?? 'Failed to load model');
      setLoadStatus('error');
      setCurrentModelId(null);
      setModelSizeGB(null);
      hasLoadErrorRef.current = true;
    }
  }, [provider]);

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

  // Create the task queue once. Its config is updated in a useEffect below
  // whenever loadStatus/policy/currentModelId change, so it always reads the
  // latest state without being recreated. The useState initializer captures
  // loadModel/unloadModel (stable useCallbacks) — the config is refreshed
  // in the effect below, so stale closures are not a concern.
  // eslint-disable-next-line
  const [taskQueue] = useState(() => new SlmTaskQueue({
    getLoadStatus: () => 'idle' as QueueLoadStatus,
    getPolicy: () => 'manual' as QueuePolicy,
    getDefaultModelId: () => defaultModelId,
    loadModel,
    unloadModel,
    getLoadPromise: () => null,
    setLoadPromise: () => {},
  }));

  // Update the task queue config whenever state changes.
  useEffect(() => {
    taskQueue.updateConfig({
      getLoadStatus: () => loadStatus as QueueLoadStatus,
      getPolicy: () => policy as QueuePolicy,
      getDefaultModelId: () => currentModelId ?? defaultModelId,
      loadModel,
      unloadModel,
      getLoadPromise: () => loadPromiseRef.current,
      setLoadPromise: (p) => { loadPromiseRef.current = p; },
    });
  }, [taskQueue, loadStatus, policy, currentModelId, defaultModelId, loadModel, unloadModel]);

  // D1: Startup load — async, non-blocking. Fires once per defaultModelId.
  // Acquires can await this promise via the task queue.
  // Guard: skip if the model file isn't downloaded yet (stays 'idle' / grey
  // rather than erroring on a missing file). The user can download it from
  // the Models / Concierge tab; the next foreground-return will pick it up.
  useEffect(() => {
    const entry = MODEL_CATALOG.find((m) => m.id === defaultModelId);
    if (!entry || !isModelInstalled(entry)) return;
    // Only auto-load when idle. Don't retry on error — user must manually trigger.
    if (loadStatus !== 'idle') return;
    const t = setTimeout(() => {
      void loadModel(defaultModelId).catch(() => {
        // loadModel already sets 'error' on failure; nothing else to do.
      });
    }, STARTUP_LOAD_DELAY_MS);
    return () => clearTimeout(t);
  }, [defaultModelId, loadModel, loadStatus]);

  // D1: AppState — debounced unload (30s grace) instead of immediate.
  // Mid-generation is protected by the lease refcount: if there are active
  // leases when the timer fires, we just defer the unload until they're gone.
  //
  // CRITICAL: the `active` branch must NOT depend on `loadStatus` in its
  // closure, because the unload itself transitions loadStatus from 'ready'
  // to 'idle' asynchronously. If the user foregrounds mid-unload (e.g. at
  // second 31, while provider.release() is still awaiting), the old listener
  // reads `loadStatus === 'ready'` and skips the re-load. The new listener
  // isn't installed until the unload's setLoadStatus('idle') commits, by
  // which time the AppState 'active' event has already passed.
  //
  // The `wasUnloadedRef` is the single source of truth. It flips in
  // unloadModel/loadModel and is read here as `.current` — always the
  // freshest value, never the closure-captured stale one.
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
        unloadTimer = setTimeout(() => {
          unloadTimer = null;
          // Only unload if no active generation (task queue is the
          // authority). If a lease is held, leave the model loaded — the
          // lease release path will trigger the auto-unload.
          if (taskQueue.activeLeaseCount === 0) {
            void unloadModel();
          }
        }, BACKGROUND_UNLOAD_MS);
      } else if (state === 'active') {
        clearUnloadTimer();
        // Always check if we need to reload on foreground. The native model
        // might have been released by the OS even if we didn't explicitly
        // unload it. Check both our ref flag AND the provider's actual state.
        // Don't reload if we're in an error state — user must manually trigger.
        const needsReload = wasUnloadedRef.current || provider.getModelInfo() === null;
        if (needsReload && !loadPromiseRef.current && !hasLoadErrorRef.current) {
          const entry = MODEL_CATALOG.find((m) => m.id === defaultModelId);
          if (entry && isModelInstalled(entry)) {
            console.log('[SLM] Foreground re-loading model');
            void loadModel(defaultModelId).catch(() => {});
          }
        }
      }
    });
    return () => {
      sub.remove();
      clearUnloadTimer();
    };
  }, [taskQueue, defaultModelId, loadModel, unloadModel]); // loadStatus intentionally removed — see comment above

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      provider.release().catch(() => {});
    };
  }, [provider]);

  const acquireSlm = useCallback(
    (reason: SlmTaskReason) => taskQueue.acquire(reason),
    [taskQueue],
  );

  const chat = useCallback(
    async (
      messages: ChatMessage[],
      onToken: (token: string) => void,
      signal: AbortSignal,
      options?: GenerateOptions,
      onReasoningToken?: (token: string) => void,
    ): Promise<ChatResult> => {
      // Belt-and-suspenders: if the user sends a message and the model
      // was unloaded, auto-load it before calling provider.chat. Normally
      // the AppState 'active' re-load handles this, but there's a window
      // where the user might send a message before the re-load completes.
      // The provider's getModelInfo() returns null when no context is
      // loaded — that's the authoritative native-side check (independent
      // of React state).
      // Don't auto-load if we're in an error state — user must manually trigger.
      if (provider.getModelInfo() === null && wasUnloadedRef.current && !hasLoadErrorRef.current) {
        const entry = MODEL_CATALOG.find((m) => m.id === defaultModelId);
        if (entry && isModelInstalled(entry)) {
          console.log('[SLM] Chat auto-loading after unload');
          await loadModel(defaultModelId);
        }
      }
      return provider.chat(messages, onToken, signal, options, onReasoningToken);
    },
    [provider, defaultModelId, loadModel],
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
