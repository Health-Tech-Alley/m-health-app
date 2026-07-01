import { useCallback, useMemo, useReducer } from 'react';

import { usePatientRecord } from '@/contexts/patient-record-context';
import { useSLM } from '@/contexts/slm-context';
import { useUC2Runtime } from '@/contexts/uc2-runtime-context';
import { createCareManagementController } from './care-management-controller';
import type { CareManagementAction, CareManagementState } from './types';
import { CareManagementView } from './care-management-view';

const initialState: CareManagementState = {
  selectedScenarioId: null,
  coreVitals: null,
  extendedVitals: null,
  hour: 13,
  missingFields: [],
  mlStatus: 'idle',
  uc2Result: null,
  initialUc2Result: null,
  mlError: null,
  observationCodes: [],
  caregiverAction: 'no_prompt_shown',
  publishToOrchestrator: false,
  batchRunning: false,
  batchRows: [],
  slmStatus: 'idle',
  slmExplanation: '',
  slmThinking: '',
  slmFinalExplanation: '',
  slmError: null,
  validationErrors: [],
};

function reducer(state: CareManagementState, action: CareManagementAction): CareManagementState {
  switch (action.type) {
    case 'noop':
      return state;

    case 'select-scenario':
      return {
        ...initialState,
        // Preserve the publish toggle across scenario changes — it's a
        // harness-level setting, not a per-scenario one.
        publishToOrchestrator: state.publishToOrchestrator,
        selectedScenarioId: action.payload.scenarioId,
        coreVitals: action.payload.core,
        extendedVitals: action.payload.extended,
        hour: action.payload.hour,
        missingFields: action.payload.missingFields,
        observationCodes: action.payload.observationCodes,
        caregiverAction: action.payload.caregiverAction,
      };

    case 'update-vitals': {
      if (!state.coreVitals) return state;
      const coreVitals = {
        ...state.coreVitals,
        [action.payload.field]: action.payload.value,
      };
      // Keep the extended vitals in sync with the six core fields so the UC2
      // input builder always sees consistent values.
      const extendedVitals = state.extendedVitals
        ? { ...state.extendedVitals, ...coreVitals }
        : null;
      return resetResult({
        ...state,
        coreVitals,
        extendedVitals,
      });
    }

    case 'update-extended': {
      if (!state.extendedVitals) return state;
      const extendedVitals = {
        ...state.extendedVitals,
        [action.payload.field]: action.payload.value,
      };
      // If the edited field is one of the six core vitals, mirror it.
      const coreVitals = state.coreVitals
        ? { ...state.coreVitals, ...pickCore(extendedVitals) }
        : null;
      return resetResult({
        ...state,
        extendedVitals,
        coreVitals,
      });
    }

    case 'toggle-missing': {
      const field = action.payload.field;
      const present = state.missingFields.includes(field);
      const missingFields = present
        ? state.missingFields.filter((f) => f !== field)
        : [...state.missingFields, field];
      return resetResult({ ...state, missingFields });
    }

    case 'set-hour':
      return resetResult({ ...state, hour: action.payload.hour });

    case 'ml-start':
      return {
        ...state,
        mlStatus: 'running',
        uc2Result: null,
        initialUc2Result: null,
        mlError: null,
        slmStatus: 'idle',
        slmExplanation: '',
        slmThinking: '',
        slmFinalExplanation: '',
        slmError: null,
      };

    case 'hitl-apply':
      return {
        ...state,
        mlStatus: 'running',
        mlError: null,
      };

    case 'uc2-success':
      return {
        ...state,
        mlStatus: 'done',
        uc2Result: action.payload.result,
        initialUc2Result: action.payload.saveAsInitial
          ? action.payload.result
          : state.initialUc2Result,
        mlError: null,
      };

    case 'ml-error':
      return {
        ...state,
        mlStatus: 'error',
        mlError: action.payload.error,
      };

    case 'set-observation-codes':
      return { ...state, observationCodes: action.payload.codes };

    case 'set-caregiver-action':
      return { ...state, caregiverAction: action.payload.action };

    case 'set-publish':
      return { ...state, publishToOrchestrator: action.payload.enabled };

    case 'batch-start':
      return { ...state, batchRunning: true, batchRows: [] };

    case 'batch-done':
      return { ...state, batchRunning: false, batchRows: action.payload.rows };

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
      return {
        ...state,
        slmExplanation: state.slmExplanation + action.payload.token,
      };

    case 'slm-success': {
      return {
        ...state,
        slmStatus: 'done',
        slmThinking: action.payload.thinking ?? '',
        slmFinalExplanation: action.payload.answer,
      };
    }

    case 'slm-clear':
      return {
        ...state,
        slmStatus: 'idle',
        slmExplanation: '',
        slmThinking: '',
        slmFinalExplanation: '',
        slmError: null,
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

function pickCore(extended: import('@/ml-models/alert-autoencoder/types').ExtendedVitals) {
  return {
    heart_rate: extended.heart_rate,
    blood_oxygen: extended.blood_oxygen,
    blood_pressure_systolic: extended.blood_pressure_systolic,
    blood_pressure_diastolic: extended.blood_pressure_diastolic,
    glucose_level: extended.glucose_level,
    body_temperature: extended.body_temperature,
  };
}

function resetResult(state: CareManagementState): CareManagementState {
  return {
    ...state,
    mlStatus: 'idle',
    uc2Result: null,
    initialUc2Result: null,
    mlError: null,
    slmStatus: 'idle',
    slmExplanation: '',
    slmThinking: '',
    slmFinalExplanation: '',
    slmError: null,
  };
}

export function CareManagementScreen() {
  const slm = useSLM();
  const { model: mlModel, ready: mlModelLoaded, error: mlModelError } = useUC2Runtime();
  const { patientId } = usePatientRecord();
  const [state, dispatch] = useReducer(reducer, initialState);

  const controller = useMemo(
    () => createCareManagementController(mlModel),
    [mlModel],
  );

  const wrappedDispatch = useCallback(
    (action: CareManagementAction) => {
      if (action.type === 'ml-start') {
        dispatch(action);
        if (mlModelError) {
          dispatch({ type: 'ml-error', payload: { error: mlModelError } });
          return;
        }
        controller
          .executeUC2Decision(state, patientId)
          .then((resultAction) => dispatch(resultAction));
        return;
      }

      if (action.type === 'hitl-apply') {
        dispatch(action);
        if (mlModelError) {
          dispatch({ type: 'ml-error', payload: { error: mlModelError } });
          return;
        }
        controller
          .executeApplyHITL(state, patientId)
          .then((resultAction) => dispatch(resultAction));
        return;
      }

      if (action.type === 'batch-start') {
        dispatch(action);
        controller
          .executeBatchParity()
          .then((resultAction) => dispatch(resultAction));
        return;
      }

      if (action.type === 'slm-start') {
        dispatch(action);
        if (state.uc2Result) {
          controller
            .executeSLMExplanation(
              state,
              slm.chat,
              (token) => dispatch({ type: 'slm-token', payload: { token } }),
            )
            .then((resultAction) => dispatch(resultAction));
        }
        return;
      }

      dispatch(action);
    },
    [controller, mlModelError, patientId, state, slm.chat],
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
