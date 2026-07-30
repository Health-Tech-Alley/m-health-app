import type { PatientRecordSnapshot } from '@/data/types';
import { buildLocalDataLocatorContext } from './localDataLocatorContext';

function snap(
  overrides: Partial<PatientRecordSnapshot> = {},
): PatientRecordSnapshot {
  return {
    patient: {
      patientId: 'p1',
      name: 'James',
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
    medications: [],
    medicationCandidates: [],
    medicationConfirmationRequirements: {},
    functionalObservations: [],
    thresholds: [],
    carePlan: null,
    carePlans: [],
    rehabPlanMetrics: [],
    rehabExerciseAssignments: [],
    todayDailyCareEntry: {
      entryId: 'd1',
      patientId: 'p1',
      entryDate: '2026-07-27',
      therapyCompleted: true,
      setsCompleted: 1,
      recommendedSets: 1,
      exerciseRepetitions: 99,
      caregiverConcern: false,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    },
    rehabDailyEntries: [],
    latestUc3TrajectoryResult: null,
    latestUc4Run: null,
    latestUc4PriorityCards: [
      {
        cardId: 'c1',
        title: 'Watch fatigue',
        body: 'x',
        domain: 'rehab_therapy_context',
        score: 0.8,
        safetyBoundary: 'guidance',
        firedRuleCodes: [],
        status: 'active',
      } as PatientRecordSnapshot['latestUc4PriorityCards'][number],
    ],
    recentUc4CaregiverResponses: [],
    careContextItems: [],
    timelineEvents: [],
    carePlanGoals: [],
    knowledgeStats: { total: 0, bySource: {} },
    enrichmentStats: { total: 0, bySource: {} },
    bundlePending: false,
    bundleStatus: { state: 'complete', chunksAdded: 0 },
    activeAdcpVersion: null,
    pendingPlanProposals: [],
    therapyContractPresent: true,
    lastRefreshedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  } as PatientRecordSnapshot;
}

describe('buildLocalDataLocatorContext', () => {
  it('lists storage/UI locations without dumping mutable values', () => {
    const text = buildLocalDataLocatorContext(snap());
    expect(text).toContain('daily_care_entries');
    expect(text).toContain('care_focus');
    expect(text).toContain('health_samples');
    expect(text).toContain('patient_care_context_items');
    expect(text).toContain('Care→Therapy');
    expect(text).toContain('care_focus=1');
    expect(text).toContain('rehab_logs=yes');
    expect(text).not.toContain('99');
    expect(text).not.toContain('Watch fatigue');
    expect(text.length).toBeLessThanOrEqual(1150);
  });

  it('handles missing patient', () => {
    expect(buildLocalDataLocatorContext(null)).toContain('No patient');
  });
});
