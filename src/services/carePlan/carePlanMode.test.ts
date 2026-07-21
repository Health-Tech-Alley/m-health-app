/**
 * Tests for planning/41 §6 read-only mode gate.
 *
 * Verifies:
 *   - getCarePlanMode / isCarePlanWritable read app_settings.carePlanMode
 *     with default 'full' (writable).
 *   - assertCarePlanWritable blocks when mode is 'read_only' with a typed
 *     reason + caregiver-safe message.
 *   - MUTATING_INTENTS contains exactly the four doc-41 mutating intents
 *     (and excludes the explain / handoff / logging-suggest intents).
 *   - caregiverConfirmProposal returns a blocked result in read-only mode
 *     without changing proposal status.
 *   - drainPendingProposalsForPatient returns zero counts in read-only mode
 *     even when there are pending proposals.
 *   - runIntent returns a blocked result for mutating intents in read_only
 *     mode and skips the proposal enqueue for non-mutating intents.
 */

// --- App settings mock: tests toggle carePlanMode via mocked getAppSettings. ---
const mockAppSettings: { current: { carePlanMode: 'full' | 'read_only' } } = {
  current: { carePlanMode: 'full' },
};

jest.mock('@/data/repositories/appSettingsRepository', () => ({
  getAppSettings: () => mockAppSettings.current,
}));

// --- DB mock: getDatabase returns a stub; we don't need real SQLite. ---
jest.mock('@/data/db', () => ({
  getDatabase: () => ({
    runSync: () => undefined,
    getFirstSync: () => null,
    getAllSync: () => [],
  }),
  initializeDatabase: () => {},
  closeDatabase: () => {},
  resetDatabase: () => {},
}));

// --- ADCP repo mock: only what mlPlanProposalService + contextAssembler touch. ---
const mockProposals: Array<Record<string, unknown>> = [];
jest.mock('@/data/repositories/adcpRepository', () => ({
  __esModule: true,
  getProposalById: (id: string) =>
    mockProposals.find((p) => p.proposalId === id) ?? null,
  listPendingProposals: (_patientId: string) =>
    mockProposals.filter((p) =>
      ['awaiting_hitl', 'awaiting_ml_vet', 'draft'].includes(p.status as string),
    ),
  listPendingProposalSummaries: () => [],
  getActiveAdcpRevisionForPatient: () => null,
  getActiveAdcpVersionSummary: () => null,
  planHasTherapyContract: () => false,
  createPendingProposal: (input: Record<string, unknown>) => {
    const id = `prop-test-${mockProposals.length}`;
    const row = {
      proposalId: id,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resolvedAt: null,
      resolutionReason: null,
      clippedPayload: null,
      ...input,
    };
    mockProposals.push(row);
    return row;
  },
  setProposalStatus: (id: string, status: string) => {
    const row = mockProposals.find((p) => p.proposalId === id);
    if (row) row.status = status;
  },
  publishAdcpRevision: () => {
    throw new Error('not used in read-only gate test');
  },
  appendDecisionLog: () => undefined,
}));

jest.mock('@/services/audit/auditService', () => ({
  audit: () => undefined,
}));

import {
  assertCarePlanWritable,
  getCarePlanMode,
  isCarePlanWritable,
  isMutatingIntent,
  MUTATING_INTENTS,
} from '@/services/carePlan/carePlanMode';
import {
  caregiverConfirmProposal,
  drainPendingProposalsForPatient,
  enqueueProposal,
} from '@/services/carePlan/mlPlanProposalService';
import { runIntent } from '@/services/carePlan/intentRouter';
import { INTENT_CATALOG } from '@/services/carePlan/intentCatalog';
import type { PatientRecordSnapshot } from '@/data/types';

const PATIENT = 'patient-readonly-test';

const TEST_SNAPSHOT = {
  patient: {
    patientId: PATIENT,
    name: 'Test Patient',
    preferredName: 'Test',
    age: '30',
  },
  primaryCondition: null,
  comorbidities: [],
  symptoms: [],
  thresholds: [],
  carePlan: null,
  carePlans: [],
  rehabPlanMetrics: [],
  rehabExerciseAssignments: [],
  medications: [],
  safetyNotes: '',
  latestUc3TrajectoryResult: null,
  latestUc4PriorityCards: [],
  bundlePending: false,
  bundleStatus: { state: 'complete', chunksAdded: 0 },
  activeAdcpVersion: null,
  pendingPlanProposals: [],
  therapyContractPresent: false,
} as unknown as PatientRecordSnapshot;

beforeEach(() => {
  mockAppSettings.current = { carePlanMode: 'full' };
  mockProposals.length = 0;
});

describe('carePlanMode.getCarePlanMode / isCarePlanWritable', () => {
  it('default mode is "full" and writable', () => {
    expect(getCarePlanMode()).toBe('full');
    expect(isCarePlanWritable()).toBe(true);
  });

  it('read_only mode is not writable', () => {
    mockAppSettings.current = { carePlanMode: 'read_only' };
    expect(getCarePlanMode()).toBe('read_only');
    expect(isCarePlanWritable()).toBe(false);
  });
});

