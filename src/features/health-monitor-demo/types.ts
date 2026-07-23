import type {
  CaregiverHitlInput,
  DecisionLayerResult,
  HistoricalAnomalyEvent,
  PatientProfile,
  RawObservationInput,
  UC2DecisionResult,
} from '@/ml-models/uc2-decision-layer';

export type V2Toggle = {
  useEhrThresholds: boolean;
  useHitlMatrix: boolean;
  useRecurrence: boolean;
  usePersonalizedThresholds: boolean;
};

export type DemoStatus = 'idle' | 'running' | 'done' | 'error';

export type SLMStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface HealthMonitorDemoState {
  selectedFixtureId: string | null;
  raw: RawObservationInput | null;
  profile: PatientProfile | null;
  caregiverInput: CaregiverHitlInput | null;
  history: HistoricalAnomalyEvent[];
  toggles: V2Toggle;
  v2Result: DecisionLayerResult | null;
  v1Result: UC2DecisionResult | null;
  status: DemoStatus;
  error: string | null;
  slmStatus: SLMStatus;
  slmExplanation: string;
  slmFinalText: string;
  slmError: string | null;
}

export type HealthMonitorDemoAction =
  | { type: 'select-fixture'; payload: { fixtureId: string; raw: RawObservationInput; profile: PatientProfile; caregiver?: CaregiverHitlInput; history?: HistoricalAnomalyEvent[] } }
  | { type: 'toggle'; payload: { key: keyof V2Toggle; value: boolean } }
  | { type: 'run-start' }
  | { type: 'run-success'; payload: { v2: DecisionLayerResult; v1: UC2DecisionResult } }
  | { type: 'run-error'; payload: { error: string } }
  | { type: 'slm-start' }
  | { type: 'slm-token'; payload: { token: string } }
  | { type: 'slm-success'; payload: { answer: string } }
  | { type: 'slm-error'; payload: { error: string } }
  | { type: 'slm-clear' }
  | { type: 'reset' };

export function reducer(state: HealthMonitorDemoState, action: HealthMonitorDemoAction): HealthMonitorDemoState {
  switch (action.type) {
    case 'select-fixture':
      return {
        ...state,
        selectedFixtureId: action.payload.fixtureId,
        raw: action.payload.raw,
        profile: action.payload.profile,
        caregiverInput: action.payload.caregiver ?? null,
        history: action.payload.history ?? [],
        v2Result: null,
        v1Result: null,
        status: 'idle',
        error: null,
        slmStatus: 'idle',
        slmExplanation: '',
        slmFinalText: '',
        slmError: null,
      };
    case 'toggle':
      return {
        ...state,
        toggles: { ...state.toggles, [action.payload.key]: action.payload.value },
      };
    case 'run-start':
      return { ...state, status: 'running', error: null };
    case 'run-success':
      return {
        ...state,
        status: 'done',
        v2Result: action.payload.v2,
        v1Result: action.payload.v1,
      };
    case 'run-error':
      return { ...state, status: 'error', error: action.payload.error };
    case 'slm-start':
      return { ...state, slmStatus: 'streaming', slmExplanation: '', slmError: null };
    case 'slm-token':
      return { ...state, slmExplanation: state.slmExplanation + action.payload.token };
    case 'slm-success':
      return { ...state, slmStatus: 'done', slmFinalText: action.payload.answer };
    case 'slm-error':
      return { ...state, slmStatus: 'error', slmError: action.payload.error };
    case 'slm-clear':
      return { ...state, slmStatus: 'idle', slmExplanation: '', slmFinalText: '', slmError: null };
    case 'reset':
      return initialState;
    default:
      return state;
  }
}

export const initialState: HealthMonitorDemoState = {
  selectedFixtureId: null,
  raw: null,
  profile: null,
  caregiverInput: null,
  history: [],
  toggles: {
    useEhrThresholds: true,
    useHitlMatrix: true,
    useRecurrence: true,
    usePersonalizedThresholds: true,
  },
  v2Result: null,
  v1Result: null,
  status: 'idle',
  error: null,
  slmStatus: 'idle',
  slmExplanation: '',
  slmFinalText: '',
  slmError: null,
};
