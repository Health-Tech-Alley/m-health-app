import { getDatabase } from '../db';
import type {
  LatestUc3TrajectoryResultSummary,
  Uc3TrajectoryDataQualitySummary,
  Uc3TrajectoryMetricAnalysisSummary,
  Uc3TrajectoryResultStatus,
} from '../types';

export type SaveUc3TrajectoryResultInput = {
  resultId: string;
  patientId: string;
  carePlanId: string;
  modelFamily: string;
  modelVersion: string;
  inputFingerprint: string;
  generatedAt: string;
  inputWindowStart?: string | null;
  inputWindowEnd?: string | null;
  eventType: string;
  severity: string;
  requiresHumanReview: boolean;
  emergencyThresholdBreach: boolean;
  reviewPriorityScore: number;
  reasonCodes: string[];
  explanations: string[];
  metricAnalysesJson: string;
  dataQualityJson: string;
  caregiverMessage?: string | null;
  clinicianSummary?: string | null;
  status?: Extract<Uc3TrajectoryResultStatus, 'active' | 'acknowledged'>;
};

export type SaveUc3TrajectoryResultResult = {
  resultId: string;
  inserted: boolean;
};

type SummaryRow = {
  resultId: string;
  patientId: string;
  carePlanId: string;
  modelFamily: string;
  modelVersion: string;
  inputFingerprint: string;
  eventType: string;
  severity: string;
  requiresHumanReview: number;
  emergencyThresholdBreach: number;
  reviewPriorityScore: number;
  reasonCodesJson: string;
  explanationsJson: string;
  metricAnalysesJson: string;
  dataQualityJson: string;
  generatedAt: string;
  status: Uc3TrajectoryResultStatus;
  caregiverMessage?: string | null;
};

function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseMetricAnalyses(json: string): Record<string, Uc3TrajectoryMetricAnalysisSummary> {
  try {
    const parsed = JSON.parse(json);
    if (!isRecord(parsed)) return {};
    return Object.entries(parsed).reduce<Record<string, Uc3TrajectoryMetricAnalysisSummary>>(
      (next, [key, value]) => {
        if (!isRecord(value)) return next;
        next[key] = {
          metricName: typeof value.metricName === 'string' ? value.metricName : key,
          finalActual: finiteNumberOrNull(value.finalActual),
          finalExpected: finiteNumberOrNull(value.finalExpected),
          gap: finiteNumberOrNull(value.gap),
          gapPercent: finiteNumberOrNull(value.gapPercent),
          recentSlope: finiteNumberOrNull(value.recentSlope),
          plateauDays: finiteNumberOr(value.plateauDays, 0),
          dataPoints: finiteNumberOr(value.dataPoints, 0),
        };
        return next;
      },
      {},
    );
  } catch {
    return {};
  }
}

function parseDataQuality(json: string): Uc3TrajectoryDataQualitySummary {
  try {
    const parsed = JSON.parse(json);
    if (!isRecord(parsed)) throw new Error('Invalid data quality payload');
    const missingDays = Array.isArray(parsed.missingDays)
      ? parsed.missingDays.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
      : [];
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item): item is string => typeof item === 'string')
      : [];
    return {
      totalExpectedDays: finiteNumberOr(parsed.totalExpectedDays, 0),
      totalLoggedDays: finiteNumberOr(parsed.totalLoggedDays, 0),
      missingDays,
      completenessRatio: finiteNumberOr(parsed.completenessRatio, 0),
      sufficientData: parsed.sufficientData === true,
      warnings,
    };
  } catch {
    return {
      totalExpectedDays: 0,
      totalLoggedDays: 0,
      missingDays: [],
      completenessRatio: 0,
      sufficientData: false,
      warnings: [],
    };
  }
}

function toSummary(row: SummaryRow): LatestUc3TrajectoryResultSummary {
  return {
    resultId: row.resultId,
    patientId: row.patientId,
    carePlanId: row.carePlanId,
    modelFamily: row.modelFamily,
    modelVersion: row.modelVersion,
    inputFingerprint: row.inputFingerprint,
    eventType: row.eventType,
    severity: row.severity,
    requiresHumanReview: row.requiresHumanReview === 1,
    emergencyThresholdBreach: row.emergencyThresholdBreach === 1,
    reviewPriorityScore: row.reviewPriorityScore,
    reasonCodes: parseStringArray(row.reasonCodesJson),
    explanations: parseStringArray(row.explanationsJson),
    metricAnalyses: parseMetricAnalyses(row.metricAnalysesJson),
    dataQuality: parseDataQuality(row.dataQualityJson),
    generatedAt: row.generatedAt,
    status: row.status,
    caregiverMessagePreview: row.caregiverMessage?.slice(0, 200),
  };
}

