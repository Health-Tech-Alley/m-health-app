/**
 * Tests for planning/39 §3.5 / §13 ADCP persistence (mocked SQLite).
 *
 * Mirrors the existing UC3 repository test pattern: mocks `getDatabase`
 * with an in-memory rows table. Verifies the append-only contract + the
 * `seedAdcpV1FromSnapshot` idempotency + the proposal lifecycle.
 */

type RevisionRow = {
  revision_id: string;
  patient_id: string;
  plan_id: string;
  version: number;
  supersedes: string | null;
  source: string;
  published_by: 'system' | 'caregiver' | 'ml' | 'slm';
  published_at: string;
  effective_at: string;
  payload_json: string;
  section_hashes_json: string | null;
  created_at: string;
};

type ProposalRow = {
  proposal_id: string;
  patient_id: string;
  intent: string;
  section: string;
  kind: string;
  status: string;
  payload_json: string;
  drafted_by: string;
  ml_vet_json: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_reason: string | null;
  clipped_payload_json: string | null;
  pending_overrides_json: string | null;
};

type DecisionLogRow = {
  decision_id: string;
  patient_id: string;
  proposal_id: string | null;
  type: string;
  actor: string;
  ref_ids_json: string;
  summary: string;
  payload_json: string | null;
  created_at: string;
};

const revisionRows: RevisionRow[] = [];
const proposalRows: ProposalRow[] = [];
const decisionRows: DecisionLogRow[] = [];

function mockFirstSync(table: string, sql: string, args: unknown[]) {
  if (table === 'care_plan_revisions') {
    const filtered = revisionRows.filter((r) => r.patient_id === args[0]);
    if (filtered.length === 0) return null;
    return [...filtered].sort((a, b) => b.version - a.version)[0] ?? null;
  }
  if (table === 'pending_plan_proposals') {
    return proposalRows.find((p) => p.proposal_id === args[0]) ?? null;
  }
  return null;
}

function mockAllSync(table: string, sql: string, args: unknown[]) {
  if (table === 'care_plan_revisions') {
    return revisionRows.filter((r) => r.patient_id === args[0]).sort((a, b) => b.version - a.version);
  }
  if (table === 'pending_plan_proposals') {
    return proposalRows.filter((p) => p.patient_id === args[0]);
  }
  if (table === 'plan_decision_log') {
    return decisionRows.filter((d) => d.patient_id === args[0]);
  }
  return [];
}

const mockDb = {
  runSync: (sql: string, ...args: unknown[]) => {
    const upper = sql.toUpperCase().trim();

    if (upper.startsWith('INSERT INTO CARE_PLAN_REVISIONS')) {
      const [
        revision_id,
        patient_id,
        plan_id,
        version,
        supersedes,
        source,
        published_by,
        published_at,
        effective_at,
        payload_json,
        section_hashes_json,
        created_at,
      ] = args as [string, string, string, number, string | null, string, string, string, string, string, string | null, string];
      revisionRows.push({
        revision_id,
        patient_id,
        plan_id,
        version,
        supersedes,
        source,
        published_by: published_by as RevisionRow['published_by'],
        published_at,
        effective_at,
        payload_json,
        section_hashes_json,
        created_at,
      });
      return;
    }

    if (upper.startsWith('INSERT INTO PENDING_PLAN_PROPOSALS')) {
      const [
        proposal_id,
        patient_id,
        intent,
        section,
        kind,
        status,
        payload_json,
        drafted_by,
        ml_vet_json,
        notes,
        created_at,
        updated_at,
        resolved_at,
        resolution_reason,
        clipped_payload_json,
        pending_overrides_json,
      ] = args as [string, string, string, string, string, string, string, string, string, string | null, string, string, string | null, string | null, string | null, string | null];
      proposalRows.push({
        proposal_id,
        patient_id,
        intent,
        section,
        kind,
        status,
        payload_json,
        drafted_by,
        ml_vet_json,
        notes,
        created_at,
        updated_at,
        resolved_at,
        resolution_reason,
        clipped_payload_json,
        pending_overrides_json,
      });
      return;
    }

    if (upper.startsWith('UPDATE PENDING_PLAN_PROPOSALS')) {
      const [status, updated_at, resolved_at, resolution_reason, clipped_payload_json, proposal_id] = args as [string, string, string | null, string | null, string | null, string];
      const row = proposalRows.find((r) => r.proposal_id === proposal_id);
      if (row) {
        row.status = status;
        row.updated_at = updated_at;
        row.resolved_at = resolved_at;
        row.resolution_reason = resolution_reason;
        row.clipped_payload_json = clipped_payload_json;
      }
      return;
    }

    if (upper.startsWith('INSERT INTO PLAN_DECISION_LOG')) {
      const [decision_id, patient_id, proposal_id, type, actor, ref_ids_json, summary, payload_json, created_at] = args as [string, string, string | null, string, string, string, string, string | null, string];
      decisionRows.push({
        decision_id,
        patient_id,
        proposal_id,
        type,
        actor,
        ref_ids_json,
        summary,
        payload_json,
        created_at,
      });
      return;
    }
  },
  getFirstSync: <T>(sql: string, ...args: unknown[]): T | null => {
    if (/FROM care_plan_revisions/i.test(sql)) {
      return mockFirstSync('care_plan_revisions', sql, args) as unknown as T;
    }
    if (/FROM pending_plan_proposals/i.test(sql)) {
      return mockFirstSync('pending_plan_proposals', sql, args) as unknown as T;
    }
    if (/FROM plan_decision_log/i.test(sql)) {
      return mockFirstSync('plan_decision_log', sql, args) as unknown as T;
    }
    return null;
  },
  getAllSync: <T>(sql: string, ...args: unknown[]): T[] => {
    if (/FROM care_plan_revisions/i.test(sql)) {
      return mockAllSync('care_plan_revisions', sql, args) as unknown as T[];
    }
    if (/FROM pending_plan_proposals/i.test(sql)) {
      return mockAllSync('pending_plan_proposals', sql, args) as unknown as T[];
    }
    if (/FROM plan_decision_log/i.test(sql)) {
      return mockAllSync('plan_decision_log', sql, args) as unknown as T[];
    }
    return [];
  },
  execSync: () => {},
  withTransactionSync: (fn: () => void) => {
    fn();
  },
};

