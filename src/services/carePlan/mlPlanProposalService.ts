/**
 * ML plan-proposal vetting queue (planning/39 §5.4, E2, §3.4).
 *
 * Canonical ordering:
 *   caregiver / SLM proposal
 *     → pending_plan_proposal (status: awaiting_hitl)
 *     → caregiver HITL confirm (required)
 *     → ml_vetting_queue (status: awaiting_ml_vet)
 *     → next UC2 and/or UC3 and/or UC4 eval (or 24h fallback)
 *        ├─ accept →  apply overlay + ADCP vN+1
 *        ├─ modify (clip) → optional second HITL → apply or reject
 *        └─ reject → log; no plan write
 *   → audit + trigger_event + KG project-on-write
 *
 * The SLM may draft proposals; it may NOT mutate plan state directly.
 * Engines + HITL are the only writers to ADCP revisions + threshold /
 * therapy / priority rows.
 */

import { getDatabase } from '@/data/db';
import {
  appendDecisionLog,
  createPendingProposal,
  getActiveAdcpRevisionForPatient,
  getProposalById,
  listPendingProposals,
  publishAdcpRevision,
  setProposalStatus,
} from '@/data/repositories/adcpRepository';
import type {
  AdcpCarePrioritySection,
  AdcpMonitoringContractSection,
  AdcpMonitoringThresholdClause,
  AdcpPlanDocument,
  AdcpProposalPayload,
  AdcpProposalStatus,
  PendingPlanProposal,
} from '@/data/adcp/types';
import { audit } from '@/services/audit/auditService';
import { assertCarePlanWritable } from './carePlanMode';

const VET_FALLBACK_HOURS = 24;

export type EnqueueProposalInput = Parameters<typeof createPendingProposal>[0];

export function enqueueProposal(input: EnqueueProposalInput): PendingPlanProposal {
  const proposal = createPendingProposal({ ...input });
  // Move straight to awaiting_hitl — the SLM has drafted, but the caregiver
  // must explicitly confirm before the queue hands it to ML vetting.
  setProposalStatus(proposal.proposalId, 'awaiting_hitl');
  return { ...proposal, status: 'awaiting_hitl' };
}

/**
 * Caregiver-confirms a proposal. Moves it into the ML-vetting queue. The
 * engines will pick it up on the next pass.
 *
 * In read-only mode (planning/41 D1) the plan rejects any new mutation,
 * so confirm is a no-op. The proposal is returned untouched with
 * `planApplied: false` and a `blocked` field for callers that want to
 * surface a caregiver-safe message.
 */
export function caregiverConfirmProposal(
  proposalId: string,
  options?: { note?: string },
): {
  proposal: PendingPlanProposal;
  planApplied: boolean;
  blocked?: boolean;
  blockReason?: 'read_only_mode';
  blockMessage?: string;
} {
  const gate = assertCarePlanWritable();
  if (!gate.ok) {
    const existing = getProposalById(proposalId);
    if (!existing) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }
    return {
      proposal: existing,
      planApplied: false,
      blocked: true,
      blockReason: 'read_only_mode',
      blockMessage: gate.message,
    };
  }
  const proposal = getProposalById(proposalId);
  if (!proposal) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }
  if (proposal.status !== 'awaiting_hitl' && proposal.status !== 'draft') {
    throw new Error(
      `Proposal cannot be caregiver-confirmed in status=${proposal.status}`,
    );
  }
  setProposalStatus(proposalId, 'awaiting_ml_vet', {
    resolutionReason: options?.note ?? null,
  });
  audit({
    actor: 'caregiver',
    action: 'proposal_confirmed',
    resourceType: 'plan_proposal',
    resourceId: proposalId,
    patientId: proposal.patientId,
    payload: { section: proposal.section, kind: proposal.kind, note: options?.note ?? null },
  });
  appendDecisionLog({
    patientId: proposal.patientId,
    proposalId,
    type: 'proposal_caregiver_confirmed',
    actor: 'caregiver',
    refIds: [proposalId, proposal.section, proposal.kind],
    summary: `Caregiver confirmed ${proposal.kind} proposal`,
    payload: { section: proposal.section, kind: proposal.kind, note: options?.note ?? null },
  });

  // Vet-less kinds ("note_wording" with mlVetRequirement 'none') have no
  // inline apply path yet — do NOT claim planApplied until one exists.
  // (No catalog intent currently produces note_wording proposals.)
  return { proposal: getProposalById(proposalId)!, planApplied: false };
}

