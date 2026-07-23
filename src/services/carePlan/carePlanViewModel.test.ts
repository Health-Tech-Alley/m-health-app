/**
 * Tests for planning/41 §7 care plan view-model.
 *
 * Verifies the read-only assembly across the snapshot, the ADCP repo,
 * and `app_settings.carePlanMode`. The tests mock the ADCP repo and
 * `app_settings` so the VM is exercised in isolation — same pattern as
 * the carePlanMode gate test.
 */

const mockAppSettings: { current: { carePlanMode: 'full' | 'read_only' } } = {
  current: { carePlanMode: 'full' },
};
jest.mock('@/data/repositories/appSettingsRepository', () => ({
  getAppSettings: () => mockAppSettings.current,
}));

const mockRevision: {
  current: {
    patientId: string;
    identity: { version: number; publishedAt: string; source: string; planId: string };
    safetyEnvelope: { alwaysDo: string[]; neverDo: string[]; safetyNotes?: string | null };
    goals: { goals: Array<{ goalId: string; description: string; status: string }> };
    carePriorities: { priorities: Array<{ priorityId: string; sourceCardId?: string | null; title: string; domain: string; weight: number; status: string }> };
    therapyContract: { present: true } | { present: false; reason: string };
  } | null;
} = {
  current: null,
};

const mockDecisionLog: { current: Array<{ decisionId: string; summary: string; createdAt: string }> } = {
  current: [],
};

jest.mock('@/data/repositories/adcpRepository', () => ({
  __esModule: true,
  getActiveAdcpRevisionForPatient: (patientId: string) =>
    mockRevision.current && mockRevision.current.patientId === patientId
      ? mockRevision.current
      : null,
  listPlanDecisionLog: (_patientId: string, limit: number) =>
    mockDecisionLog.current.slice(0, limit),
  planHasTherapyContract: (plan: { therapyContract: { present: boolean } } | null) =>
    Boolean(plan && plan.therapyContract.present),
}));

import { buildCarePlanViewModel } from '@/services/carePlan/carePlanViewModel';
import type { PatientRecordSnapshot } from '@/data/types';

const PATIENT = 'patient-vm-test';

function makeSnapshot(overrides: Partial<PatientRecordSnapshot> = {}): PatientRecordSnapshot {
  return {
    patient: { patientId: PATIENT, name: 'Test', preferredName: 'Test', age: '30' },
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
    todayDailyCareEntry: null,
    rehabDailyEntries: [],
    latestUc3TrajectoryResult: null,
    latestUc4Run: null,
    latestUc4PriorityCards: [],
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
    therapyContractPresent: false,
    lastRefreshedAt: new Date().toISOString(),
    ...overrides,
  } as PatientRecordSnapshot;
}

beforeEach(() => {
  mockAppSettings.current = { carePlanMode: 'full' };
  mockRevision.current = null;
  mockDecisionLog.current = [];
});

describe('buildCarePlanViewModel — mode', () => {
  it('reads carePlanMode "full" as writable', () => {
    const vm = buildCarePlanViewModel(makeSnapshot());
    expect(vm.mode).toBe('full');
    expect(vm.writable).toBe(true);
  });

  it('reads carePlanMode "read_only" as not writable', () => {
    mockAppSettings.current = { carePlanMode: 'read_only' };
    const vm = buildCarePlanViewModel(makeSnapshot());
    expect(vm.mode).toBe('read_only');
    expect(vm.writable).toBe(false);
  });
});

describe('buildCarePlanViewModel — sections.showReview', () => {
  it('is true when there are pending proposals and mode is full', () => {
    const snapshot = makeSnapshot({
      pendingPlanProposals: [
        {
          proposalId: 'p1',
          patientId: PATIENT,
          intent: 'review_monitoring_contract',
          section: 'monitoringContract',
          kind: 'threshold_patch',
          status: 'awaiting_hitl',
          summary: 'Lower cutoff',
          rationale: 'Tighten',
          draftedBy: 'slm',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          resolvedAt: null,
        },
      ],
    });
    expect(buildCarePlanViewModel(snapshot).sections.showReview).toBe(true);
  });

  it('is false in read-only mode even with pending proposals', () => {
    mockAppSettings.current = { carePlanMode: 'read_only' };
    const snapshot = makeSnapshot({
      pendingPlanProposals: [
        {
          proposalId: 'p1',
          patientId: PATIENT,
          intent: 'review_monitoring_contract',
          section: 'monitoringContract',
          kind: 'threshold_patch',
          status: 'awaiting_hitl',
          summary: 'Lower cutoff',
          rationale: 'Tighten',
          draftedBy: 'slm',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          resolvedAt: null,
        },
      ],
    });
    expect(buildCarePlanViewModel(snapshot).sections.showReview).toBe(false);
  });

  it('is false when no pending proposals', () => {
    expect(buildCarePlanViewModel(makeSnapshot()).sections.showReview).toBe(false);
  });
});

