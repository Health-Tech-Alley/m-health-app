import {
  createManualUc3EvaluationKey,
  describeUc3DeveloperEvaluationResult,
} from '../../services/uc3/uc3DeveloperEvaluationPresenter';

describe('Advanced Developer Settings UC3 manual evaluation helpers', () => {
  it('creates the approved manual evaluation fingerprint shape', () => {
    expect(createManualUc3EvaluationKey(new Date('2026-07-17T12:34:56.000Z'))).toBe(
      'manual:2026-07-17T12:34:56.000Z',
    );
  });

  it('describes a saved UC3 result with the fields shown by Developer Settings', () => {
    expect(describeUc3DeveloperEvaluationResult({
      status: 'success',
      evaluationKey: 'manual:2026-07-17T12:34:56.000Z',
      inserted: true,
      warnings: [],
      decision: {} as never,
      persistedResult: {
        resultId: 'result-1',
        patientId: 'patient-1',
        carePlanId: 'plan-1',
        modelFamily: 'ACCESS-DP Long-Term Trajectory Failure',
        modelVersion: 'rehab_trajectory_rules_v0.2.0',
        inputFingerprint: 'manual:2026-07-17T12:34:56.000Z',
        eventType: 'TRAJECTORY_FAILURE_DETECTED',
        severity: 'non_emergency',
        requiresHumanReview: true,
        emergencyThresholdBreach: false,
        reviewPriorityScore: 0.7,
        reasonCodes: [],
        explanations: [],
        metricAnalyses: {},
        dataQuality: {
          totalExpectedDays: 21,
          totalLoggedDays: 7,
          missingDays: [],
          completenessRatio: 0.33,
          sufficientData: true,
          warnings: [],
        },
        generatedAt: '2026-07-17T12:00:00.000Z',
        status: 'active',
      },
    })).toEqual({
      title: 'UC3 evaluation saved',
      lines: [
        'Result: result-1',
        'Event: TRAJECTORY_FAILURE_DETECTED',
        'Severity: non_emergency',
        'Review: needed',
        'Generated: 2026-07-17T12:00:00.000Z',
      ],
    });
  });

  it('keeps adapter not-ready messages visible for the manual control', () => {
    expect(describeUc3DeveloperEvaluationResult({
      status: 'not_ready',
      evaluationKey: 'manual:2026-07-17T12:34:56.000Z',
      warnings: [],
      errors: [{ code: 'no_active_rehab_care_plan', message: 'Plan required.' }],
    })).toEqual({
      title: 'UC3 evaluation not ready',
      lines: ['no_active_rehab_care_plan: Plan required.'],
    });
  });
});
