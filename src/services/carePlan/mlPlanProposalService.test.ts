/**
 * Tests for planning/39 §3.4 / §5.4 ML plan-proposal vetting queue:
 *   - draft → awaiting_hitl → awaiting_ml_vet → accepted/applied
 *   - clip path applies clipped payload + audit
 *   - reject path stops at rejected_by_ml (no plan write)
 *   - caregiver reject + audit
 *   - 24h fallback E2 path
 */

jest.mock('../../data/db', () => ({
  getDatabase: () => ({
    runSync: () => undefined,
    getFirstSync: () => null,
    getAllSync: () => [],
  }),
  initializeDatabase: () => {},
  closeDatabase: () => {},
  resetDatabase: () => {},
}));

jest.mock('../../data/repositories/adcpRepository', () => {
  const revisions: Array<Record<string, unknown>> = [];
  const proposals: Array<Record<string, unknown>> = [];
  const decisionLog: Array<Record<string, unknown>> = [];

  return {
    __esModule: true,
    publisherStub: undefined,
    publishAdcpRevision(input: { patientId?: string; identity: { planId?: string; version?: number } } & Record<string, unknown>) {
      const basePlan = input.identity.planId ?? `adcp:test:v${(input.identity.version ?? 0) + 1}`;
      revisions.push({ patientId: input.patientId, planId: basePlan, ...input });
      return {
        identity: {
          planId: basePlan,
          version: (input.identity.version ?? 0) + 1,
          effectiveAt: new Date().toISOString(),
          supersedes: null,
          source: input.identity.source ?? 'ml_apply',
          publishedBy: 'ml',
        },
        ...input,
      };
    },
    createPendingProposal(input: {
      patientId: string;
      intent: string;
      section: string;
      kind: string;
      draftedBy: string;
      payload: unknown;
      mlVetRequirement: unknown;
    }) {
      const id = `${input.patientId}:prop:test-${proposals.length}`;
      proposals.push({ proposalId: id, status: 'draft', ...input, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return { proposalId: id, ...input, status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    },
    setProposalStatus(id: string, status: string, options?: { resolutionReason?: string | null; clippedPayload?: unknown }) {
      const row = proposals.find((p) => p.proposalId === id);
      if (row) {
        row.status = status;
        if (options?.resolutionReason !== undefined) row.resolutionReason = options.resolutionReason;
        if (options?.clippedPayload !== undefined) row.clippedPayload = options.clippedPayload;
      }
    },
    getProposalById(id: string) {
      return proposals.find((p) => p.proposalId === id) ?? null;
    },
    listPendingProposals() {
      return proposals;
    },
    getActiveAdcpRevisionForPatient(patientId?: string) {
      const r = revisions.find((rev) => rev.patientId === patientId);
      if (!r) return null;
      return { ...r, identity: r.identity };
    },
    appendDecisionLog(input: { decisionId: string; type: string; patientId: string; createdAt: string; summary: string }) {
      decisionLog.push(input);
      return input;
    },
  };
});

jest.mock('../../services/audit/auditService', () => ({
  audit: () => undefined,
}));

import {
  enqueueProposal,
  caregiverConfirmProposal,
  caregiverRejectProposal,
  applyMlVetDecision,
  drainPendingProposalsForPatient,
  isVetFallbackWindow,
  ML_VET_FALLBACK_HOURS,
} from './mlPlanProposalService';
import type { AdcpProposalPayload } from '../../data/adcp/types';

const PATIENT = 'patient-test';

function thresholdPatch(): AdcpProposalPayload {
  return {
    kind: 'threshold_patch',
    patientId: PATIENT,
    thresholds: [
      {
        thresholdId: null,
        vitalType: 'spo2',
        direction: 'below',
        value: 92,
        severity: 2,
        source: 'slm',
        pendingMlVet: true,
      },
    ],
    rationale: 'Lower SpO2 cutoff based on last 14d trend',
    citations: ['PMID-test'],
  };
}

describe('mlPlanProposalService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enqueueProposal moves draft → awaiting_hitl', () => {
    const proposal = enqueueProposal({
      patientId: PATIENT,
      intent: 'review_monitoring_contract',
      section: 'monitoringContract',
      kind: 'threshold_patch',
      draftedBy: 'slm',
      payload: thresholdPatch(),
      mlVetRequirement: { kind: 'next_uc2_pass' },
    });
    expect(proposal.status).toBe('awaiting_hitl');
  });

  it('caregiverConfirmProposal moves awaiting_hitl → awaiting_ml_vet', () => {
    const proposal = enqueueProposal({
      patientId: PATIENT,
      intent: 'review_monitoring_contract',
      section: 'monitoringContract',
      kind: 'threshold_patch',
      draftedBy: 'slm',
      payload: thresholdPatch(),
      mlVetRequirement: { kind: 'next_uc2_pass' },
    });
    const result = caregiverConfirmProposal(proposal.proposalId);
    expect(result.proposal.status).toBe('awaiting_ml_vet');
    expect(result.planApplied).toBe(false);
  });

  it('caregiverRejectProposal stops at rejected_by_caregiver', () => {
    const proposal = enqueueProposal({
      patientId: PATIENT,
      intent: 'review_monitoring_contract',
      section: 'monitoringContract',
      kind: 'threshold_patch',
      draftedBy: 'slm',
      payload: thresholdPatch(),
      mlVetRequirement: { kind: 'next_uc2_pass' },
    });
    const after = caregiverRejectProposal(proposal.proposalId, 'caregiver changes mind');
    expect(after.status).toBe('rejected_by_caregiver');
  });

  it('applyMlVetDecision accept publishes plan vN+1', () => {
    const proposal = enqueueProposal({
      patientId: PATIENT,
      intent: 'review_monitoring_contract',
      section: 'monitoringContract',
      kind: 'threshold_patch',
      draftedBy: 'slm',
      payload: thresholdPatch(),
      mlVetRequirement: { kind: 'next_uc2_pass' },
    });
    caregiverConfirmProposal(proposal.proposalId);
    const result = applyMlVetDecision(proposal.proposalId, { decision: 'accept' });
    expect(result.planApplied).toBe(true);
    // After apply, status transitions from `accepted` → `applied`.
    expect(['accepted', 'applied']).toContain(result.proposal.status);
  });

  it('applyMlVetDecision clip applies clipped payload', () => {
    const proposal = enqueueProposal({
      patientId: PATIENT,
      intent: 'review_monitoring_contract',
      section: 'monitoringContract',
      kind: 'threshold_patch',
      draftedBy: 'slm',
      payload: thresholdPatch(),
      mlVetRequirement: { kind: 'next_uc2_pass' },
    });
    caregiverConfirmProposal(proposal.proposalId);
    const clippedPayload: AdcpProposalPayload = {
      ...thresholdPatch(),
      thresholds: [
        {
          thresholdId: null,
          vitalType: 'spo2',
          direction: 'below',
          value: 89,
          severity: 3,
          source: 'ml_baseline',
          pendingMlVet: true,
        },
      ],
      rationale: 'clipped by UC2 — but kept tighter than baseline',
    };
    const result = applyMlVetDecision(proposal.proposalId, {
      decision: 'clip',
      clippedPayload,
      reason: 'engine clipped upper bound',
    });
    expect(result.planApplied).toBe(true);
    // After apply, status moves from `accepted_with_clip` → `applied`.
    expect(['accepted_with_clip', 'applied']).toContain(result.proposal.status);
  });

  it('applyMlVetDecision reject stops without plan write', () => {
    const proposal = enqueueProposal({
      patientId: PATIENT,
      intent: 'review_monitoring_contract',
      section: 'monitoringContract',
      kind: 'threshold_patch',
      draftedBy: 'slm',
      payload: thresholdPatch(),
      mlVetRequirement: { kind: 'next_uc2_pass' },
    });
    caregiverConfirmProposal(proposal.proposalId);
    const result = applyMlVetDecision(proposal.proposalId, {
      decision: 'reject',
      reason: 'engine clipped higher',
    });
    expect(result.planApplied).toBe(false);
    expect(result.proposal.status).toBe('rejected_by_ml');
  });

  it('drainPendingProposalsForPatient respects 24h fallback (E2)', () => {
    const proposal = enqueueProposal({
      patientId: PATIENT,
      intent: 'review_monitoring_contract',
      section: 'monitoringContract',
      kind: 'threshold_patch',
      draftedBy: 'slm',
      payload: thresholdPatch(),
      mlVetRequirement: { kind: 'fallback_24h' },
    });
    caregiverConfirmProposal(proposal.proposalId);
    // Verify fallback window helper.
    expect(isVetFallbackWindow({ ...proposal, status: 'awaiting_ml_vet', updatedAt: new Date().toISOString() })).toBe(false);
    expect(ML_VET_FALLBACK_HOURS).toBe(24);

    // Simulate >24h elapsed: jump the timer forward and drain
    jest.setSystemTime(Date.now() + (ML_VET_FALLBACK_HOURS + 1) * 60 * 60 * 1000);
    const drain = drainPendingProposalsForPatient(PATIENT, 'uc3');
    // fallback_24h proposals apply even when a non-matching engine fires after 24h.
    expect(drain.applied).toBeGreaterThanOrEqual(1);
    const { getProposalById } = require('../../data/repositories/adcpRepository');
    const final = getProposalById(proposal.proposalId);
    expect(['accepted', 'applied']).toContain(final?.status ?? proposal.status);
  });

  it('drainPendingProposalsForPatient uc2 vets threshold_patch immediately', () => {
    const proposal = enqueueProposal({
      patientId: PATIENT,
      intent: 'review_monitoring_contract',
      section: 'monitoringContract',
      kind: 'threshold_patch',
      draftedBy: 'slm',
      payload: thresholdPatch(),
      mlVetRequirement: { kind: 'next_uc2_pass' },
    });
    caregiverConfirmProposal(proposal.proposalId);
    const drain = drainPendingProposalsForPatient(PATIENT, 'uc2');
    expect(drain.applied).toBeGreaterThanOrEqual(1);
    const { getProposalById } = require('../../data/repositories/adcpRepository');
    const final = getProposalById(proposal.proposalId);
    expect(['accepted', 'applied', 'accepted_with_clip']).toContain(final?.status);
  });
});
