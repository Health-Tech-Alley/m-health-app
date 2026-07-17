import type { PatientRecordSnapshot } from '../../data/types';
import {
  getUc3TrajectoryResultById,
  saveUc3TrajectoryResult,
} from '../../data/repositories/uc3TrajectoryResultRepository';
import { evaluateRehabTrajectory } from '../../ml-models/uc3-rehab';
import { getEventBus } from '../../orchestration/event-bus';
import { dispatchImmediate } from '../notifications';
import { adaptPatientRecordSnapshotToUC3Input } from './uc3PatientStateAdapter';
import { evaluateAndPersistUc3Trajectory } from './uc3EvaluationService';

jest.mock('./uc3PatientStateAdapter', () => ({
  adaptPatientRecordSnapshotToUC3Input: jest.fn(),
}));

jest.mock('../../ml-models/uc3-rehab', () => ({
  evaluateRehabTrajectory: jest.fn(),
}));

jest.mock('../../data/repositories/uc3TrajectoryResultRepository', () => ({
  getUc3TrajectoryResultById: jest.fn(),
  saveUc3TrajectoryResult: jest.fn(),
}));

jest.mock('../../orchestration/event-bus', () => ({
  getEventBus: jest.fn(),
}));

jest.mock('../notifications', () => ({
  dispatchImmediate: jest.fn(),
}));

const mockAdapt = adaptPatientRecordSnapshotToUC3Input as jest.Mock;
const mockEvaluate = evaluateRehabTrajectory as jest.Mock;
const mockSave = saveUc3TrajectoryResult as jest.Mock;
const mockRead = getUc3TrajectoryResultById as jest.Mock;
const mockBus = getEventBus as jest.Mock;
const mockDispatch = dispatchImmediate as jest.Mock;

const snapshot = { patient: { patientId: 'patient-1' } } as PatientRecordSnapshot;

const readyInput = {
  patient: { patientId: 'patient-1' },
  plan: { planId: 'plan-1' },
  logs: [
    { date: '2026-07-03' },
    { date: '2026-07-01' },
  ],
  ehrContext: { conditionGroup: 'post_stroke_rehabilitation' },
};

const decision = {
  eventType: 'TRAJECTORY_FAILURE_DETECTED',
  severity: 'non_emergency',
  requiresHumanReview: true,
  emergencyThresholdBreach: false,
  reviewPriorityScore: 0.72,
  reasonCodes: ['ROM_TRAJECTORY_GAP'],
  explanations: ['Range of motion is behind the expected trajectory.'],
  metricAnalyses: {
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
  },
  dataQuality: {
    totalExpectedDays: 21,
    totalLoggedDays: 7,
    missingDays: [],
    completenessRatio: 0.33,
    sufficientData: true,
    warnings: [],
  },
  modelVersion: 'rehab_trajectory_rules_v0.2.0',
  modelFamily: 'ACCESS-DP Long-Term Trajectory Failure',
  generatedAt: '2026-07-17T12:00:00.000Z',
};

const persistedResult = {
  resultId: 'saved-result',
  patientId: 'patient-1',
  carePlanId: 'plan-1',
  modelFamily: decision.modelFamily,
  modelVersion: decision.modelVersion,
  inputFingerprint: 'manual:2026-07-17T12:00:00.000Z',
  eventType: decision.eventType,
  severity: decision.severity,
  requiresHumanReview: decision.requiresHumanReview,
  emergencyThresholdBreach: decision.emergencyThresholdBreach,
  reviewPriorityScore: decision.reviewPriorityScore,
  reasonCodes: decision.reasonCodes,
  explanations: decision.explanations,
  metricAnalyses: decision.metricAnalyses,
  dataQuality: decision.dataQuality,
  generatedAt: decision.generatedAt,
  status: 'active',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAdapt.mockReturnValue({
    status: 'ready',
    input: readyInput,
    warnings: [],
  });
  mockEvaluate.mockReturnValue(decision);
  mockSave.mockReturnValue({ resultId: 'saved-result', inserted: true });
  mockRead.mockReturnValue(persistedResult);
  mockBus.mockReturnValue({ publish: jest.fn() });
});

describe('evaluateAndPersistUc3Trajectory', () => {
  it('stops at adapter not-ready without running Jay engine or persistence', () => {
    mockAdapt.mockReturnValue({
      status: 'not_ready',
      errors: [{ code: 'no_active_rehab_care_plan', message: 'Plan required.' }],
      warnings: [],
    });

    const result = evaluateAndPersistUc3Trajectory(snapshot, {
      evaluationKey: 'manual:2026-07-17T12:00:00.000Z',
      now: new Date('2026-07-17T12:00:00.000Z'),
    });

    expect(result.status).toBe('not_ready');
    expect(mockEvaluate).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('runs Jay engine, persists the exact decision fields, and re-reads the saved result', () => {
    const result = evaluateAndPersistUc3Trajectory(snapshot, {
      evaluationKey: 'manual:2026-07-17T12:00:00.000Z',
      now: new Date('2026-07-17T12:00:00.000Z'),
    });

    expect(mockAdapt).toHaveBeenCalledWith(snapshot, new Date('2026-07-17T12:00:00.000Z'));
    expect(mockEvaluate).toHaveBeenCalledWith(
      readyInput.plan,
      readyInput.logs,
      readyInput.ehrContext,
    );
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({
      resultId: 'uc3:patient-1:plan-1:rehab_trajectory_rules_v0.2.0:manual:2026-07-17T12:00:00.000Z',
      patientId: 'patient-1',
      carePlanId: 'plan-1',
      inputFingerprint: 'manual:2026-07-17T12:00:00.000Z',
      inputWindowStart: '2026-07-01',
      inputWindowEnd: '2026-07-03',
      explanations: decision.explanations,
      metricAnalysesJson: JSON.stringify(decision.metricAnalyses),
      dataQualityJson: JSON.stringify(decision.dataQuality),
    }));
    expect(mockRead).toHaveBeenCalledWith('saved-result');
    expect(mockBus().publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'uc3_trajectory_evaluated',
      resultId: 'saved-result',
      eventType: 'TRAJECTORY_FAILURE_DETECTED',
    }));
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'care_task',
      severity: 2,
    }));
    expect(result).toMatchObject({
      status: 'success',
      decision,
      persistedResult,
      inserted: true,
    });
  });

  it('returns an engine failure without saving when Jay evaluation throws', () => {
    mockEvaluate.mockImplementation(() => {
      throw new Error('engine failed');
    });

    const result = evaluateAndPersistUc3Trajectory(snapshot, {
      evaluationKey: 'manual:2026-07-17T12:00:00.000Z',
    });

    expect(result).toMatchObject({
      status: 'engine_error',
      message: 'engine failed',
    });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('returns a persistence failure when the saved result cannot be re-read', () => {
    mockRead.mockReturnValue(null);

    const result = evaluateAndPersistUc3Trajectory(snapshot, {
      evaluationKey: 'manual:2026-07-17T12:00:00.000Z',
    });

    expect(result).toMatchObject({
      status: 'persistence_error',
      decision,
    });
  });
});