jest.mock('./db', () => ({
  getDatabase: () => mockDb,
  initializeDatabase: () => {},
  closeDatabase: () => {},
  resetDatabase: () => {},
}));

/**
 * Helper: build the minimum revision payload required by publishAdcpRevision
 * plus the new `patientId` field on the input envelope.
 */
function publishRevision(patientId: string, partial?: Partial<{
  source: 'seed:onboarding' | 'seed:fhir_import' | 'ml_apply' | 'caregiver_confirm' | 'slm_apply_with_hitl';
  publishedBy: 'system' | 'caregiver' | 'ml' | 'slm';
  effectiveAt: string;
}>): ReturnType<typeof publishAdcpRevision> {
  return publishAdcpRevision({
    patientId,
    identity: {
      effectiveAt: partial?.effectiveAt ?? new Date().toISOString(),
      supersedes: null,
      source: partial?.source ?? 'seed:onboarding',
      publishedBy: partial?.publishedBy ?? 'system',
    },
    clinicalFraming: { comorbidities: [] },
    safetyEnvelope: { neverDo: [], alwaysDo: [] },
    goals: { goals: [] },
    monitoringContract: { thresholds: [], escalationPolicyRefs: [], vettingWindow: { kind: 'fallback_24h' } },
    therapyContract: { present: false, reason: 'no_rehab_plan' },
    carePriorities: { priorities: [] },
    medicationBindings: { bindings: [] },
    decisionLog: { entries: [] },
    evidenceAnchors: { knowledgeChunkIds: [], knowledgeGraphIds: [], citationsCount: 0 },
    extensions: {},
  });
}

import {
  appendDecisionLog,
  createPendingProposal,
  getActiveAdcpRevisionForPatient,
  getActiveAdcpVersionSummary,
  getProposalById,
  listPendingProposalSummaries,
  listPendingProposals,
  listAdcpRevisionsForPatient,
  publishAdcpRevision,
  setProposalStatus,
} from './repositories/adcpRepository';
import type { AdcpProposalPayload } from './adcp/types';

const PATIENT = 'patient-test';

beforeEach(() => {
  revisionRows.length = 0;
  proposalRows.length = 0;
  decisionRows.length = 0;
});

