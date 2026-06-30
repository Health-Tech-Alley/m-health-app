import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { AlertAutoencoder } from '@/ml-models/alert-autoencoder';
import {
  createUC2ApplicationRuntime,
  type UC2ApplicationRuntime,
} from '@/services/ml/uc2-runtime-service';

type UC2RuntimeStatus = 'loading' | 'ready' | 'failed';

type UC2RuntimeContextValue = {
  model: AlertAutoencoder;
  runtime: UC2ApplicationRuntime;
  status: UC2RuntimeStatus;
  ready: boolean;
  error: string | null;
};

const UC2RuntimeContext = createContext<UC2RuntimeContextValue | null>(null);

export function UC2RuntimeProvider({ children }: { children: ReactNode }) {
  const [model] = useState(() => new AlertAutoencoder());
  const runtime = useMemo(() => createUC2ApplicationRuntime(model), [model]);
  const [status, setStatus] = useState<UC2RuntimeStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    model
      .load()
      .then(() => {
        if (cancelled) return;
        setStatus('ready');
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('failed');
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      model.release().catch(() => {});
    };
  }, [model]);

  const value = useMemo<UC2RuntimeContextValue>(
    () => ({
      model,
      runtime,
      status,
      ready: status === 'ready' && runtime.isReady(),
      error,
    }),
    [error, model, runtime, status],
  );

  return (
    <UC2RuntimeContext.Provider value={value}>
      {children}
    </UC2RuntimeContext.Provider>
  );
}

export function useUC2Runtime(): UC2RuntimeContextValue {
  const ctx = useContext(UC2RuntimeContext);
  if (!ctx) {
    throw new Error('useUC2Runtime must be used within a UC2RuntimeProvider');
  }
  return ctx;
}
