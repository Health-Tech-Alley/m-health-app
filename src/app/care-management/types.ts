import type { CoreVitals, ExtendedVitals, MLResult } from '@/ml-models/alert-autoencoder/types';

export type MLStatus = 'idle' | 'running' | 'done' | 'error';
export type SLMExplanationStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface CareManagementState {
  selectedScenarioId: string | null;
  coreVitals: CoreVitals | null;
  extendedVitals: ExtendedVitals | null;
  mlStatus: MLStatus;
  mlResult: MLResult | null;
  mlError: string | null;
  slmStatus: SLMExplanationStatus;
  slmExplanation: string;
  slmThinking: string;
  slmFinalExplanation: string;
  slmError: string | null;
  validationErrors: string[];
}

export type CareManagementAction =
  | { type: 'noop' }
  | {
      type: 'select-scenario';
      payload: { scenarioId: string; core: CoreVitals; extended: ExtendedVitals };
    }
  | {
      type: 'update-vitals';
      payload: { field: keyof CoreVitals; value: number };
    }
  | { type: 'ml-start' }
  | { type: 'ml-success'; payload: { result: MLResult } }
  | { type: 'ml-error'; payload: { error: string } }
  | { type: 'slm-start' }
  | { type: 'slm-token'; payload: { token: string } }
  | { type: 'slm-success' }
  | { type: 'slm-error'; payload: { error: string } }
  | { type: 'slm-parse' }
  | { type: 'reset' };