/**
 * Caregiver rejects the proposal before ML vetting. Stops the queue without
 * writing to ADCP.
 */
export function caregiverRejectProposal(
  proposalId: string,
  reason?: string,
): PendingPlanProposal {
  const proposal = getProposalById(proposalId);
  if (!proposal) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }
  if (proposal.status === 'applied' || proposal.status === 'rejected_by_ml') {
    throw new Error(`Proposal is already finalized (status=${proposal.status})`);
  }
  setProposalStatus(proposalId, 'rejected_by_caregiver', { resolutionReason: reason ?? null });
  audit({
    actor: 'caregiver',
    action: 'proposal_rejected',
    resourceType: 'plan_proposal',
    resourceId: proposalId,
    patientId: proposal.patientId,
    payload: { reason: reason ?? null },
  });
  appendDecisionLog({
    patientId: proposal.patientId,
    proposalId,
    type: 'proposal_rejected',
    actor: 'caregiver',
    refIds: [proposalId],
    summary: `Caregiver rejected proposal: ${reason ?? 'no reason'}`,
    payload: { reason: reason ?? null },
  });
  return { ...proposal, status: 'rejected_by_caregiver', resolvedAt: new Date().toISOString(), resolutionReason: reason ?? null };
}

export type MlVetOutcome =
  | { decision: 'accept'; clippedPayload?: undefined }
  | { decision: 'clip'; clippedPayload: AdcpProposalPayload; reason: string }
  | { decision: 'reject'; reason: string };

/**
 * Engine pathway: after UC2/UC3/UC4 (or 24h fallback) evaluates the
 * proposal, the engine calls this. We:
 *   - accept  → apply to ADCP + threshold/priority tables + audit
 *   - clip    → mark proposal accepted_with_clip + apply clipped payload
 *   - reject  → mark proposal rejected_by_ml + audit (no plan write)
 */
export function applyMlVetDecision(
  proposalId: string,
  outcome: MlVetOutcome,
): { proposal: PendingPlanProposal; planApplied: boolean } {
  const proposal = getProposalById(proposalId);
  if (!proposal) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }
  if (proposal.status !== 'awaiting_ml_vet') {
    throw new Error(`Proposal must be in awaiting_ml_vet to vet; got status=${proposal.status}`);
  }

  if (outcome.decision === 'reject') {
    setProposalStatus(proposalId, 'rejected_by_ml', { resolutionReason: outcome.reason });
    appendDecisionLog({
      patientId: proposal.patientId,
      proposalId,
      type: 'proposal_ml_rejected',
      actor: 'ml',
      refIds: [proposalId],
      summary: `ML rejected: ${outcome.reason}`,
      payload: { reason: outcome.reason },
    });
    audit({
      actor: 'orchestrator',
      action: 'proposal_rejected_by_ml',
      resourceType: 'plan_proposal',
      resourceId: proposalId,
      patientId: proposal.patientId,
      payload: { reason: outcome.reason, ml: true },
    });
    return { proposal: getProposalById(proposalId)!, planApplied: false };
  }

  if (outcome.decision === 'clip') {
    setProposalStatus(proposalId, 'accepted_with_clip', {
      clippedPayload: outcome.clippedPayload,
      resolutionReason: outcome.reason,
    });
    appendDecisionLog({
      patientId: proposal.patientId,
      proposalId,
      type: 'proposal_ml_clipped',
      actor: 'ml',
      refIds: [proposalId],
      summary: `ML clipped proposal: ${outcome.reason}`,
      payload: { reason: outcome.reason },
    });
    audit({
      actor: 'orchestrator',
      action: 'proposal_clipped_by_ml',
      resourceType: 'plan_proposal',
      resourceId: proposalId,
      patientId: proposal.patientId,
      payload: { reason: outcome.reason, ml: true },
    });
    const planApplied = applyProposalToPlan(proposal, { payloadOverride: outcome.clippedPayload });
    return { proposal: getProposalById(proposalId)!, planApplied };
  }

  // accept
  setProposalStatus(proposalId, 'accepted', { resolutionReason: 'accepted_by_ml' });
  appendDecisionLog({
    patientId: proposal.patientId,
    proposalId,
    type: 'proposal_ml_accepted',
    actor: 'ml',
    refIds: [proposalId],
    summary: 'ML accepted proposal',
  });
  audit({
    actor: 'orchestrator',
    action: 'proposal_accepted_by_ml',
    resourceType: 'plan_proposal',
    resourceId: proposalId,
    patientId: proposal.patientId,
    payload: { ml: true },
  });
  const planApplied = applyProposalToPlan(proposal);
  return { proposal: getProposalById(proposalId)!, planApplied };
}