describe('buildCarePlanViewModel — sections.showTherapy', () => {
  it('is true when snapshot.therapyContractPresent is true', () => {
    const snapshot = makeSnapshot({ therapyContractPresent: true });
    expect(buildCarePlanViewModel(snapshot).sections.showTherapy).toBe(true);
  });

  it('is true when ADCP revision has a present therapy contract', () => {
    mockRevision.current = {
      patientId: PATIENT,
      identity: { version: 1, publishedAt: '2026-07-21T00:00:00Z', source: 'seed:onboarding', planId: `adcp:${PATIENT}:v1` },
      safetyEnvelope: { alwaysDo: [], neverDo: [] },
      goals: { goals: [] },
      carePriorities: { priorities: [] },
      therapyContract: { present: true },
    };
    expect(buildCarePlanViewModel(makeSnapshot()).sections.showTherapy).toBe(true);
  });

  it('is false when both snapshot flag and revision are absent', () => {
    expect(buildCarePlanViewModel(makeSnapshot()).sections.showTherapy).toBe(false);
  });
});

describe('buildCarePlanViewModel — sections.showFocus', () => {
  it('is true when UC4 priority cards exist', () => {
    const snapshot = makeSnapshot({
      latestUc4PriorityCards: [
        {
          cardId: 'c1',
          patientId: PATIENT,
          runId: 'r1',
          templateId: 't1',
          priorityKind: 'focus',
          title: 'Hydration',
          body: 'Drink water',
          domain: 'general',
          score: 0.7,
        } as PatientRecordSnapshot['latestUc4PriorityCards'][number],
      ],
    });
    const vm = buildCarePlanViewModel(snapshot);
    expect(vm.sections.showFocus).toBe(true);
    expect(vm.focusCards[0]?.source).toBe('uc4_live');
  });

  it('tags durable plan priorities separately from live cards', () => {
    mockRevision.current = {
      patientId: PATIENT,
      identity: {
        version: 1,
        publishedAt: '2026-07-21T00:00:00Z',
        source: 'seed:onboarding',
        planId: `adcp:${PATIENT}:v1`,
      },
      safetyEnvelope: { alwaysDo: [], neverDo: [] },
      goals: { goals: [] },
      carePriorities: {
        priorities: [
          {
            priorityId: 'pr1',
            sourceCardId: 'old-card',
            title: 'On plan priority',
            domain: 'safety',
            weight: 0.5,
            status: 'active',
          },
        ],
      },
      therapyContract: { present: false, reason: 'no_rehab_plan' },
    };
    const vm = buildCarePlanViewModel(makeSnapshot());
    expect(vm.focusCards.some((c) => c.source === 'plan_priority')).toBe(true);
  });
});

describe('buildCarePlanViewModel — safety lines', () => {
  it('collects alwaysDo + neverDo + safetyNotes from the revision', () => {
    mockRevision.current = {
      patientId: PATIENT,
      identity: { version: 2, publishedAt: '2026-07-21T00:00:00Z', source: 'seed:fhir_import', planId: `adcp:${PATIENT}:v2` },
      safetyEnvelope: {
        alwaysDo: ['Wash hands'],
        neverDo: ['Skip medication'],
        safetyNotes: 'Penicillin allergy.',
      },
      goals: { goals: [] },
      carePriorities: { priorities: [] },
      therapyContract: { present: false, reason: 'no_rehab_plan' },
    };
    const vm = buildCarePlanViewModel(makeSnapshot());
    expect(vm.safetyLines.map((l) => l.kind)).toEqual(['always', 'never', 'note']);
    expect(vm.sections.showSafety).toBe(true);
  });

  it('falls back to snapshot.safetyNotes when revision has no notes', () => {
    const snapshot = makeSnapshot({ safetyNotes: 'Caregiver note' });
    const vm = buildCarePlanViewModel(snapshot);
    expect(vm.safetyLines.some((l) => l.text === 'Caregiver note' && l.kind === 'note')).toBe(true);
  });
});

describe('buildCarePlanViewModel — version label', () => {
  it('uses snapshot.activeAdcpVersion when present', () => {
    const snapshot = makeSnapshot({
      activeAdcpVersion: {
        planId: `adcp:${PATIENT}:v4`,
        version: 4,
        publishedAt: '2026-07-15T12:00:00Z',
        source: 'seed:onboarding',
        therapyContractPresent: true,
        prioritiesCount: 2,
        medicationBindingsCount: 1,
      },
    });
    const vm = buildCarePlanViewModel(snapshot);
    expect(vm.versionLabel).toBe('Care plan v4');
    expect(vm.updatedLabel).toBe('2026-07-15');
  });

  it('falls back to "Care plan" / "Not published yet" when nothing is set', () => {
    const vm = buildCarePlanViewModel(makeSnapshot());
    expect(vm.versionLabel).toBe('Care plan');
    expect(vm.updatedLabel).toBe('Not published yet');
  });
});

describe('buildCarePlanViewModel — history', () => {
  it('exposes decision log digest when present', () => {
    mockDecisionLog.current = [
      { decisionId: 'd1', summary: 'A caregiver approved a threshold patch', createdAt: '2026-07-21T00:00:00Z' },
      { decisionId: 'd2', summary: 'ML applied priority promote', createdAt: '2026-07-20T00:00:00Z' },
    ];
    const vm = buildCarePlanViewModel(makeSnapshot());
    expect(vm.sections.showHistory).toBe(true);
    expect(vm.decisionDigest.length).toBe(2);
  });

  it('hides history when no decisions', () => {
    expect(buildCarePlanViewModel(makeSnapshot()).sections.showHistory).toBe(false);
  });
});
