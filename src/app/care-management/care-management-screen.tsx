import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { useSLM } from '@/contexts/slm-context';
import { AlertAutoencoder } from '@/ml-models/alert-autoencoder';
import { createCareManagementController } from './care-management-controller';
import type { CareManagementAction, CareManagementState } from './types';
import { CareManagementView } from './care-management-view';

const initialState: CareManagementState = {
  selectedScenarioId: null,
  coreVitals: null,
  extendedVitals: null,
  mlStatus: 'idle',
  mlResult: null,
  mlError: null,
  slmStatus: 'idle',
  slmExplanation: '',
  slmThinking: '',
  slmFinalExplanation: '',
  slmError: null,
  validationErrors: [],
};

function parseSLMOutput(fullText: string): { thinking: string; explanation: string } {
  const thinkingMatch = fullText.match(/<THINKING>([\s\S]*?)<\/THINKING>/i);
  const explanationMatch = fullText.match(/<EXPLANATION>([\s\S]*?)<\/EXPLANATION>/i);

  const thinking = thinkingMatch ? thinkingMatch[1].trim() : '';
  const explanation = explanationMatch ? explanationMatch[1].trim() : '';

  return { thinking, explanation };
}

function reducer(state: CareManagementState, action: CareManagementAction): CareManagementState {
  switch (action.type) {
    case 'noop':
      return state;

    case 'select-scenario':
      return {
        ...initialState,
        selectedScenarioId: action.payload.scenarioId,
        coreVitals: action.payload.core,
        extendedVitals: action.payload.extended,
      };

    case 'update-vitals': {
      if (!state.coreVitals) return state;
      return {
        ...state,
        coreVitals: {
          ...state.coreVitals,
          [action.payload.field]: action.payload.value,
        },
        mlStatus: 'idle',
        mlResult: null,
        mlError: null,
        slmStatus: 'idle',
        slmExplanation: '',
        slmThinking: '',
        slmFinalExplanation: '',
        slmError: null,
      };
    }

    case 'ml-start':
      return {
        ...state,
        mlStatus: 'running',
        mlResult: null,
        mlError: null,
        slmStatus: 'idle',
        slmExplanation: '',
        slmThinking: '',
        slmFinalExplanation: '',
        slmError: null,
      };

    case 'ml-success':
      return {
        ...state,
        mlStatus: 'done',
        mlResult: action.payload.result,
        mlError: null,
      };

    case 'ml-error':
      return {
        ...state,
        mlStatus: 'error',
        mlError: action.payload.error,
      };

    case 'slm-start':
      return {
        ...state,
        slmStatus: 'streaming',
        slmExplanation: '',
        slmThinking: '',
        slmFinalExplanation: '',
        slmError: null,
      };

    case 'slm-token':
      const newExplanation = state.slmExplanation + action.payload.token;
      return {
        ...state,
        slmExplanation: newExplanation,
      };

    case 'slm-success':
      const { thinking, explanation } = parseSLMOutput(state.slmExplanation);
      return {
        ...state,
        slmStatus: 'done',
        slmThinking: thinking,
        slmFinalExplanation: explanation || state.slmExplanation,
      };

    case 'slm-error':
      return {
        ...state,
        slmStatus: 'error',
        slmError: action.payload.error,
      };

    case 'reset':
      return initialState;

    default:
      return state;
  }
}

export function CareManagementScreen() {
  const slm = useSLM();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [mlModel] = useState(() => new AlertAutoencoder());
  const [mlModelLoaded, setMlModelLoaded] = useState(false);

  useEffect(() => {
    mlModel.load().then(() => {
      setMlModelLoaded(mlModel.isLoaded);
    }).catch((err) => {
      console.error('[CareManagement] Failed to auto-load ML model:', err);
    });
    return () => {
      mlModel.release().catch(() => {});
    };
  }, [mlModel]);

  const controller = useMemo(
    () => createCareManagementController(mlModel),
    [mlModel],
  );

  const wrappedDispatch = useCallback(
    (action: CareManagementAction) => {
      if (action.type === 'ml-start') {
        dispatch(action);
        if (state.coreVitals && state.extendedVitals) {
          controller
            .executeMLInference(state.coreVitals, state.extendedVitals)
            .then((resultAction) => dispatch(resultAction));
        }
        return;
      }

      if (action.type === 'slm-start') {
        dispatch(action);
        if (state.coreVitals && state.mlResult) {
          controller
            .executeSLMExplanation(
              state.coreVitals,
              state.mlResult,
              slm.chat,
              (token) => dispatch({ type: 'slm-token', payload: { token } }),
            )
            .then((resultAction) => dispatch(resultAction));
        }
        return;
      }

      dispatch(action);
    },
    [controller, state.coreVitals, state.extendedVitals, state.mlResult, slm.chat],
  );

  return (
    <CareManagementView
      state={state}
      dispatch={wrappedDispatch}
      controller={controller}
      slmStatus={slm.loadStatus}
      slmModelId={slm.currentModelId}
      slmModelSizeGB={slm.modelSizeGB}
      slmLoadError={slm.loadError}
      onLoadSLM={slm.loadModel}
      onUnloadSLM={slm.unloadModel}
      mlModelLoaded={mlModelLoaded}
    />
  );
}
