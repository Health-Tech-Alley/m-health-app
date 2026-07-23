import type { CoreVitals, ExtendedVitals } from '@/ml-models/alert-autoencoder/types';
import type {
  CaregiverFinalAction,
  UC2DecisionResult,
} from '@/ml-models/uc2-decision-layer';

export type MLStatus = 'idle' | 'running' | 'done' | 'error';
export type SLMExplanationStatus = 'idle' | 'streaming' | 'done' | 'error';

/** One row of the batch parity runner. */
export interface BatchParityRow {
  scenarioId: string;
  scenarioName: string;
  expectedPipelinePath?: string;
  actualPipelinePath?: string;
  expectedInitialAnomalyType?: string;
  actualInitialAnomalyType?: string;
  expectedPostHitlAnomalyType?: string;
  actualPostHitlAnomalyType?: string;
  expectedFinalNotificationType?: string;
  actualFinalNotificationType?: string;
  expectedSeverity?: number;
  actualSeverity?: number;
  expectedEmergencyReason?: string;
  actualEmergencyReason?: string | null;
  pass: boolean;
  error?: string;
}

export interface CareManagementState {
  selectedScenarioId: string | null;
  /** The six core vitals (editable inline). */
  coreVitals: CoreVitals | null;
  /** The full extended vitals set (13 observed features; editable in the
   *  18-feature editor). When present this is the source of truth for the
   *  UC2 input; coreVitals is a derived view of the six core fields. */
  extendedVitals: ExtendedVitals | null;
  /** Hour-of-day (0-23) driving the derived time features. */
  hour: number;
  /** Fields the user has marked "missing" so the UC2 imputation path fills
   *  them and tags them `imputed` in the feature-quality provenance. */
  missingFields: (keyof ExtendedVitals)[];
  mlStatus: MLStatus;
  /** Latest UC2 decision result (pre- or post-HITL). */
  uc2Result: UC2DecisionResult | null;
  /** Saved pre-HITL result, kept so the UI can diff against the post-HITL run. */
  initialUc2Result: UC2DecisionResult | null;
  mlError: string | null;
  /** Caregiver-selected observation codes (UC2 HITL taxonomy). */
  observationCodes: string[];
  /** Caregiver final action applied on "Apply HITL". */
  caregiverAction: CaregiverFinalAction;
  /** When true, the next UC2 run also publishes to the orchestrator so a real
   *  alert + notification is created and the Dashboard updates. */
  publishToOrchestrator: boolean;
  /** Batch parity runner state. */
  batchRunning: boolean;
  batchRows: BatchParityRow[];
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
      payload: {
        scenarioId: string;
        core: CoreVitals;
        extended: ExtendedVitals;
        hour: number;
        missingFields: (keyof ExtendedVitals)[];
        observationCodes: string[];
        caregiverAction: CaregiverFinalAction;
      };
    }
  | { type: 'update-vitals'; payload: { field: keyof CoreVitals; value: number } }
  | { type: 'update-extended'; payload: { field: keyof ExtendedVitals; value: number } }
  | { type: 'toggle-missing'; payload: { field: keyof ExtendedVitals } }
  | { type: 'set-hour'; payload: { hour: number } }
  | { type: 'ml-start' }
  | { type: 'hitl-apply' }
  | { type: 'uc2-success'; payload: { result: UC2DecisionResult; saveAsInitial: boolean } }
  | { type: 'ml-error'; payload: { error: string } }
  | { type: 'set-observation-codes'; payload: { codes: string[] } }
  | { type: 'set-caregiver-action'; payload: { action: CaregiverFinalAction } }
  | { type: 'set-publish'; payload: { enabled: boolean } }
  | { type: 'batch-start' }
  | { type: 'batch-done'; payload: { rows: BatchParityRow[] } }
  | { type: 'slm-start' }
  | { type: 'slm-token'; payload: { token: string } }
  | { type: 'slm-success'; payload: { answer: string; thinking: string | null } }
  | { type: 'slm-clear' }
  | { type: 'slm-error'; payload: { error: string } }
  | { type: 'reset' };
