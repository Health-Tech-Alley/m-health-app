import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import type {
  ChatMessage,
  ChatResult,
  InferenceProvider,
  ModelInfo,
} from '@/inference/inference-provider';
import { LlamaRnProvider } from '@/inference/llama-rn-provider';
import { MODEL_CATALOG, resolveModelPath } from '@/inference/model-catalog';

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
  scheduleAutoUnload: () => void;
  chat: (
    messages: ChatMessage[],
    onToken: (token: string) => void,
    signal: AbortSignal,
  ) => Promise<ChatResult>;
}

const SLMContext = createContext<SLMContextValue | null>(null);

export function SLMProvider({ children }: { children: ReactNode }) {
  const [provider] = useState<InferenceProvider>(() => new LlamaRnProvider());
  const [loadStatus, setLoadStatus] = useState<SLMStatus>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [modelSizeGB, setModelSizeGB] = useState<number | null>(null);
  const [policy, setPolicy] = useState<SlmPolicy>('manual');
  const autoUnloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      provider.release().catch(() => {});
      if (autoUnloadTimer.current) clearTimeout(autoUnloadTimer.current);
    };
  }, [provider]);

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
      await provider.loadModel(path);
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

  /**
   * In auto (Demo) policy, schedule an unload after 60s idle.
   * Called by the slm-explain screen after the explain flow completes.
   */
  const scheduleAutoUnload = useCallback(() => {
    if (policy !== 'auto') return;
    if (autoUnloadTimer.current) {
      clearTimeout(autoUnloadTimer.current);
    }
    autoUnloadTimer.current = setTimeout(() => {
      autoUnloadTimer.current = null;
      void unloadModel();
    }, 60_000);
  }, [policy, unloadModel]);

  // Auto-management: unload on background (Demo mode only)
  useEffect(() => {
    if (policy !== 'auto') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && loadStatus === 'ready') {
        void unloadModel();
      }
    });
    return () => sub.remove();
  }, [policy, loadStatus, unloadModel]);

  const chat = useCallback(
    async (
      messages: ChatMessage[],
      onToken: (token: string) => void,
      signal: AbortSignal,
    ): Promise<ChatResult> => {
      return provider.chat(messages, onToken, signal);
    },
    [provider],
  );

  const value = useMemo<SLMContextValue>(
    () => ({
      provider,
      loadStatus,
      loadError,
      currentModelId,
      modelSizeGB,
      policy,
      setPolicy,
      loadModel,
      unloadModel,
      scheduleAutoUnload,
      chat,
    }),
    [provider, loadStatus, loadError, currentModelId, modelSizeGB, policy, loadModel, unloadModel, scheduleAutoUnload, chat],
  );

  return <SLMContext.Provider value={value}>{children}</SLMContext.Provider>;
}

export function useSLM(): SLMContextValue {
  const ctx = useContext(SLMContext);
  if (!ctx) {
    throw new Error('useSLM must be used within an SLMProvider');
  }
  return ctx;
}