describe('carePlanMode.assertCarePlanWritable', () => {
  it('returns ok when writable and patient is set', () => {
    const result = assertCarePlanWritable({ activePatientId: PATIENT });
    expect(result.ok).toBe(true);
  });

  it('returns ok when writable and no patient check is requested', () => {
    expect(assertCarePlanWritable().ok).toBe(true);
  });

  it('blocks in read_only with read_only_mode reason + message', () => {
    mockAppSettings.current = { carePlanMode: 'read_only' };
    const result = assertCarePlanWritable({ activePatientId: PATIENT });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('read_only_mode');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('blocks on no active patient when check is requested', () => {
    const result = assertCarePlanWritable({ activePatientId: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_active_patient');
  });
});

describe('MUTATING_INTENTS set', () => {
  it('contains the four doc-41 mutating intents', () => {
    expect(MUTATING_INTENTS.has('review_monitoring_contract')).toBe(true);
    expect(MUTATING_INTENTS.has('propose_therapy_contract_patch')).toBe(true);
    expect(MUTATING_INTENTS.has('promote_uc4_to_plan_task')).toBe(true);
    expect(MUTATING_INTENTS.has('weekly_care_plan_review')).toBe(true);
  });

  it('does not contain explain / handoff / logging-suggest intents', () => {
    expect(MUTATING_INTENTS.has('explain_uc2_alert')).toBe(false);
    expect(MUTATING_INTENTS.has('explain_uc3_result')).toBe(false);
    expect(MUTATING_INTENTS.has('explain_uc4_card')).toBe(false);
    expect(MUTATING_INTENTS.has('handoff_summary')).toBe(false);
    expect(MUTATING_INTENTS.has('suggest_todays_logging')).toBe(false);
  });

  it('isMutatingIntent matches MUTATING_INTENTS for every catalog entry', () => {
    for (const intentId of Object.keys(INTENT_CATALOG) as Array<
      keyof typeof INTENT_CATALOG
    >) {
      expect(isMutatingIntent(intentId)).toBe(MUTATING_INTENTS.has(intentId));
    }
  });
});

describe('caregiverConfirmProposal gate', () => {
  it('moves draft → awaiting_ml_vet in full mode', () => {
    const proposal = enqueueProposal({
      patientId: PATIENT,
      intent: 'review_monitoring_contract',
      section: 'monitoringContract',
      kind: 'threshold_patch',
      draftedBy: 'slm',
      payload: { kind: 'threshold_patch', patientId: PATIENT, thresholds: [], rationale: '', citations: [] },
      mlVetRequirement: { kind: 'next_uc2_pass' },
    });
    const result = caregiverConfirmProposal(proposal.proposalId);
    expect(result.blocked).toBeUndefined();
    expect(result.proposal.status).toBe('awaiting_ml_vet');
  });

  it('returns a blocked result in read-only mode without changing status', () => {
    const proposal = enqueueProposal({
      patientId: PATIENT,
      intent: 'review_monitoring_contract',
      section: 'monitoringContract',
      kind: 'threshold_patch',
      draftedBy: 'slm',
      payload: { kind: 'threshold_patch', patientId: PATIENT, thresholds: [], rationale: '', citations: [] },
      mlVetRequirement: { kind: 'next_uc2_pass' },
    });
    mockAppSettings.current = { carePlanMode: 'read_only' };
    const result = caregiverConfirmProposal(proposal.proposalId);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe('read_only_mode');
    expect(result.proposal.status).toBe('awaiting_hitl');
    expect(result.planApplied).toBe(false);
  });
});

describe('drainPendingProposalsForPatient gate', () => {
  it('returns zero counts in read-only mode even with pending proposals', () => {
    enqueueProposal({
      patientId: PATIENT,
      intent: 'review_monitoring_contract',
      section: 'monitoringContract',
      kind: 'threshold_patch',
      draftedBy: 'slm',
      payload: { kind: 'threshold_patch', patientId: PATIENT, thresholds: [], rationale: '', citations: [] },
      mlVetRequirement: { kind: 'next_uc2_pass' },
    });
    enqueueProposal({
      patientId: PATIENT,
      intent: 'promote_uc4_to_plan_task',
      section: 'carePriorities',
      kind: 'priority_promote',
      draftedBy: 'slm',
      payload: {
        kind: 'priority_promote',
        patientId: PATIENT,
        priority: {
          priorityId: 'p1',
          title: 'Hydration',
          description: 'Every 4h',
          domain: 'general',
          weight: 0.5,
        },
        sourceCardId: 'card-1',
        rationale: 'Test',
      },
      mlVetRequirement: { kind: 'next_uc4_run' },
    });
    mockAppSettings.current = { carePlanMode: 'read_only' };
    const result = drainPendingProposalsForPatient(PATIENT, 'all');
    expect(result).toEqual({ applied: 0, rejected: 0, deferred: 0 });
  });
});

describe('runIntent gate', () => {
  it('blocks mutating intent in read-only mode without calling SLM', async () => {
    mockAppSettings.current = { carePlanMode: 'read_only' };
    const slmCalls: string[] = [];
    const result = await runIntent({
      snapshot: TEST_SNAPSHOT,
      intent: 'review_monitoring_contract',
      args: { snapshot: TEST_SNAPSHOT },
      completePrompt: async () => {
        slmCalls.push('called');
        return 'should not be reached';
      },
    });
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe('read_only_mode');
    expect(result.enqueuedProposalIds).toEqual([]);
    expect(slmCalls).toEqual([]);
  });

  it('runs non-mutating intent in read-only mode but skips enqueue', async () => {
    mockAppSettings.current = { carePlanMode: 'read_only' };
    const result = await runIntent({
      snapshot: TEST_SNAPSHOT,
      intent: 'explain_uc4_card',
      args: { snapshot: TEST_SNAPSHOT, cardId: 'card-x' },
      completePrompt: async () => 'Plain explanation.',
    });
    expect(result.blocked).toBeUndefined();
    expect(result.enqueuedProposalIds).toEqual([]);
  });
});
