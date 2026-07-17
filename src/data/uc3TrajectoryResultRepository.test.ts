import {
  getLatestActiveUc3TrajectoryResultSummary,
  getUc3TrajectoryResultById,
  saveUc3TrajectoryResult,
} from './repositories/uc3TrajectoryResultRepository';
import type { SaveUc3TrajectoryResultInput } from './repositories/uc3TrajectoryResultRepository';

type Row = {
  result_id: string;
  patient_id: string;
  care_plan_id: string;
  model_family: string;
  model_version: string;
  input_fingerprint: string;
  generated_at: string;
  event_type: string;
  severity: string;
  requires_human_review: number;
  emergency_threshold_breach: number;
  review_priority_score: number;
  reason_codes_json: string;
  explanations_json: string;
  metric_analyses_json: string;
  data_quality_json: string;
  caregiver_message?: string | null;
  clinician_summary?: string | null;
  status: 'active' | 'superseded' | 'acknowledged';
  created_at: string;
  updated_at: string;
  superseded_at?: string | null;
};

const rows: Row[] = [];

const mockDb = {
  withTransactionSync: jest.fn((fn: () => void) => fn()),
  runSync: jest.fn((sql: string, ...args: unknown[]) => {
    if (sql.includes("SET status = 'superseded'")) {
      const [updatedAt, supersededAt, patientId, carePlanId] = args;
      rows.forEach((row) => {
        if (row.patient_id === patientId && row.care_plan_id === carePlanId && row.status === 'active') {
          row.status = 'superseded';
          row.updated_at = String(updatedAt);
          row.superseded_at = String(supersededAt);
        }
      });
      return;
    }
    if (sql.includes('INSERT INTO uc3_trajectory_results')) {
      const [
        resultId, patientId, carePlanId, modelFamily, modelVersion, inputFingerprint,
        generatedAt, , , eventType, severity, requiresHumanReview, emergencyThresholdBreach,
        reviewPriorityScore, reasonCodesJson, explanationsJson, metricAnalysesJson,
        dataQualityJson, caregiverMessage, clinicianSummary, status, createdAt, updatedAt,
      ] = args;
      rows.push({
        result_id: String(resultId),
        patient_id: String(patientId),
        care_plan_id: String(carePlanId),
        model_family: String(modelFamily),
        model_version: String(modelVersion),
        input_fingerprint: String(inputFingerprint),
        generated_at: String(generatedAt),
        event_type: String(eventType),
        severity: String(severity),
        requires_human_review: Number(requiresHumanReview),
        emergency_threshold_breach: Number(emergencyThresholdBreach),
        review_priority_score: Number(reviewPriorityScore),
        reason_codes_json: String(reasonCodesJson),
        explanations_json: String(explanationsJson),
        metric_analyses_json: String(metricAnalysesJson),
        data_quality_json: String(dataQualityJson),
        caregiver_message: caregiverMessage ? String(caregiverMessage) : null,
        clinician_summary: clinicianSummary ? String(clinicianSummary) : null,
        status: status as Row['status'],
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      });
    }
  }),
  getFirstSync: jest.fn((sql: string, ...args: unknown[]) => {
    if (sql.includes('input_fingerprint = ?')) {
      const [patientId, carePlanId, modelVersion, inputFingerprint] = args;
      return toRepoRow(rows.find(
        (row) =>
          row.patient_id === patientId &&
          row.care_plan_id === carePlanId &&
          row.model_version === modelVersion &&
          row.input_fingerprint === inputFingerprint,
      ));
    }
    if (sql.includes("status = 'active'")) {
      const [patientId, carePlanId] = args;
      return toRepoRow(
        rows
          .filter((row) => row.patient_id === patientId && row.care_plan_id === carePlanId && row.status === 'active')
          .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0],
      );
    }
    if (sql.includes('WHERE result_id = ?')) {
      const [resultId] = args;
      return toRepoRow(rows.find((row) => row.result_id === resultId));
    }
    return null;
  }),
};

jest.mock('./db', () => ({
  getDatabase: () => mockDb,
}));

function toRepoRow(row?: Row) {
  if (!row) return null;
  return {
    resultId: row.result_id,
    patientId: row.patient_id,
    carePlanId: row.care_plan_id,
    modelFamily: row.model_family,
    modelVersion: row.model_version,
    inputFingerprint: row.input_fingerprint,
    generatedAt: row.generated_at,
    eventType: row.event_type,
    severity: row.severity,
    requiresHumanReview: row.requires_human_review,
    emergencyThresholdBreach: row.emergency_threshold_breach,
    reviewPriorityScore: row.review_priority_score,
    reasonCodesJson: row.reason_codes_json,
    explanationsJson: row.explanations_json,
    metricAnalysesJson: row.metric_analyses_json,
    dataQualityJson: row.data_quality_json,
    caregiverMessage: row.caregiver_message,
    clinicianSummary: row.clinician_summary,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    supersededAt: row.superseded_at,
  };
}

