/**
 * Subscribe to app-wide knowledge pack install state (doc 42).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  cancelKnowledgePackInstall,
  checkForPackUpdates,
  getKnowledgePackInstallState,
  isKnowledgePackRunnerEnabled,
  resetKnowledgePack,
  runKnowledgePackInstall,
  subscribeKnowledgePackInstall,
  type PackInstallUiState,
  type PackRunnerOptions,
} from '@/clinical-evidence/pack';

export function useKnowledgePackInstall() {
  const [state, setState] = useState<PackInstallUiState>(() => getKnowledgePackInstallState());
  const startedRef = useRef(false);

  useEffect(() => {
    return subscribeKnowledgePackInstall(setState);
  }, []);

  const start = useCallback(async (opts?: PackRunnerOptions) => {
    if (!isKnowledgePackRunnerEnabled()) {
      return {
        chunksInstalled: 0,
        layersUpdated: [],
        errors: ['knowledgePackRunner flag is off'],
        ready: false,
      };
    }
    return runKnowledgePackInstall(opts);
  }, []);

  const cancel = useCallback(() => {
    cancelKnowledgePackInstall();
  }, []);

  const retry = useCallback(async (opts?: PackRunnerOptions) => {
    return runKnowledgePackInstall({ ...opts, force: true });
  }, []);

  const checkUpdates = useCallback(async (opts?: PackRunnerOptions) => {
    return checkForPackUpdates(opts);
  }, []);

  const resetPack = useCallback(async (opts?: PackRunnerOptions) => {
    return resetKnowledgePack(opts);
  }, []);

  const autoStartOnce = useCallback(
    async (opts?: PackRunnerOptions) => {
      if (startedRef.current) return;
      if (state.status === 'in_flight') return;
      // Re-run when not ready, or when isPackReady() is false (thin/corrupt pack).
      const { isPackReady } = await import('@/clinical-evidence/pack');
      if (state.status === 'ready' && isPackReady()) return;
      startedRef.current = true;
      // force when UI said ready but repair needed
      return start({ ...opts, force: state.status === 'ready' ? true : opts?.force });
    },
    [start, state.status],
  );

  const isReady = state.status === 'ready';
  const inFlight = state.status === 'in_flight';

  return useMemo(
    () => ({
      state,
      isReady,
      inFlight,
      start,
      cancel,
      retry,
      checkUpdates,
      resetPack,
      autoStartOnce,
    }),
    [state, isReady, inFlight, start, cancel, retry, checkUpdates, resetPack, autoStartOnce],
  );
}