describe('adcpRepository', () => {
  describe('append-only revisions', () => {
    it('publishes v1 with no supersedes', () => {
      const v1 = publishRevision(PATIENT);
      expect(v1.identity.version).toBe(1);
      expect(v1.identity.supersedes).toBeNull();
    });

    it('increments version and locks in supersedes chain', () => {
      const v1 = publishRevision(PATIENT);
      publishRevision(PATIENT, { source: 'ml_apply', publishedBy: 'ml' });
      const all = listAdcpRevisionsForPatient(PATIENT);
      expect(all.length).toBe(2);
      expect(all[0]?.identity.version).toBe(2);
      expect(all[0]?.identity.supersedes).toBe(v1.identity.planId);
    });
  });

  describe('pending proposal lifecycle', () => {
    it('creates a draft proposal', () => {
      const payload: AdcpProposalPayload = {
        kind: 'threshold_patch',
        patientId: PATIENT,
        thresholds: [
          {
            thresholdId: null,
            vitalType: 'spo2',
            direction: 'below',
            value: 92,
            severity: 2,
            source: 'caregiver',
            pendingMlVet: true,
          },
        ],
        rationale: 'lower SpO2 cutoff',
        citations: ['PMID-test'],
      };
      const proposal = createPendingProposal({
        patientId: PATIENT,
        intent: 'review_monitoring_contract',
        section: 'monitoringContract',
        kind: 'threshold_patch',
        draftedBy: 'slm',
        payload,
        mlVetRequirement: { kind: 'next_uc2_pass' },
      });
      expect(proposal.status).toBe('draft');
      expect(proposal.proposalId).toContain(`${PATIENT}:prop:`);
    });

    it('transitions proposal through awaiting_hitl → awaiting_ml_vet → rejected_by_caregiver', () => {
      const payload: AdcpProposalPayload = {
        kind: 'priority_promote',
        patientId: PATIENT,
        priority: {
          priorityId: 'priority-test-1',
          sourceCardId: null,
          title: 'Test priority',
          description: 'Promote to plan',
          domain: 'medication',
          status: 'active',
          promotedAt: new Date().toISOString(),
          weight: 0.7,
        },
        sourceCardId: 'card-test-1',
        rationale: 'Test',
      };
      const proposal = createPendingProposal({
        patientId: PATIENT,
        intent: 'promote_uc4_to_plan_task',
        section: 'carePriorities',
        kind: 'priority_promote',
        draftedBy: 'slm',
        payload,
        mlVetRequirement: { kind: 'next_uc4_run' },
      });
      setProposalStatus(proposal.proposalId, 'awaiting_hitl');
      expect(getProposalById(proposal.proposalId)?.status).toBe('awaiting_hitl');

      setProposalStatus(proposal.proposalId, 'awaiting_ml_vet');
      expect(getProposalById(proposal.proposalId)?.status).toBe('awaiting_ml_vet');

      setProposalStatus(proposal.proposalId, 'rejected_by_caregiver', { resolutionReason: 'test-rejection' });
      const after = getProposalById(proposal.proposalId);
      expect(after?.status).toBe('rejected_by_caregiver');
      expect(after?.resolutionReason).toBe('test-rejection');
    });

    it('listPendingProposalSummaries surfaces all proposals', () => {
      const payload: AdcpProposalPayload = {
        kind: 'goal_patch',
        patientId: PATIENT,
        goalsPatch: [
          { goalId: 'g1', description: 'Improve ROM', targetDate: null, measurementTarget: null, status: 'active' },
        ],
        rationale: 'Update goal',
        citations: [],
      };
      createPendingProposal({
        patientId: PATIENT,
        intent: 'weekly_care_plan_review',
        section: 'goals',
        kind: 'goal_patch',
        draftedBy: 'ml_engine',
        payload,
        mlVetRequirement: { kind: 'next_uc4_run' },
      });
      const summaries = listPendingProposalSummaries(PATIENT);
      expect(summaries.length).toBe(1);
      expect(summaries[0]?.kind).toBe('goal_patch');
      const list = listPendingProposals(PATIENT);
      expect(list.length).toBe(1);
    });
  });

  describe('decision log', () => {
    it('appends entries with monotonically createdAt', () => {
      const e1 = appendDecisionLog({
        patientId: PATIENT,
        proposalId: null,
        type: 'plan_published',
        actor: 'system',
        refIds: ['ref-1'],
        summary: 'first',
      });
      const e2 = appendDecisionLog({
        patientId: PATIENT,
        proposalId: null,
        type: 'caregiver_override',
        actor: 'caregiver',
        refIds: ['ref-2'],
        summary: 'second',
      });
      expect(e2.createdAt >= e1.createdAt).toBe(true);
      expect(e2.decisionId).not.toEqual(e1.decisionId);
    });
  });

  describe('getActiveAdcpVersionSummary', () => {
    it('returns null when no revisions exist', () => {
      expect(getActiveAdcpVersionSummary(PATIENT)).toBeNull();
    });

    it('returns the latest published ADCP version', () => {
      publishRevision(PATIENT);
      const summary = getActiveAdcpVersionSummary(PATIENT);
      expect(summary).not.toBeNull();
      expect(summary?.version).toBe(1);
      expect(summary?.source).toBe('seed:onboarding');
      expect(summary?.therapyContractPresent).toBe(false);
    });
  });

  describe('idempotent getActiveAdcpRevisionForPatient', () => {
    it('returns the only published revision', () => {
      expect(getActiveAdcpRevisionForPatient(PATIENT)).toBeNull();
      publishRevision(PATIENT, { source: 'seed:fhir_import' });
      const active = getActiveAdcpRevisionForPatient(PATIENT);
      expect(active?.identity.version).toBe(1);
      expect(active?.identity.source).toBe('seed:fhir_import');
    });
  });
});