function input(overrides: Partial<SaveUc3TrajectoryResultInput> = {}): SaveUc3TrajectoryResultInput {
  return {
    resultId: `result-${rows.length + 1}`,
    patientId: 'patient-1',
    carePlanId: 'plan-1',
    modelFamily: 'ACCESS-DP Long-Term Trajectory Failure',
    modelVersion: 'rehab_trajectory_rules_v0.2.0',
    inputFingerprint: `fingerprint-${rows.length + 1}`,
    generatedAt: `2026-07-${String(rows.length + 1).padStart(2, '0')}T00:00:00.000Z`,
    eventType: 'NO_TRAJECTORY_FAILURE',
    severity: 'informational',
    requiresHumanReview: false,
    emergencyThresholdBreach: false,
    reviewPriorityScore: 0.2,
    reasonCodes: ['R1'],
    explanations: ['No trajectory failure detected.'],
    metricAnalysesJson: '{}',
    dataQualityJson: '{}',
    caregiverMessage: 'Caregiver summary',
    clinicianSummary: 'Clinician summary',
    ...overrides,
  };
}

beforeEach(() => {
  rows.length = 0;
  jest.clearAllMocks();
});

describe('uc3TrajectoryResultRepository', () => {
  it('deduplicates by patient, CarePlan, model version, and input fingerprint', () => {
    const first = saveUc3TrajectoryResult(input({ inputFingerprint: 'same' }));
    const second = saveUc3TrajectoryResult(input({ resultId: 'result-duplicate', inputFingerprint: 'same' }));

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.resultId).toBe('result-1');
    expect(rows).toHaveLength(1);
  });

  it('supersedes only the active result for the same patient and CarePlan', () => {
    saveUc3TrajectoryResult(input({ resultId: 'other-plan', carePlanId: 'plan-2' }));
    saveUc3TrajectoryResult(input({ resultId: 'old-plan-1', inputFingerprint: 'old' }));
    saveUc3TrajectoryResult(input({ resultId: 'new-plan-1', inputFingerprint: 'new' }));

    expect(rows.find((row) => row.result_id === 'other-plan')?.status).toBe('active');
    expect(rows.find((row) => row.result_id === 'old-plan-1')?.status).toBe('superseded');
    expect(rows.find((row) => row.result_id === 'new-plan-1')?.status).toBe('active');
  });

  it('loads the latest active summary for the requested CarePlan', () => {
    saveUc3TrajectoryResult(input({ resultId: 'old', inputFingerprint: 'old' }));
    saveUc3TrajectoryResult(input({
      resultId: 'latest',
      inputFingerprint: 'latest',
      reasonCodes: ['LATEST'],
      explanations: ['Latest explanation'],
      metricAnalysesJson: JSON.stringify({
        romDegrees: {
          metricName: 'romDegrees',
          finalActual: 40,
          finalExpected: 50,
          gap: 10,
          gapPercent: 0.2,
          recentSlope: 0,
          plateauDays: 3,
          dataPoints: 7,
        },
      }),
      dataQualityJson: JSON.stringify({
        totalExpectedDays: 21,
        totalLoggedDays: 7,
        missingDays: [2, 3],
        completenessRatio: 0.33,
        sufficientData: true,
        warnings: ['Sparse logs'],
      }),
    }));

    expect(getLatestActiveUc3TrajectoryResultSummary('patient-1', 'plan-1')).toMatchObject({
      resultId: 'latest',
      patientId: 'patient-1',
      carePlanId: 'plan-1',
      modelFamily: 'ACCESS-DP Long-Term Trajectory Failure',
      inputFingerprint: 'latest',
      reasonCodes: ['LATEST'],
      explanations: ['Latest explanation'],
      metricAnalyses: {
        romDegrees: {
          dataPoints: 7,
          gapPercent: 0.2,
        },
      },
      dataQuality: {
        totalExpectedDays: 21,
        totalLoggedDays: 7,
        sufficientData: true,
      },
    });
  });

  it('re-reads a persisted result by id after save', () => {
    saveUc3TrajectoryResult(input({ resultId: 'result-to-read' }));

    expect(getUc3TrajectoryResultById('result-to-read')).toMatchObject({
      resultId: 'result-to-read',
      patientId: 'patient-1',
      carePlanId: 'plan-1',
      status: 'active',
    });
  });
});
