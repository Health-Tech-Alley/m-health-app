import type { PatientRecordSnapshot } from '@/data/types';
import {
  buildUc3TherapySeedSupplement,
  buildUc3TherapySystemContext,
  snapshotHasTherapyGroundTruth,
} from './uc3TherapyChatContext';

function baseSnapshot(
  overrides: Partial<PatientRecordSnapshot> = {},
): PatientRecordSnapshot {
  return {
    patient: {
      patientId: 'p1',
      name: 'Test Patient',
      preferredName: 'Pat',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    safetyNotes: '',
    caregiver: null,
    conditions: [],
    comorbidities: [],
    primaryCondition: null,
    pendingReviewConditions: [],
    symptoms: [],
    wearable: null,
    medications: [
      {
        medicationId: 'm1',
        patientId: 'p1',
        name: 'Baclofen',
        dosage: '10 mg',
        frequency: 'TID',
        active: true,
      },
    ],
    medicationCandidates: [],
    medicationConfirmationRequirements: {},
    functionalObservations: [],
    thresholds: [],
    carePlan: {
      planId: 'cp1',
      patientId: 'p1',
      version: 1,
      effectiveDate: '2026-01-01',
      createdAt: '2026-01-01T00:00:00.000Z',
      activities: [],
    },
    carePlans: [],
    rehabPlanMetrics: [],
    rehabExerciseAssignments: [
      {
        patientId: 'p1',
        carePlanId: 'cp1',
        exerciseKey: 'sit_to_stand',
        active: true,
        source: 'developer_uc3_v2',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    todayDailyCareEntry: {
      entryId: 'd1',
      patientId: 'p1',
      entryDate: '2026-07-27',
      therapyCompleted: true,
      setsCompleted: 2,
      recommendedSets: 3,
      exerciseRepetitions: 12,
      romDegrees: 48,
      walkingMinutes: 8,
      painScore: 3,
      fatigue: 4,
      caregiverConcern: false,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    },
    rehabDailyEntries: [],
    latestUc3TrajectoryResult: {
      resultId: 'uc3-1',
      patientId: 'p1',
      carePlanId: 'cp1',
      modelFamily: 'uc3',
      modelVersion: '1',
      inputFingerprint: 'fp',
      eventType: 'on_track',
      severity: 'info',
      requiresHumanReview: false,
      emergencyThresholdBreach: false,
      reviewPriorityScore: 0,
      reasonCodes: [],
      explanations: ['Progress looks steady.'],
      metricAnalyses: {},
      dataQuality: {
        totalExpectedDays: 7,
        totalLoggedDays: 5,
        missingDays: [],
        completenessRatio: 5 / 7,
        sufficientData: true,
        warnings: [],
      },
      generatedAt: '2026-07-27T12:00:00.000Z',
      status: 'active',
    },
    latestUc4Run: null,
    latestUc4PriorityCards: [],
    recentUc4CaregiverResponses: [],
    careContextItems: [],
    timelineEvents: [],
    carePlanGoals: [],
    knowledgeStats: { total: 0, bySource: {} },
    enrichmentStats: { total: 0, bySource: {} },
    bundlePending: false,
    bundleStatus: 'idle' as PatientRecordSnapshot['bundleStatus'],
    activeAdcpVersion: null,
    pendingPlanProposals: [],
    therapyContractPresent: true,
    lastRefreshedAt: '2026-07-27T12:00:00.000Z',
    ...overrides,
  } as PatientRecordSnapshot;
}

describe('uc3TherapyChatContext (locator-first)', () => {
  it('points at tables/UI and does not dump session metric values', () => {
    const ctx = buildUc3TherapySystemContext(baseSnapshot());
    expect(ctx).toContain('LOCAL DATA MAP');
    expect(ctx).toContain('daily_care_entries');
    expect(ctx).toContain('Care→Therapy');
    expect(ctx).toContain('Sit-to-stand practice');
    expect(ctx).toContain('on_track');
    // Mutable session numbers must not appear
    expect(ctx).not.toContain('reps 12');
    expect(ctx).not.toContain('ROM 48');
    expect(ctx).not.toContain('pain 3');
  });

  it('seed is a short pointer without metric dumps', () => {
    const seed = buildUc3TherapySeedSupplement(baseSnapshot());
    expect(seed).toContain('Sit-to-stand practice');
    expect(seed).toContain('daily_care_entries');
    expect(seed).not.toContain('reps 12');
    expect(seed.length).toBeLessThan(400);
  });

  it('snapshotHasTherapyGroundTruth detects therapy presence', () => {
    expect(snapshotHasTherapyGroundTruth(baseSnapshot())).toBe(true);
    expect(snapshotHasTherapyGroundTruth(null)).toBe(false);
  });

  it('handles null snapshot', () => {
    expect(buildUc3TherapySystemContext(null)).toContain('No patient');
    expect(buildUc3TherapySeedSupplement(null)).toBe('');
  });
});
