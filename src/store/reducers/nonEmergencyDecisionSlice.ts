import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { RootState } from '@/store';

export type SerializableUC2DecisionResult = {
  finalSeverity: 0 | 1 | 2 | 3;
  finalAnomalyType: string;
  notificationType: string;
  notificationTitle: string;
  notificationBody: string;
  escalationRequired: boolean;
  promptShown: boolean;
  threshold: number;
  aeScore: number | null;
};

export type NonEmergencyDecisionStatus =
  | 'idle'
  | 'evaluating'
  | 'ready'
  | 'unavailable'
  | 'failed';

export type NonEmergencyDecisionState = {
  patientId: string | null;
  alertId: string | null;
  caregiverActionId: string | null;
  status: NonEmergencyDecisionStatus;
  decision: SerializableUC2DecisionResult | null;
  unavailableReason: string | null;
  error: string | null;
  requestId: string | null;
};

const initialState: NonEmergencyDecisionState = {
  patientId: null,
  alertId: null,
  caregiverActionId: null,
  status: 'idle',
  decision: null,
  unavailableReason: null,
  error: null,
  requestId: null,
};

type WorkflowKey = {
  patientId: string;
  alertId: string;
  caregiverActionId: string;
  requestId: string;
};

function matchesActiveRequest(
  state: NonEmergencyDecisionState,
  payload: WorkflowKey,
): boolean {
  return (
    state.patientId === payload.patientId &&
    state.alertId === payload.alertId &&
    state.caregiverActionId === payload.caregiverActionId &&
    state.requestId === payload.requestId
  );
}

const nonEmergencyDecisionSlice = createSlice({
  name: 'nonEmergencyDecision',
  initialState,
  reducers: {
    resetForAlert: (
      state,
      action: PayloadAction<{ patientId: string; alertId: string }>,
    ) => {
      state.patientId = action.payload.patientId;
      state.alertId = action.payload.alertId;
      state.caregiverActionId = null;
      state.status = 'idle';
      state.decision = null;
      state.unavailableReason = null;
      state.error = null;
      state.requestId = null;
    },
    evaluationStarted: (state, action: PayloadAction<WorkflowKey>) => {
      state.patientId = action.payload.patientId;
      state.alertId = action.payload.alertId;
      state.caregiverActionId = action.payload.caregiverActionId;
      state.status = 'evaluating';
      state.decision = null;
      state.unavailableReason = null;
      state.error = null;
      state.requestId = action.payload.requestId;
    },
    evaluationSucceeded: (
      state,
      action: PayloadAction<WorkflowKey & { decision: SerializableUC2DecisionResult }>,
    ) => {
      if (!matchesActiveRequest(state, action.payload)) return;
      state.status = 'ready';
      state.decision = action.payload.decision;
      state.unavailableReason = null;
      state.error = null;
    },
    evaluationUnavailable: (
      state,
      action: PayloadAction<WorkflowKey & { reason: string }>,
    ) => {
      if (!matchesActiveRequest(state, action.payload)) return;
      state.status = 'unavailable';
      state.decision = null;
      state.unavailableReason = action.payload.reason;
      state.error = null;
    },
    evaluationFailed: (
      state,
      action: PayloadAction<WorkflowKey & { error: string }>,
    ) => {
      if (!matchesActiveRequest(state, action.payload)) return;
      state.status = 'failed';
      state.decision = null;
      state.unavailableReason = null;
      state.error = action.payload.error;
    },
  },
});

export const {
  resetForAlert,
  evaluationStarted,
  evaluationSucceeded,
  evaluationUnavailable,
  evaluationFailed,
} = nonEmergencyDecisionSlice.actions;

export function selectNonEmergencyDecisionForAlert(
  state: RootState,
  patientId: string,
  alertId: string,
): NonEmergencyDecisionState {
  const workflow = state.nonEmergencyDecision;
  if (workflow.patientId !== patientId || workflow.alertId !== alertId) {
    return initialState;
  }
  return workflow;
}

export default nonEmergencyDecisionSlice.reducer;
