import type { LatestUc3TrajectoryResultSummary, PatientRecordSnapshot } from '../../data/types';
import {
  getUc3TrajectoryResultById,
  saveUc3TrajectoryResult,
} from '../../data/repositories/uc3TrajectoryResultRepository';
import { evaluateRehabTrajectory, type RehabDecision } from '../../ml-models/uc3-rehab';
import {
  adaptPatientRecordSnapshotToUC3Input,
  type UC3AdapterIssue,
} from './uc3PatientStateAdapter';
import { getEventBus } from '../../orchestration/event-bus';

export type Uc3EvaluationSuccess = {
  status: 'success';
  evaluationKey: string;
  decision: RehabDecision;
  persistedResult: LatestUc3TrajectoryResultSummary;
  inserted: boolean;
  warnings: UC3AdapterIssue[];
};

export type Uc3EvaluationNotReady = {
  status: 'not_ready';
  evaluationKey: string;
  errors: UC3AdapterIssue[];
  warnings: UC3AdapterIssue[];
};

export type Uc3EvaluationFailure = {
  status: 'adapter_error' | 'engine_error' | 'persistence_error';
  evaluationKey: string;
  message: string;
  warnings: UC3AdapterIssue[];
  decision?: RehabDecision;
};

export type Uc3EvaluationServiceResult =
  | Uc3EvaluationSuccess
  | Uc3EvaluationNotReady
  | Uc3EvaluationFailure;

export type Uc3EvaluationServiceOptions = {
  evaluationKey: string;
  now?: Date;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inputWindowDates(logs: Array<{ date?: string }>): {
  inputWindowStart: string | null;
  inputWindowEnd: string | null;
} {
  const dates = logs
    .map((log) => log.date)
    .filter((date): date is string => Boolean(date))
    .sort();
  return {
    inputWindowStart: dates[0] ?? null,
    inputWindowEnd: dates[dates.length - 1] ?? null,
  };
}

function resultIdFor(
  patientId: string,
  carePlanId: string,
  modelVersion: string,
  evaluationKey: string,
): string {
  return `uc3:${patientId}:${carePlanId}:${modelVersion}:${evaluationKey}`;
}

function publishUc3PersistedResult(
  result: LatestUc3TrajectoryResultSummary,
  inserted: boolean,
): void {
  try {
    getEventBus().publish({
      type: 'uc3_trajectory_evaluated',
      patientId: result.patientId,
      resultId: result.resultId,
      carePlanId: result.carePlanId,
      eventType: result.eventType,
      severity: result.severity,
      requiresHumanReview: result.requiresHumanReview,
      emergencyThresholdBreach: result.emergencyThresholdBreach,
      inserted,
      generatedAt: result.generatedAt,
      at: new Date().toISOString(),
    });
  } catch {
    /* event bus may not be initialized in isolated tests */
  }
}

export function evaluateAndPersistUc3Trajectory(
  snapshot: PatientRecordSnapshot,
  options: Uc3EvaluationServiceOptions,
): Uc3EvaluationServiceResult {
  const { evaluationKey, now = new Date() } = options;

  let adapterResult: ReturnType<typeof adaptPatientRecordSnapshotToUC3Input>;
  try {
    adapterResult = adaptPatientRecordSnapshotToUC3Input(snapshot, now);
  } catch (error) {
    return {
      status: 'adapter_error',
      evaluationKey,
      message: errorMessage(error),
      warnings: [],
    };
  }

  if (adapterResult.status === 'not_ready') {
    return {
      status: 'not_ready',
      evaluationKey,
      errors: adapterResult.errors,
      warnings: adapterResult.warnings,
    };
  }

  const { patient, plan, logs, ehrContext } = adapterResult.input;
  let decision: RehabDecision;
  try {
    decision = evaluateRehabTrajectory(plan, logs, ehrContext);
  } catch (error) {
    return {
      status: 'engine_error',
      evaluationKey,
      message: errorMessage(error),
      warnings: adapterResult.warnings,
    };
  }

  try {
    const { inputWindowStart, inputWindowEnd } = inputWindowDates(logs);
    const saved = saveUc3TrajectoryResult({
      resultId: resultIdFor(patient.patientId, plan.planId, decision.modelVersion, evaluationKey),
      patientId: patient.patientId,
      carePlanId: plan.planId,
      modelFamily: decision.modelFamily,
      modelVersion: decision.modelVersion,
      inputFingerprint: evaluationKey,
      generatedAt: decision.generatedAt,
      inputWindowStart,
      inputWindowEnd,
      eventType: decision.eventType,
      severity: decision.severity,
      requiresHumanReview: decision.requiresHumanReview,
      emergencyThresholdBreach: decision.emergencyThresholdBreach,
      reviewPriorityScore: decision.reviewPriorityScore,
      reasonCodes: decision.reasonCodes,
      explanations: decision.explanations,
      metricAnalysesJson: JSON.stringify(decision.metricAnalyses),
      dataQualityJson: JSON.stringify(decision.dataQuality),
    });
    const persistedResult = getUc3TrajectoryResultById(saved.resultId);
    if (!persistedResult) {
      throw new Error(`UC3 result ${saved.resultId} was saved but could not be re-read.`);
    }
    publishUc3PersistedResult(persistedResult, saved.inserted);
    try {
      const { drainPendingProposalsForPatient } = require('../carePlan/mlPlanProposalService') as typeof import('../carePlan/mlPlanProposalService');
      drainPendingProposalsForPatient(patient.patientId, 'uc3');
    } catch (err) {
      console.warn('[UC3] ADCP proposal drain failed:', err instanceof Error ? err.message : err);
    }
    return {
      status: 'success',
      evaluationKey,
      decision,
      persistedResult,
      inserted: saved.inserted,
      warnings: adapterResult.warnings,
    };
  } catch (error) {
    return {
      status: 'persistence_error',
      evaluationKey,
      message: errorMessage(error),
      warnings: adapterResult.warnings,
      decision,
    };
  }
}