/**
 * Apply a vetted proposal to the ADCP plan document (and any side-table
 * source rows the proposal touches, like threshold overrides). Returns
 * whether an ADCP vN+1 was published.
 *
 * Per planning/39 §5.4: thresholds ride the **threshold_recommendations**
 * path the next time the UC2 engine validates them via the existing
 * `applyMlVettedThresholdRecommendation` repo boundary.
 */
function applyProposalToPlan(
  proposal: PendingPlanProposal,
  options?: { payloadOverride?: AdcpProposalPayload },
): boolean {
  const payload = options?.payloadOverride ?? proposal.payload;
  const active = getActiveAdcpRevisionForPatient(proposal.patientId);
  if (!active) {
    // No active plan — apply is still allowed but starts at v1.
    if (payload.kind === 'threshold_patch') {
      applyThresholdPatchToVhresholds(proposal.patientId, payload.thresholds, payload.rationale);
    }
    publishAdcpRevision(buildRevisionFromPayloadThumbnail(proposal.patientId, payload, active));
    setProposalStatus(proposal.proposalId, 'applied', { resolutionReason: `auto-applied via v1+` });
    appendDecisionLog({
      patientId: proposal.patientId,
      proposalId: proposal.proposalId,
      type: 'proposal_applied',
      actor: 'system',
      refIds: [proposal.proposalId],
      summary: 'Proposal applied to ADCP (no prior active revision)',
    });
    return true;
  }

  if (payload.kind === 'threshold_patch') {
    applyThresholdPatchToVhresholds(proposal.patientId, payload.thresholds, payload.rationale);
    applyPatchToActivePlan(proposal, {
      monitoringContract: {
        thresholds: payload.thresholds,
        escalationPolicyRefs: active.monitoringContract.escalationPolicyRefs,
        vettingWindow: active.monitoringContract.vettingWindow,
      },
    });
  } else if (payload.kind === 'therapy_patch') {
    applyPatchToActivePlan(proposal, { therapyContract: payload.therapyContract });
  } else if (payload.kind === 'priority_promote') {
    applyPatchToActivePlan(proposal, {
      carePriorities: prependPriority((active.carePriorities as AdcpCarePrioritySection), payload.priority),
    });
  } else if (payload.kind === 'goal_patch') {
    applyPatchToActivePlan(proposal, {
      goals: { goals: payload.goalsPatch },
    });
  } else if (payload.kind === 'note_wording') {
    const extensions: Record<string, unknown> = {
      ...(active.extensions ?? {}),
      [payload.extensionKey]: payload.text,
    };
    applyPatchToActivePlan(proposal, { extensions });
  } else {
    setProposalStatus(proposal.proposalId, 'rejected_by_ml', {
      resolutionReason: 'unsupported payload kind',
    });
    return false;
  }

  setProposalStatus(proposal.proposalId, 'applied', { resolutionReason: 'applied to ADCP' });
  appendDecisionLog({
    patientId: proposal.patientId,
    proposalId: proposal.proposalId,
    type: 'proposal_applied',
    actor: 'system',
    refIds: [proposal.proposalId],
    summary: 'Proposal applied; ADCP vN+1 published',
  });
  audit({
    actor: 'system',
    action: 'plan_revision_applied',
    resourceType: 'plan_proposal',
    resourceId: proposal.proposalId,
    patientId: proposal.patientId,
    payload: { kind: payload.kind, section: proposal.section },
  });
  return true;
}

