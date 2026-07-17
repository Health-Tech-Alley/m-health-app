import type { LatestUc3TrajectoryResultSummary } from '../../data/types';
import { getUc3ResultDisplay } from './uc3ResultPresenter';

function result(
  overrides: Partial<LatestUc3TrajectoryResultSummary> = {},
): LatestUc3TrajectoryResultSummary {
  return {
    resultId: 'result-1',
    patientId: 'patient-1',
    carePlanId: 'plan-1',
    modelFamily: 'ACCESS-DP Long-Term Trajectory Failure',
    modelVersion: 'rehab_trajectory_rules_v0.2.0',
    inputFingerprint: 'manual:2026-07-17T12:00:00.000Z',
    eventType: 'TRAJECTORY_FAILURE_DETECTED',
    severity: 'non_emergency',
    requiresHumanReview: true,
    emergencyThresholdBreach: false,
    reviewPriorityScore: 0.7,
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
    generatedAt: '2026-07-17T12:00:00.000Z',
    status: 'active',
    ...overrides,
  };
}

describe('getUc3ResultDisplay', () => {
  it('returns the no-result Care copy when no persisted UC3 result exists', () => {
    expect(getUc3ResultDisplay(null)).toMatchObject({
      title: 'Rehabilitation progress',
      statusLabel: 'No progress evaluation has been generated yet.',
      tone: 'none',
    });
  });

  it('labels review-needed trajectory failures from the persisted Jay result', () => {
    expect(getUc3ResultDisplay(result())).toMatchObject({
      statusLabel: 'Progress review recommended',
      tone: 'review',
      reviewLabel: 'Review needed',
      explanation: 'Range of motion is behind the expected trajectory.',
      dataQualityLabel: 'Data quality: 7/21 days logged',
      detailLines: ['Range of motion: 7 logged point(s), latest 40, expected 50.'],
    });
  });

  it('treats urgent severity or emergency breach as urgent without publishing alerts', () => {
    expect(getUc3ResultDisplay(result({
      eventType: 'URGENT_SAFETY_ESCALATION',
      severity: 'urgent',
      emergencyThresholdBreach: true,
    }))).toMatchObject({
      statusLabel: 'Urgent safety concern',
      tone: 'urgent',
    });
  });

  it('uses the requested insufficient-data label as a result state', () => {
    expect(getUc3ResultDisplay(result({
      eventType: 'INSUFFICIENT_DATA',
      requiresHumanReview: false,
      dataQuality: {
        totalExpectedDays: 21,
        totalLoggedDays: 2,
        missingDays: [3, 4],
        completenessRatio: 0.1,
        sufficientData: false,
        warnings: ['Not enough logs'],
      },
    }))).toMatchObject({
      statusLabel: 'More information is needed',
      dataQualityLabel: 'Data quality: more information is needed',
      tone: 'none',
    });
  });
});
