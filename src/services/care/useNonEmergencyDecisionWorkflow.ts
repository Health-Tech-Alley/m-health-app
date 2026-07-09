import { useCallback } from 'react';

import {
  getAlertById,
  getMlEventForAlert,
  parseRawVitals,
  type MlRawVitalsInputEnvelope,
} from '@/data';
import { useUC2Runtime } from '@/contexts/uc2-runtime-context';
import type {
  CaregiverFinalAction,
  UC2DecisionResult,
} from '@/ml-models/uc2-decision-layer';
import { useAppDispatch } from '@/store/hooks';
import {
  evaluationFailed,
  evaluationStarted,
  evaluationSucceeded,
  evaluationUnavailable,
  resetForAlert,
  type SerializableUC2DecisionResult,
} from '@/store/reducers/nonEmergencyDecisionSlice';

const CARD_REASON_TO_UC2_CODE: Record<string, string> = {
  increased_activity: 'EXERCISE_ACTIVITY',
  poor_sleep: 'POOR_SLEEP',
  stress_emotional_upset: 'STRESS',
  eating_drinking_less: 'LOW_INTAKE',
  medication_change: 'MED_CHANGE',
  bathroom_changes: 'BATHROOM_CHANGE',
  vomiting_diarrhea: 'VOMITING_DIARRHEA',
  tired_weak_confused_not_normal: 'WEAK_CONFUSED',
  pain_discomfort: 'PAIN',
  breathing_different: 'BREATHING_CHANGE',
  sensor_issue: 'SENSOR_ISSUE',
  nothing_unusual: 'NOTHING_UNUSUAL',
  not_sure: 'NOT_SURE',
};

type EvaluateSavedResponseParams = {
  alertId: string;
  patientId: string;
  caregiverActionId: string;
  selectedReasonCodes: string[];
};

function isAppleWatchVitalsEnvelope(
  value: unknown,
): value is MlRawVitalsInputEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<MlRawVitalsInputEnvelope>;
  return (
    envelope.contract === 'AppleWatchVitalsInput' &&
    envelope.contractVersion === 1 &&
    !!envelope.input &&
    typeof envelope.input === 'object' &&
    typeof envelope.input.patient_id === 'string' &&
    typeof envelope.input.timestamp === 'string'
  );
}

function toSerializableDecision(result: UC2DecisionResult): SerializableUC2DecisionResult {
  return {
    finalSeverity: result.finalDecision.final_severity,
    finalAnomalyType: result.postHitlAnomalyType,
    notificationType: result.finalDecision.final_notification_type,
    notificationTitle: result.finalDecision.final_notification_title,
    notificationBody: result.finalDecision.final_notification_body,
    escalationRequired: result.finalDecision.final_severity === 3,
    promptShown: result.promptShown,
    threshold: result.threshold,
    aeScore: result.aeScore,
  };
}

export function useNonEmergencyDecisionWorkflow() {
  const dispatch = useAppDispatch();
  const { runtime, ready: runtimeReady } = useUC2Runtime();

  const resetDecisionWorkflow = useCallback(
    (patientId: string, alertId: string) => {
      dispatch(resetForAlert({ patientId, alertId }));
    },
    [dispatch],
  );

  const evaluateSavedResponse = useCallback(
    async ({
      alertId,
      patientId,
      caregiverActionId,
      selectedReasonCodes,
    }: EvaluateSavedResponseParams) => {
      const requestId = `non-emergency-${Date.now()}-${caregiverActionId}`;
      const workflowKey = { alertId, patientId, caregiverActionId, requestId };
      const caregiverFinalAction: CaregiverFinalAction = 'dismiss';

      dispatch(evaluationStarted(workflowKey));

      const unavailable = (reason: string) => {
        dispatch(evaluationUnavailable({ ...workflowKey, reason }));
      };

      try {
        if (!runtimeReady) {
          unavailable('uc2_runtime_unavailable');
          return;
        }

        const alert = getAlertById(alertId);
        if (!alert || alert.patientId !== patientId) {
          unavailable('alert_patient_mismatch');
          return;
        }

        if (alert.severity !== 1 && alert.severity !== 2) {
          unavailable('unsupported_alert_severity');
          return;
        }

        const mlEvent = getMlEventForAlert(alertId);
        if (!mlEvent) {
          unavailable('missing_ml_event');
          return;
        }

        if (mlEvent.alertId !== alertId || mlEvent.patientId !== patientId) {
          unavailable('ml_event_mismatch');
          return;
        }

        const rawVitals = parseRawVitals(mlEvent);
        if (!isAppleWatchVitalsEnvelope(rawVitals)) {
          unavailable('unsupported_raw_vitals');
          return;
        }

        if (rawVitals.input.patient_id !== patientId) {
          unavailable('raw_vitals_patient_mismatch');
          return;
        }

        const caregiverSelectedCodes = selectedReasonCodes
          .map((code) => CARD_REASON_TO_UC2_CODE[code])
          .filter((code): code is string => typeof code === 'string');

        const result = await runtime.evaluateUC2WithExistingRuntime({
          eventId: `uc2-home-${mlEvent.eventId}`,
          vitals: rawVitals.input,
          caregiverFinalAction,
          caregiverSelectedCodes,
        });

        dispatch(
          evaluationSucceeded({
            ...workflowKey,
            decision: toSerializableDecision(result),
          }),
        );
      } catch (err: unknown) {
        dispatch(
          evaluationFailed({
            ...workflowKey,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    },
    [dispatch, runtime, runtimeReady],
  );

  return { evaluateSavedResponse, resetDecisionWorkflow };
}
