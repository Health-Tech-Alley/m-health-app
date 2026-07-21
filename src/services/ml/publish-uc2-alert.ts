/**
 * Publish a UC2 Health Monitor result onto the orchestration bus as
 * `ml_alert_created` so Dashboard / Alerts log / CriticalAlert pick it up —
 * same path as Care Analysis "Publish to Concierge".
 */
import type { MlRawVitalsInputEnvelope } from '@/data';
import type {
  AppleWatchVitalsInput,
  UC2DecisionResult,
} from '@/ml-models/uc2-decision-layer';
import { getEventBus } from '@/orchestration/event-bus';
import type { OrchestrationEvent } from '@/orchestration/events';

export type PublishUc2AlertOptions = {
  patientId: string;
  result: UC2DecisionResult;
  input: AppleWatchVitalsInput;
  /** Prefix for alert id (e.g. chat-hm, cm-alert). */
  alertIdPrefix?: string;
  /** Extra caregiver block (HITL observations). */
  caregiverBlock?: {
    action?: string;
    confirmed?: boolean;
    observations?: string[];
  };
};

/**
 * Returns true if an alert event was published.
 * Skips non-anomalous / non-emergency severity-0 results.
 */
export function publishUc2ResultAsAlert(
  options: PublishUc2AlertOptions,
): boolean {
  const { patientId, result, input, alertIdPrefix = 'hm-alert', caregiverBlock } =
    options;
  if (!patientId?.trim()) return false;

  const severity = result.finalDecision?.final_severity ?? result.post_hitl_severity ?? 0;
  if (
    (severity !== 1 && severity !== 2 && severity !== 3) ||
    (!result.isAnomaly && !result.emergencyResult?.emergency)
  ) {
    return false;
  }

  try {
    const bus = getEventBus();
    const now = new Date().toISOString();
    const safeAlertId =
      `${alertIdPrefix}-${patientId}-${Date.now()}`.replace(
        /[^A-Za-z0-9_.:-]/g,
        '-',
      );
    const scoreRatio =
      result.aeScore !== null &&
      result.aeScore !== undefined &&
      result.threshold > 0
        ? result.aeScore / result.threshold
        : undefined;

    const rawVitals: MlRawVitalsInputEnvelope = {
      contract: 'AppleWatchVitalsInput',
      contractVersion: 1,
      input: {
        ...input,
        patient_id: patientId,
        timestamp: input.timestamp ?? now,
      },
      provenance: {},
      evaluatedAt: input.timestamp ?? now,
    };

    const event: Extract<OrchestrationEvent, { type: 'ml_alert_created' }> = {
      type: 'ml_alert_created',
      alertId: safeAlertId,
      patientId,
      severity: severity as 1 | 2 | 3,
      score: result.aeScore ?? result.ae_score_mse ?? 0,
      features: result.rawFeatures ?? [],
      at: now,
      eventType: 'TRIGGER_WORKFLOW_ANOMALY_TYPE_04',
      modelVersion: 'tiny_ae_uc2_v0.1.0',
      threshold: result.threshold,
      reconstructionError: result.aeScore ?? result.ae_score_mse ?? undefined,
      topFeatures: (result.topFeatureEvidence ?? []).map((feature) => [
        feature.feature,
        feature.importance,
      ]),
      ruleEngine: {
        is_emergency: Boolean(result.emergencyResult?.emergency),
        severity: result.emergencyResult?.severity ?? 0,
        reasons: result.emergencyResult?.reason
          ? [result.emergencyResult.reason]
          : (result.emergencyResult?.reasons ?? []),
      },
      caregiverBlock,
      rawVitals,
      pipelinePath: result.emergencyResult?.pipelinePath,
      initialAnomalyType: String(result.initialAnomalyType ?? ''),
      postHitlAnomalyType: String(
        result.postHitlAnomalyType ??
          result.post_hitl_anomaly_type ??
          result.initialAnomalyType ??
          '',
      ),
      featureQuality: result.featureQuality as Record<string, string> | undefined,
      scoreRatio,
      notificationTitle:
        result.finalDecision?.final_notification_title || undefined,
      notificationBody:
        result.finalDecision?.final_notification_body || undefined,
    };
    bus.publish(event);
    try {
      const { drainPendingProposalsForPatient } = require('../carePlan/mlPlanProposalService') as typeof import('../carePlan/mlPlanProposalService');
      drainPendingProposalsForPatient(patientId, 'uc2');
    } catch (drainErr) {
      console.warn(
        '[publishUc2ResultAsAlert] ADCP proposal drain failed:',
        drainErr instanceof Error ? drainErr.message : drainErr,
      );
    }
    return true;
  } catch (err) {
    console.warn('[publishUc2ResultAsAlert] failed:', err);
    return false;
  }
}

/** Build AppleWatchVitalsInput from chat hypothetical vitals args. */
export function vitalsArgsToAppleWatchInput(
  patientId: string,
  args: Partial<{
    heart_rate: number;
    blood_oxygen: number;
    blood_pressure_systolic: number;
    blood_pressure_diastolic: number;
    glucose_level: number;
    body_temperature: number;
    respiratory_rate: number;
  }>,
): AppleWatchVitalsInput {
  return {
    patient_id: patientId,
    timestamp: new Date().toISOString(),
    heart_rate: args.heart_rate,
    blood_oxygen: args.blood_oxygen,
    blood_pressure_systolic: args.blood_pressure_systolic,
    blood_pressure_diastolic: args.blood_pressure_diastolic,
    glucose_level: args.glucose_level,
    body_temperature: args.body_temperature,
    respiratory_rate: args.respiratory_rate,
    steps_count: undefined,
  };
}