export function saveUc3TrajectoryResult(
  input: SaveUc3TrajectoryResultInput,
): SaveUc3TrajectoryResultResult {
  const db = getDatabase();
  const duplicate = db.getFirstSync<{ resultId: string }>(
    `SELECT result_id AS resultId
     FROM uc3_trajectory_results
     WHERE patient_id = ? AND care_plan_id = ? AND model_version = ? AND input_fingerprint = ?
     LIMIT 1;`,
    input.patientId,
    input.carePlanId,
    input.modelVersion,
    input.inputFingerprint,
  );
  if (duplicate) return { resultId: duplicate.resultId, inserted: false };

  const now = new Date().toISOString();
  const status = input.status ?? 'active';
  db.withTransactionSync(() => {
    if (status === 'active') {
      db.runSync(
        `UPDATE uc3_trajectory_results
         SET status = 'superseded', updated_at = ?, superseded_at = ?
         WHERE patient_id = ? AND care_plan_id = ? AND status = 'active';`,
        now,
        now,
        input.patientId,
        input.carePlanId,
      );
    }
    db.runSync(
      `INSERT INTO uc3_trajectory_results (
        result_id, patient_id, care_plan_id, model_family, model_version, input_fingerprint,
        generated_at, input_window_start, input_window_end, event_type, severity,
        requires_human_review, emergency_threshold_breach, review_priority_score,
        reason_codes_json, explanations_json, metric_analyses_json, data_quality_json,
        caregiver_message, clinician_summary, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      input.resultId,
      input.patientId,
      input.carePlanId,
      input.modelFamily,
      input.modelVersion,
      input.inputFingerprint,
      input.generatedAt,
      input.inputWindowStart ?? null,
      input.inputWindowEnd ?? null,
      input.eventType,
      input.severity,
      input.requiresHumanReview ? 1 : 0,
      input.emergencyThresholdBreach ? 1 : 0,
      input.reviewPriorityScore,
      JSON.stringify(input.reasonCodes),
      JSON.stringify(input.explanations),
      input.metricAnalysesJson,
      input.dataQualityJson,
      input.caregiverMessage ?? null,
      input.clinicianSummary ?? null,
      status,
      now,
      now,
    );
  });

  return { resultId: input.resultId, inserted: true };
}

export function getLatestActiveUc3TrajectoryResultSummary(
  patientId: string,
  carePlanId: string,
): LatestUc3TrajectoryResultSummary | null {
  const row = getDatabase().getFirstSync<SummaryRow>(
    `SELECT result_id AS resultId, patient_id AS patientId, care_plan_id AS carePlanId,
            model_family AS modelFamily, model_version AS modelVersion,
            input_fingerprint AS inputFingerprint, event_type AS eventType, severity,
            requires_human_review AS requiresHumanReview,
            emergency_threshold_breach AS emergencyThresholdBreach,
            review_priority_score AS reviewPriorityScore, reason_codes_json AS reasonCodesJson,
            explanations_json AS explanationsJson, metric_analyses_json AS metricAnalysesJson,
            data_quality_json AS dataQualityJson, generated_at AS generatedAt, status,
            caregiver_message AS caregiverMessage
     FROM uc3_trajectory_results
     WHERE patient_id = ? AND care_plan_id = ? AND status = 'active'
     ORDER BY generated_at DESC
     LIMIT 1;`,
    patientId,
    carePlanId,
  );
  if (!row) return null;
  return toSummary(row);
}

export function getUc3TrajectoryResultById(
  resultId: string,
): LatestUc3TrajectoryResultSummary | null {
  const row = getDatabase().getFirstSync<SummaryRow>(
    `SELECT result_id AS resultId, patient_id AS patientId, care_plan_id AS carePlanId,
            model_family AS modelFamily, model_version AS modelVersion,
            input_fingerprint AS inputFingerprint, event_type AS eventType, severity,
            requires_human_review AS requiresHumanReview,
            emergency_threshold_breach AS emergencyThresholdBreach,
            review_priority_score AS reviewPriorityScore, reason_codes_json AS reasonCodesJson,
            explanations_json AS explanationsJson, metric_analyses_json AS metricAnalysesJson,
            data_quality_json AS dataQualityJson, generated_at AS generatedAt, status,
            caregiver_message AS caregiverMessage
     FROM uc3_trajectory_results
     WHERE result_id = ?
     LIMIT 1;`,
    resultId,
  );
  if (!row) return null;
  return toSummary(row);
}
