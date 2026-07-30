import type { PatientRecordSnapshot } from '@/data/types';
import {
  buildCompactCarePlanSystemContext,
  buildPromptContext,
  promptContextToSystemContext,
} from './contextAssembler';

jest.mock('@/data/repositories/adcpRepository', () => ({
  getActiveAdcpRevisionForPatient: () => null,
  getActiveAdcpVersionSummary: () => null,
  listPendingProposalSummaries: () => [],
}));

function snap(overrides: Partial<PatientRecordSnapshot> = {}): PatientRecordSnapshot {
  return {
    patient: {
      patientId: 'p1',
      name: 'Pat',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    safetyNotes: '',
    caregiver: null,
    conditions: [],
    comorbidities: [],
    primaryCondition: {
      conditionId: 'c1',
      patientId: 'p1',
      name: 'Stroke',
      isPrimary: true,
    } as PatientRecordSnapshot['primaryCondition'],
    pendingReviewConditions: [],
    symptoms: [],
    wearable: null,
    medications: [
      {
        medicationId: 'm1',
        patientId: 'p1',
        name: 'Aspirin',
        dosage: '81 mg',
        frequency: 'daily',
        active: true,
      },
    ],
    medicationCandidates: [],
    medicationConfirmationRequirements: {},
    functionalObservations: [],
    thresholds: [],
    carePlan: null,
    carePlans: [],
    rehabPlanMetrics: [],
    rehabExerciseAssignments: [],
    todayDailyCareEntry: null,
    rehabDailyEntries: [],
    latestUc3TrajectoryResult: null,
    latestUc4Run: null,
    latestUc4PriorityCards: [
      {
        cardId: 'card-1',
        title: 'Watch fatigue',
        body: 'Log energy',
        domain: 'rehab_therapy_context',
        score: 0.8,
        safetyBoundary: 'guidance only',
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
    bundleStatus: 'idle' as PatientRecordSnapshot['bundleStatus'],
    activeAdcpVersion: null,
    pendingPlanProposals: [],
    therapyContractPresent: false,
    lastRefreshedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  } as PatientRecordSnapshot;
}

describe('contextAssembler compact prompts', () => {
  it('includes medications and UC4 in system context under budget', () => {
    const ctx = buildPromptContext(snap(), 'explain_uc4_card');
    const system = promptContextToSystemContext(ctx);
    expect(system).toContain('Aspirin');
    expect(system).toContain('Watch fatigue');
    expect(system).toContain('Meds:');
    expect(system.length).toBeLessThanOrEqual(2300);
  });

  it('buildCompactCarePlanSystemContext works without ADCP seed', () => {
    const text = buildCompactCarePlanSystemContext(snap(), 'weekly_care_plan_review');
    expect(text).toContain('Aspirin');
    expect(text).toMatch(/UC4|Watch fatigue/);
  });
});
