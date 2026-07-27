import type { PatientRecordSnapshot } from '@/data/types';
import {
  buildUc3TherapySeedSupplement,
  buildUc3TherapySystemContext,
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
      {
        medicationId: 'm2',
        patientId: 'p1',
        name: 'Old med',
        active: false,
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
      activities: [
        {
          activityId: 'a1',
          planId: 'cp1',
          description: 'Home PT twice weekly',
          status: 'in-progress',
          sequence: 1,
        },
      ],
    },
    carePlans: [],
    rehabPlanMetrics: [
      {
        id: 'rm1',
        patientId: 'p1',
        carePlanId: 'cp1',
        metricKey: 'romDegrees',
        displayName: 'Shoulder ROM',
        baselineValue: 40,
        targetValue: 90,
        unit: 'deg',
        durationDays: 30,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
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
      {
        patientId: 'p1',
        carePlanId: 'cp1',
        exerciseKey: 'assisted_walking',
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
      completedExerciseKeys: ['sit_to_stand'],
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
      reasonCodes: ['adherence_ok'],
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
    carePlanGoals: [
      {
        goalId: 'g1',
        description: 'Improve sit-to-stand independence',
        status: 'active',
      },
    ],
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

describe('uc3TherapyChatContext', () => {
  it('includes assigned exercises, metrics, activities, goals, UC3, and active meds', () => {
    const ctx = buildUc3TherapySystemContext(baseSnapshot());
    expect(ctx).toContain('Sit-to-stand practice');
    expect(ctx).toContain('Assisted walking practice');
    expect(ctx).toContain('Shoulder ROM');
    expect(ctx).toContain('Home PT twice weekly');
    expect(ctx).toContain('Improve sit-to-stand independence');
    expect(ctx).toContain('on_track');
    expect(ctx).toContain('Baclofen');
    expect(ctx).not.toContain('Old med');
    expect(ctx.length).toBeLessThanOrEqual(1500);
  });

  it('seed supplement is a short one-liner for history budget', () => {
    const seed = buildUc3TherapySeedSupplement(baseSnapshot());
    expect(seed).toContain('Sit-to-stand practice');
    expect(seed).toContain('Baclofen');
    expect(seed.length).toBeLessThan(400);
  });

  it('handles null snapshot without throwing', () => {
    expect(buildUc3TherapySystemContext(null)).toContain('No patient');
    expect(buildUc3TherapySeedSupplement(null)).toBe('');
  });
});
