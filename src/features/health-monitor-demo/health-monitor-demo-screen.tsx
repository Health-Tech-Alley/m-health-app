import { useCallback, useMemo, useReducer } from 'react';

import { useSLM } from '@/contexts/slm-context';
import { useUC2Runtime } from '@/contexts/uc2-runtime-context';

import { createHealthMonitorDemoController } from './health-monitor-demo-controller';
import { HealthMonitorDemoView } from './health-monitor-demo-view';
import { initialState, reducer } from './types';

export function HealthMonitorDemoScreen() {
  const slm = useSLM();
  const { model: mlModel, ready: mlReady } = useUC2Runtime();
  const [state, dispatch] = useReducer(reducer, initialState);

  const controller = useMemo(
    () => createHealthMonitorDemoController(mlModel),
    [mlModel],
  );

  const handleRun = useCallback(async () => {
    if (!state.raw) return;
    dispatch({ type: 'run-start' });
    try {
      const result = await controller.runPipelines({
        raw: state.raw,
        profile: state.profile!,
        caregiver: state.caregiverInput ?? undefined,
        history: state.history,
        toggles: state.toggles,
      });
      dispatch({ type: 'run-success', payload: result });
    } catch (err) {
      dispatch({ type: 'run-error', payload: { error: err instanceof Error ? err.message : 'Pipeline failed' } });
    }
  }, [controller, state]);

  const handleSLM = useCallback(async () => {
    if (!state.v2Result) return;
    dispatch({ type: 'slm-start' });
    try {
      const result = await controller.runSLMExplanation(
        state.v2Result,
        slm.chat,
        (token) => dispatch({ type: 'slm-token', payload: { token } }),
      );
      dispatch({ type: 'slm-success', payload: result });
    } catch (err) {
      dispatch({ type: 'slm-error', payload: { error: err instanceof Error ? err.message : 'SLM failed' } });
    }
  }, [controller, state.v2Result, slm.chat]);

  return (
    <HealthMonitorDemoView
      state={state}
      dispatch={dispatch}
      onRun={handleRun}
      onSLM={handleSLM}
      mlReady={mlReady}
      slmReady={slm.loadStatus === 'ready'}
    />
  );
}
