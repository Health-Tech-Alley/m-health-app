import { getPatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';
import { getEventBus } from '@/orchestration/event-bus';
import { buildUc3InputsFromSnapshot } from '@/ml-models/uc3-rehab-trajectory/uc3SnapshotAdapter';
import {
  evaluateRehabTrajectory,
  buildCaregiverMessage,
  buildClinicianSummary,
  buildShareRecordPayload,
  type RehabDecision,
} from '@/ml-models/uc3-rehab-trajectory';
import {
  insertUc3TrajectoryResult,
  setUc3TrajectoryLinkedAlertId,
} from '@/data/repositories/uc3TrajectoryResultRepository';
import { publishUc3ResultAsAlert } from './publish-uc3-trajectory-alert';

export async function evaluateAndPersistUc3(patientId: string): Promise<{
  resultId: string;
  decision: RehabDecision;
  linkedAlertId?: string;
}> {
  const snapshot = getPatientRecordSnapshot(patientId);
  const inputs = buildUc3InputsFromSnapshot(snapshot);
  const decision = evaluateRehabTrajectory(inputs.plan, inputs.logs, inputs.ehrContext);
  const caregiverMessage = buildCaregiverMessage(decision, inputs.plan);
  const clinicianSummary = buildClinicianSummary(decision, inputs.plan);
  const sharePayload = buildShareRecordPayload(
    decision, inputs.plan, caregiverMessage, clinicianSummary,
  );

  const resultId = `uc3-result-${patientId}-${Date.now()}`;

  insertUc3TrajectoryResult({
    id: resultId,
    patientId,
    carePlanId: snapshot.carePlan?.planId ?? null,
    modelFamily: decision.modelFamily,
    modelVersion: decision.modelVersion,
    generatedAt: decision.generatedAt,
    inputWindowStart: inputs.inputWindow.start,
    inputWindowEnd: inputs.inputWindow.end,
    eventType: decision.eventType,
    severity: decision.severity,
    requiresHumanReview: decision.requiresHumanReview,
    emergencyThresholdBreach: decision.emergencyThresholdBreach,
    reviewPriorityScore: decision.reviewPriorityScore,
    reasonCodesJson: JSON.stringify(decision.reasonCodes),
    explanationsJson: JSON.stringify(decision.explanations),
    metricAnalysesJson: JSON.stringify(decision.metricAnalyses),
    dataQualityJson: JSON.stringify(decision.dataQuality),
    caregiverMessage,
    clinicianSummary,
    sharePayloadJson: JSON.stringify(sharePayload),
  });

  let linkedAlertId: string | undefined;
  if (decision.requiresHumanReview || decision.emergencyThresholdBreach) {
    linkedAlertId = publishUc3ResultAsAlert({
      patientId,
      resultId,
      decision,
      caregiverMessage,
    });
    if (linkedAlertId) {
      setUc3TrajectoryLinkedAlertId(resultId, linkedAlertId);
    }
  }

  try {
    getEventBus().publish({
      type: 'uc3_trajectory_evaluated',
      patientId,
      resultId,
      eventType: decision.eventType,
      severity: decision.severity,
      requiresHumanReview: decision.requiresHumanReview,
      emergencyThresholdBreach: decision.emergencyThresholdBreach,
      linkedAlertId,
      at: new Date().toISOString(),
    });
  } catch { /* bus may not be initialized */ }

  return { resultId, decision, linkedAlertId };
}
