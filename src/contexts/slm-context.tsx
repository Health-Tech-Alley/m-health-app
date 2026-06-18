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
import { MODEL_CATALOG, resolveModelPath } from '@/inference/model-catalog';
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
  ) => Promise<ChatResult>;
  /** The task queue — the single owner of SLM load/unload lifecycle. */
  taskQueue: SlmTaskQueue;
  /** Acquire an SLM lease for a task. See SlmTaskQueue.acquire(). */
  acquireSlm: (reason: SlmTaskReason) => Promise<SlmTaskLease>;
}

const SLMContext = createContext<SLMContextValue | null>(null);

export function SLMProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const defaultModelId = settings.demoDefaultModelId ?? 'healthgpt-pro-4b';
  const [provider] = useState<InferenceProvider>(() => new LlamaRnProvider());
  const [loadStatus, setLoadStatus] = useState<SLMStatus>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [modelSizeGB, setModelSizeGB] = useState<number | null>(null);
  const [policy, setPolicy] = useState<SlmPolicy>('manual');
  const loadPromiseRef = useRef<Promise<void> | null>(null);

  const loadModel = useCallback(async (modelId: string) => {
    const entry = MODEL_CATALOG.find((m) => m.id === modelId);
    if (!entry) {
      setLoadError(`Model not found: ${modelId}`);
      setLoadStatus('error');
      return;
    }

    setLoadStatus('loading');
    setLoadError(null);

    try {
      const path = resolveModelPath(entry.file);
      await provider.loadModel(path, { nCtx: 4096 });
      const info: ModelInfo | null = provider.getModelInfo();
      setCurrentModelId(modelId);
      setModelSizeGB(info ? info.sizeBytes / (1024 * 1024 * 1024) : null);
      setLoadStatus('ready');
    } catch (err: any) {
      setLoadError(err.message ?? 'Failed to load model');
      setLoadStatus('error');
      setCurrentModelId(null);
      setModelSizeGB(null);
    }
  }, [provider]);

  const unloadModel = useCallback(async () => {
    try {
      await provider.release();
    } catch {
      // ignore release errors
    }
    setCurrentModelId(null);
    setModelSizeGB(null);
    setLoadStatus('idle');
    setLoadError(null);
  }, [provider]);

  // Create the task queue once. Its config is updated in a useEffect below
  // whenever loadStatus/policy/currentModelId change, so it always reads the
  // latest state without being recreated.
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

  // AppState: on background, the task queue force-releases all leases and
  // unloads the model. This replaces the old AppState effect.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        taskQueue.onAppBackground();
      }
    });
    return () => sub.remove();
  }, [taskQueue]);

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
    ): Promise<ChatResult> => {
      return provider.chat(messages, onToken, signal, options);
    },
    [provider],
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