function applyThresholdPatchToVhresholds(
  patientId: string,
  thresholds: AdcpMonitoringThresholdClause[],
  rationale: string,
): void {
  // Side-table write: each clause becomes a placeholder threshold_recommendation
  // for the next UC2 pass. The actual `thresholds` row is replaced during the
  // next `evaluateAndPersistUc2` run via the existing caregiver-reviewed
  // recommendation pipeline.
  const db = getDatabase();
  const now = new Date().toISOString();
  for (const clause of thresholds) {
    db.runSync(
      `INSERT INTO threshold_recommendations
         (recommendation_id, patient_id, recommended_threshold, adjustment_pct,
          reason, status, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      `${patientId}:adcp:${clause.vitalType}:${clause.direction}:${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      patientId,
      clause.value,
      clause.pendingMlVet ? null : 0,
      `[ADCP proposal] ${rationale}`,
      'pending',
      now,
      null,
    );
  }
}

function prependPriority(
  existing: AdcpCarePrioritySection,
  newPriority: AdcpCarePrioritySection['priorities'][number],
): AdcpCarePrioritySection {
  return {
    priorities: [newPriority, ...existing.priorities.filter((p) => p.priorityId !== newPriority.priorityId)],
  };
}

type PlanPatch = Partial<Omit<AdcpPlanDocument, 'identity'>>;

function applyPatchToActivePlan(proposal: PendingPlanProposal, patch: PlanPatch): AdcpPlanDocument {
  const active = getActiveAdcpRevisionForPatient(proposal.patientId);
  if (!active) {
    return publishAdcpRevision(buildRevisionFromPayloadThumbnail(proposal.patientId, proposal.payload, null));
  }
  return publishAdcpRevision({
    patientId: proposal.patientId,
    ...active,
    ...patch,
    clinicalFraming: patch.clinicalFraming ?? active.clinicalFraming,
    safetyEnvelope: patch.safetyEnvelope ?? active.safetyEnvelope,
    goals: patch.goals ?? active.goals,
    monitoringContract: patch.monitoringContract ?? active.monitoringContract,
    therapyContract: patch.therapyContract ?? active.therapyContract,
    carePriorities: patch.carePriorities ?? active.carePriorities,
    medicationBindings: patch.medicationBindings ?? active.medicationBindings,
    decisionLog: {
      entries: [
        ...active.decisionLog.entries,
        {
          decisionId: `patch:${proposal.proposalId}`,
          occurredAt: new Date().toISOString(),
          sentence: `Applied ${proposal.kind} (${proposal.section}) via proposal ${proposal.proposalId}`,
          refIds: [proposal.proposalId],
        },
      ],
    },
    evidenceAnchors: active.evidenceAnchors,
    extensions: patch.extensions ?? active.extensions,
    identity: {
      ...active.identity,
      title: active.identity.title,
      description: active.identity.description,
      source: 'ml_apply',
      publishedBy: 'ml',
    },
  });
}

function buildRevisionFromPayloadThumbnail(
  patientId: string,
  payload: AdcpProposalPayload,
  active: AdcpPlanDocument | null,
): AdcpPlanDocument {
  const now = new Date().toISOString();
  return publishAdcpRevision({
    patientId,
    identity: {
      planId: active?.identity.planId ?? `adcp:${patientId}:v1`,
      version: (active?.identity.version ?? 0) + 1,
      effectiveAt: now,
      supersedes: active?.identity.planId ?? null,
      source: 'ml_apply',
      publishedBy: 'ml',
    },
    clinicalFraming: active?.clinicalFraming ?? { comorbidities: [] },
    safetyEnvelope: active?.safetyEnvelope ?? { neverDo: [], alwaysDo: [] },
    goals: active?.goals ?? { goals: [] },
    monitoringContract:
      payload.kind === 'threshold_patch'
        ? {
            thresholds: payload.thresholds,
            escalationPolicyRefs: [],
            vettingWindow: { kind: 'fallback_24h' },
          }
        : active?.monitoringContract ?? { thresholds: [], escalationPolicyRefs: [], vettingWindow: { kind: 'fallback_24h' } },
    therapyContract:
      payload.kind === 'therapy_patch'
        ? payload.therapyContract
        : active?.therapyContract ?? { present: false, reason: 'no_rehab_plan' },
    carePriorities:
      payload.kind === 'priority_promote'
        ? { priorities: [payload.priority] }
        : active?.carePriorities ?? { priorities: [] },
    medicationBindings: active?.medicationBindings ?? { bindings: [] },
    decisionLog: active?.decisionLog ?? { entries: [] },
    evidenceAnchors: active?.evidenceAnchors ?? { knowledgeChunkIds: [], knowledgeGraphIds: [], citationsCount: 0 },
    extensions: active?.extensions ?? {},
  });
}

// ---------------------------------------------------------------------------
// Cross-engine pump: when a UC2/UC3/UC4 eval fires, drain the queue.
// Routes proposals to the engine that should vet them based on section.
// Effects: threshold_patch → UC2; therapy_patch → UC3; priority_promote/goal_patch → UC4.
// ---------------------------------------------------------------------------

export type DrainEngine = 'uc2' | 'uc3' | 'uc4' | 'all';

export interface DrainResult {
  applied: number;
  rejected: number;
  deferred: number;
}

/**
 * Called after a successful UC2 / UC3 / UC4 evaluation (or with engine='all'
 * for manual/dev drains). Vets matching `awaiting_ml_vet` proposals and
 * applies accept/clip/reject. Any proposal past the 24h fallback window is
 * accepted regardless of which engine just fired (E2).
 */
export function drainPendingProposalsForPatient(
  patientId: string,
  engine: DrainEngine = 'all',
): DrainResult {
  // Read-only mode (planning/41 D1) short-circuits the queue — no ML vet,
  // no apply, no rejection. Caregiver must toggle Living care plan updates
  // on in Settings before drains can publish.
  const gate = assertCarePlanWritable();
  if (!gate.ok) {
    return { applied: 0, rejected: 0, deferred: 0 };
  }
  const proposals = listPendingProposals(patientId).filter(
    (p) => p.status === 'awaiting_ml_vet',
  );
  let applied = 0;
  let rejected = 0;
  let deferred = 0;

  for (const proposal of proposals) {
    const elapsedHours =
      (Date.now() - new Date(proposal.updatedAt).getTime()) / (1000 * 60 * 60);
    const pastFallback = elapsedHours >= VET_FALLBACK_HOURS;
    const matches = proposalMatchesEngine(proposal, engine);

    if (!matches && !pastFallback) {
      deferred += 1;
      continue;
    }

    audit({
      actor: 'system',
      action: 'ml_vet_drain',
      resourceType: 'plan_proposal',
      resourceId: proposal.proposalId,
      patientId,
      payload: {
        engine,
        section: proposal.section,
        kind: proposal.kind,
        mlVet: proposal.mlVetRequirement.kind,
        pastFallback,
      },
    });
    appendDecisionLog({
      patientId,
      proposalId: proposal.proposalId,
      type: 'ml_engine_eval',
      actor: 'ml',
      refIds: [proposal.proposalId, proposal.section, proposal.kind, engine],
      summary: pastFallback && !matches
        ? `24h fallback accept for ${proposal.kind}`
        : `${engine} vetting ${proposal.kind}`,
      payload: { engine, pastFallback, kind: proposal.kind },
    });

    const outcome: MlVetOutcome =
      pastFallback && !matches
        ? { decision: 'accept' }
        : vetProposalForEngine(proposal, engine === 'all' ? inferEngine(proposal) : engine);

    try {
      const result = applyMlVetDecision(proposal.proposalId, outcome);
      if (result.planApplied || outcome.decision === 'accept' || outcome.decision === 'clip') {
        applied += 1;
      } else if (outcome.decision === 'reject') {
        rejected += 1;
      }
    } catch (err) {
      deferred += 1;
      console.warn(
        `[mlPlanProposalService] drain failed for ${proposal.proposalId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { applied, rejected, deferred };
}

function proposalMatchesEngine(proposal: PendingPlanProposal, engine: DrainEngine): boolean {
  if (engine === 'all') return true;
  const req = proposal.mlVetRequirement.kind;
  if (req === 'none') return true;
  // fallback_24h only applies via pastFallback elapsed time, not on every engine fire.
  if (engine === 'uc2') {
    return req === 'next_uc2_pass' || proposal.kind === 'threshold_patch';
  }
  if (engine === 'uc3') {
    return req === 'next_uc3_eval' || proposal.kind === 'therapy_patch';
  }
  if (engine === 'uc4') {
    return (
      req === 'next_uc4_run' ||
      proposal.kind === 'priority_promote' ||
      proposal.kind === 'goal_patch'
    );
  }
  return false;
}

function inferEngine(proposal: PendingPlanProposal): Exclude<DrainEngine, 'all'> {
  const req = proposal.mlVetRequirement.kind;
  if (req === 'next_uc2_pass' || proposal.kind === 'threshold_patch') return 'uc2';
  if (req === 'next_uc3_eval' || proposal.kind === 'therapy_patch') return 'uc3';
  return 'uc4';
}

/** Deterministic, engine-shaped bounds check — SLM drafts, ML guards. */
function vetProposalForEngine(
  proposal: PendingPlanProposal,
  engine: Exclude<DrainEngine, 'all'>,
): MlVetOutcome {
  const payload = proposal.payload;

  if (payload.kind === 'threshold_patch') {
    return vetThresholdPatch(payload);
  }
  if (payload.kind === 'therapy_patch') {
    if (engine !== 'uc3' && engine !== 'uc2') {
      // UC4 drain shouldn't silently apply therapy; defer handled by match.
    }
    if (!payload.therapyContract.present) {
      return { decision: 'reject', reason: 'therapy_patch missing present=true contract' };
    }
    if (payload.therapyContract.activities.length === 0 && payload.therapyContract.rehabMetrics.length === 0) {
      return { decision: 'reject', reason: 'therapy_patch has no activities or metrics' };
    }
    return { decision: 'accept' };
  }
  if (payload.kind === 'priority_promote') {
    if (!payload.priority.title?.trim()) {
      return { decision: 'reject', reason: 'priority_promote missing title' };
    }
    const weight = payload.priority.weight;
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      const clipped = {
        ...payload,
        priority: { ...payload.priority, weight: Math.min(1, Math.max(0, Number.isFinite(weight) ? weight : 0.5)) },
      };
      return {
        decision: 'clip',
        clippedPayload: clipped,
        reason: 'priority weight clipped to [0,1]',
      };
    }
    return { decision: 'accept' };
  }
  if (payload.kind === 'goal_patch') {
    if (!payload.goalsPatch.length) {
      return { decision: 'reject', reason: 'goal_patch empty' };
    }
    return { decision: 'accept' };
  }
  if (payload.kind === 'note_wording') {
    return { decision: 'accept' };
  }
  return { decision: 'accept' };
}

const VITAL_BOUNDS: Record<string, { min: number; max: number }> = {
  spo2: { min: 70, max: 100 },
  heart_rate: { min: 30, max: 220 },
  respiratory_rate: { min: 4, max: 60 },
  blood_pressure_systolic: { min: 60, max: 250 },
  blood_pressure_diastolic: { min: 30, max: 150 },
  temperature: { min: 90, max: 110 },
  blood_glucose: { min: 20, max: 600 },
};

function vetThresholdPatch(
  payload: Extract<AdcpProposalPayload, { kind: 'threshold_patch' }>,
): MlVetOutcome {
  if (!payload.thresholds.length) {
    return { decision: 'reject', reason: 'threshold_patch has no clauses' };
  }
  let clipped = false;
  const next = payload.thresholds.map((clause) => {
    const bounds = VITAL_BOUNDS[clause.vitalType];
    if (!bounds) return clause;
    let value = clause.value;
    if (!Number.isFinite(value)) {
      clipped = true;
      value = (bounds.min + bounds.max) / 2;
    } else if (value < bounds.min) {
      clipped = true;
      value = bounds.min;
    } else if (value > bounds.max) {
      clipped = true;
      value = bounds.max;
    }
    const severity = ([1, 2, 3].includes(clause.severity) ? clause.severity : 2) as 1 | 2 | 3;
    if (severity !== clause.severity) clipped = true;
    return { ...clause, value, severity, pendingMlVet: false };
  });
  if (clipped) {
    return {
      decision: 'clip',
      clippedPayload: { ...payload, thresholds: next },
      reason: 'threshold values clipped to clinical bounds',
    };
  }
  return { decision: 'accept' };
}

export function isVetFallbackWindow(proposal: PendingPlanProposal): boolean {
  const elapsedHours = (Date.now() - new Date(proposal.updatedAt).getTime()) / (1000 * 60 * 60);
  return elapsedHours >= VET_FALLBACK_HOURS;
}

export const ML_VET_FALLBACK_HOURS = VET_FALLBACK_HOURS;
