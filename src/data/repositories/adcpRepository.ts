/**
 * ADCP repository — APpend-only CRUD over the AccessDP Care Plan document.
 *
 * Implements planning/39_unified-care-plan-and-care-concierge.md §3, §3.4, §3.5.
 *
 * Responsibilities:
 *   - Persist ADCP revisions (immutable history)
 *   - Queue ML-vetted proposals (lifecycle: draft → HITL → ml_vet → applied/rejected)
 *   - Append decision-log entries (one-way audit trail)
 *   - Helpers for seeding an ADCP v1 from existing care plan + thresholds + (optional) rehab metrics.
 *
 * NOT responsible for:
 *   - SLM prompting (services/carePlan/intentRouter)
 *   - ML vetting queue logic (services/carePlan/mlPlanProposalService)
 *   - KG projection (knowledge/graph/*)
 *   - UI rendering / patient snapshot
 */

import { getDatabase } from '../db';
import type {
  ActiveAdcpVersionSummary,
  AdcpPlanDocument,
  AdcpProposalPayload,
  AdcpProposalMlVetRequirement,
  AdcpProposalIntentId,
  AdcpProposalKind,
  AdcpProposalSection,
  AdcpProposalStatus,
  PendingPlanProposal,
  PendingPlanProposalSummary,
  PlanDecisionLogEntry,
  PlanDecisionType,
} from '../adcp/types';
import type { PatientRecordSnapshot } from '../types';

// ---------------------------------------------------------------------------
// Care plan revision rows
// ---------------------------------------------------------------------------

interface RevisionRow {
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
}

function rowToPlanDocument(row: RevisionRow): AdcpPlanDocument {
  try {
    const parsed = JSON.parse(row.payload_json) as Partial<AdcpPlanDocument>;
    return {
      identity: {
        planId: row.plan_id,
        version: row.version,
        effectiveAt: row.effective_at,
        supersedes: row.supersedes,
        source: row.source as AdcpPlanDocument['identity']['source'],
        publishedAt: row.published_at,
        publishedBy: row.published_by,
        title: parsed.identity?.title,
        description: parsed.identity?.description,
      },
      clinicalFraming: parsed.clinicalFraming ?? { comorbidities: [] },
      safetyEnvelope: parsed.safetyEnvelope ?? { neverDo: [], alwaysDo: [] },
      goals: parsed.goals ?? { goals: [] },
      monitoringContract: parsed.monitoringContract ?? { thresholds: [], escalationPolicyRefs: [], vettingWindow: { kind: 'fallback_24h' } },
      therapyContract: parsed.therapyContract ?? { present: false, reason: 'no_rehab_plan' },
      carePriorities: parsed.carePriorities ?? { priorities: [] },
      medicationBindings: parsed.medicationBindings ?? { bindings: [] },
      decisionLog: parsed.decisionLog ?? { entries: [] },
      evidenceAnchors: parsed.evidenceAnchors ?? { knowledgeChunkIds: [], knowledgeGraphIds: [], citationsCount: 0 },
      extensions: parsed.extensions ?? {},
    };
  } catch {
    return {
      identity: {
        planId: row.plan_id,
        version: row.version,
        effectiveAt: row.effective_at,
        supersedes: row.supersedes,
        source: row.source as AdcpPlanDocument['identity']['source'],
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
    };
  }
}

function proposeAdcpPlanId(patientId: string): string {
  return `adcp:${patientId}:v${Date.now().toString(36)}`;
}

export type PublishAdcpRevisionInput = Omit<AdcpPlanDocument, 'identity'> & {
  identity: Omit<AdcpPlanDocument['identity'], 'planId' | 'version'> & {
    planId?: string;
    version?: number;
  };
  /**
   * Required: the patientId this revision belongs to. Identity.planId alone
   * is not enough because the snapshot builder / KG projector look up by
   * patient. The function derives the patientId from this argument when no
   * prior revision exists (e.g. seed v1).
   */
  patientId?: string;
};

export function listAdcpRevisionsForPatient(patientId: string): AdcpPlanDocument[] {
  const db = getDatabase();
  const rows = db.getAllSync<RevisionRow>(
    `SELECT revision_id, patient_id, plan_id, version, supersedes, source,
            published_by, published_at, effective_at, payload_json,
            section_hashes_json, created_at
     FROM care_plan_revisions
     WHERE patient_id = ?
     ORDER BY version DESC;`,
    patientId,
  );
  return rows.map(rowToPlanDocument);
}

export function getActiveAdcpRevisionForPatient(patientId: string): AdcpPlanDocument | null {
  const db = getDatabase();
  const row = db.getFirstSync<RevisionRow>(
    `SELECT revision_id, patient_id, plan_id, version, supersedes, source,
            published_by, published_at, effective_at, payload_json,
            section_hashes_json, created_at
     FROM care_plan_revisions
     WHERE patient_id = ?
     ORDER BY version DESC
     LIMIT 1;`,
    patientId,
  );
  return row ? rowToPlanDocument(row) : null;
}

export function getActiveAdcpVersionSummary(patientId: string): ActiveAdcpVersionSummary | null {
  const active = getActiveAdcpRevisionForPatient(patientId);
  if (!active) return null;
  return {
    planId: active.identity.planId,
    version: active.identity.version,
    publishedAt: active.identity.publishedAt ?? active.identity.effectiveAt,
    source: active.identity.source,
    therapyContractPresent: active.therapyContract.present,
    prioritiesCount: active.carePriorities.priorities.length,
    medicationBindingsCount: active.medicationBindings.bindings.length,
  };
}

/**
 * Publish a new ADCP revision. Append-only: existing rows never change. The
 * previous active revision becomes the `supersedes` of this one.
 */
function resolvePatientIdForPublish(input: PublishAdcpRevisionInput): string {
  if (input.patientId?.trim()) return input.patientId.trim();
  // planId forms: "adcp:<patientId>:v1" or "<patientId>:v1"
  const planId = input.identity.planId ?? '';
  const adcpMatch = planId.match(/^adcp:([^:]+):/i);
  if (adcpMatch?.[1]) return adcpMatch[1];
  const simpleMatch = planId.match(/^([^:]+):v\d+/i);
  if (simpleMatch?.[1] && simpleMatch[1] !== 'adcp') return simpleMatch[1];
  return '';
}

export function publishAdcpRevision(input: PublishAdcpRevisionInput): AdcpPlanDocument {
  const db = getDatabase();
  const now = new Date().toISOString();

  const lookupPatient = resolvePatientIdForPublish(input);
  if (!lookupPatient) {
    throw new Error('publishAdcpRevision requires patientId (or a parseable identity.planId)');
  }

  const previousRow = db.getFirstSync<RevisionRow>(
    `SELECT revision_id, patient_id, plan_id, version, supersedes, source,
            published_by, published_at, effective_at, payload_json,
            section_hashes_json, created_at
     FROM care_plan_revisions
     WHERE patient_id = ?
     ORDER BY version DESC
     LIMIT 1;`,
    lookupPatient,
  );

  const patientId = lookupPatient;
  const nextVersion = (previousRow?.version ?? 0) + 1;
  const planId = input.identity.planId ?? `adcp:${patientId}:v${nextVersion}`;

  const identity: AdcpPlanDocument['identity'] = {
    ...input.identity,
    planId,
    version: nextVersion,
    supersedes: previousRow?.plan_id ?? null,
    publishedAt: now,
    effectiveAt: input.identity.effectiveAt ?? now,
  };

  const document: AdcpPlanDocument = {
    identity,
    clinicalFraming: input.clinicalFraming,
    safetyEnvelope: input.safetyEnvelope,
    goals: input.goals,
    monitoringContract: input.monitoringContract,
    therapyContract: input.therapyContract,
    carePriorities: input.carePriorities,
    medicationBindings: input.medicationBindings,
    decisionLog: input.decisionLog,
    evidenceAnchors: input.evidenceAnchors,
    extensions: input.extensions,
  };

  const revisionId = `${patientId}:rev:${nextVersion}`;
  db.runSync(
    `INSERT INTO care_plan_revisions
       (revision_id, patient_id, plan_id, version, supersedes, source,
        published_by, published_at, effective_at, payload_json,
        section_hashes_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    revisionId,
    patientId,
    planId,
    nextVersion,
    previousRow?.plan_id ?? null,
    identity.source,
    identity.publishedBy ?? 'system',
    now,
    identity.effectiveAt,
    JSON.stringify(document),
    JSON.stringify(hashSections(document)),
    now,
  );

  appendDecisionLog({
    patientId,
    proposalId: null,
    type: 'plan_published',
    actor: identity.publishedBy === 'caregiver' ? 'caregiver' : identity.publishedBy === 'slm' ? 'slm' : identity.publishedBy === 'ml' ? 'ml' : 'system',
    refIds: [planId, revisionId],
    summary: `Published ADCP v${nextVersion} (${identity.source})`,
    payload: { source: identity.source, supersedes: previousRow?.plan_id ?? null },
  });

  // P3 project-on-write: KG is a derived index — never block the clinical write.
  try {
    const { writeCarePlanRevisionEdges, writeGoalEdges } = require('../../knowledge/graph/adcpEdgeWriters') as typeof import('../../knowledge/graph/adcpEdgeWriters');
    writeCarePlanRevisionEdges(patientId, {
      revisionId,
      planId,
      version: nextVersion,
      supersedesPlanId: previousRow?.plan_id ?? null,
      source: identity.source,
      publishedBy: identity.publishedBy ?? 'system',
      goalIds: document.goals.goals.map((g) => g.goalId),
    });
    for (const goal of document.goals.goals) {
      writeGoalEdges(patientId, goal.goalId, goal.measurementTarget?.metricKey ?? null);
    }
  } catch (err) {
    console.warn(
      '[adcpRepository] KG project-on-write failed:',
      err instanceof Error ? err.message : err,
    );
  }

  // P4 plan-as-RAG: index chunks per section into `knowledge_cache`. Never
  // blocks publish — same fail-soft contract as the KG writer above.
  try {
    const { indexAdcpPlanRevision } = require('../../services/carePlan/adcpKnowledgeIndexer') as typeof import('../../services/carePlan/adcpKnowledgeIndexer');
    indexAdcpPlanRevision(document, patientId);
  } catch (err) {
    console.warn(
      '[adcpRepository] ADCP knowledge indexer failed:',
      err instanceof Error ? err.message : err,
    );
  }

  return document;
}

function hashSections(_doc: AdcpPlanDocument): Record<string, string> {
  // Lightweight non-cryptographic hash — present so future integrity checks
  // can verify "no section changed between revisions" without recomputing JSON.
  const seed = (s: string) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    return (h >>> 0).toString(16);
  };
  return {
    identity: seed(JSON.stringify(_doc.identity)),
    clinicalFraming: seed(JSON.stringify(_doc.clinicalFraming)),
    safetyEnvelope: seed(JSON.stringify(_doc.safetyEnvelope)),
    goals: seed(JSON.stringify(_doc.goals)),
    monitoringContract: seed(JSON.stringify(_doc.monitoringContract)),
    therapyContract: seed(JSON.stringify(_doc.therapyContract)),
    carePriorities: seed(JSON.stringify(_doc.carePriorities)),
    medicationBindings: seed(JSON.stringify(_doc.medicationBindings)),
    decisionLog: seed(JSON.stringify(_doc.decisionLog)),
    evidenceAnchors: seed(JSON.stringify(_doc.evidenceAnchors)),
  };
}

// ---------------------------------------------------------------------------
// Pending proposal queue
// ---------------------------------------------------------------------------

interface ProposalRow {
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
}

export type CreatePendingProposalInput = {
  patientId: string;
  intent: AdcpProposalIntentId;
  section: AdcpProposalSection;
  kind: AdcpProposalKind;
  draftedBy: PendingPlanProposal['draftedBy'];
  payload: AdcpProposalPayload;
  mlVetRequirement: AdcpProposalMlVetRequirement;
  notes?: string | null;
  pendingOverrides?: PendingPlanProposal['pendingOverrides'];
};

export function createPendingProposal(input: CreatePendingProposalInput): PendingPlanProposal {
  if (input.patientId == null || !input.payload) {
    throw new Error('createPendingProposal: missing required fields');
  }
  if (input.intent == null) {
    throw new Error('createPendingProposal: missing intent');
  }
  const db = getDatabase();
  const now = new Date().toISOString();
  const proposalId = `${input.patientId}:prop:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const row: PendingPlanProposal = {
    proposalId,
    patientId: input.patientId,
    intent: input.intent,
    section: input.section,
    kind: input.kind,
    status: 'draft',
    payload: input.payload,
    draftedBy: input.draftedBy,
    mlVetRequirement: input.mlVetRequirement,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    resolutionReason: null,
    clippedPayload: null,
    pendingOverrides: input.pendingOverrides ?? undefined,
  };

  try {
    const { writeProposalEdges } = require('../../knowledge/graph/adcpEdgeWriters') as typeof import('../../knowledge/graph/adcpEdgeWriters');
    writeProposalEdges(input.patientId, proposalId, {
      intentId: input.intent,
      section: input.section,
      status: 'draft',
    });
  } catch {
    /* KG best-effort */
  }

  db.runSync(
    `INSERT INTO pending_plan_proposals
       (proposal_id, patient_id, intent, section, kind, status,
        payload_json, drafted_by, ml_vet_json, notes,
        created_at, updated_at, resolved_at, resolution_reason,
        clipped_payload_json, pending_overrides_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    proposalId,
    input.patientId,
    input.intent,
    input.section,
    input.kind,
    'draft',
    JSON.stringify(input.payload),
    input.draftedBy,
    JSON.stringify(input.mlVetRequirement),
    input.notes ?? null,
    now,
    now,
    null,
    null,
    null,
    input.pendingOverrides ? JSON.stringify(input.pendingOverrides) : null,
  );

  appendDecisionLog({
    patientId: input.patientId,
    proposalId,
    type: 'proposal_drafted',
    actor: input.draftedBy === 'caregiver' ? 'caregiver' : input.draftedBy === 'slm' ? 'slm' : 'ml',
    refIds: [proposalId, input.intent, input.section],
    summary: `Drafted ${input.kind} proposal for section=${input.section}`,
    payload: { section: input.section, kind: input.kind, draftedBy: input.draftedBy },
  });

  return row;
}

export function setProposalStatus(
  proposalId: string,
  status: AdcpProposalStatus,
  options?: { resolutionReason?: string | null; clippedPayload?: AdcpProposalPayload | null },
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  const resolvedStatuses: AdcpProposalStatus[] = [
    'accepted',
    'accepted_with_clip',
    'rejected_by_ml',
    'rejected_by_caregiver',
    'applied',
    'expired',
  ];
  const isResolved = resolvedStatuses.includes(status);
  db.runSync(
    `UPDATE pending_plan_proposals
     SET status = ?, updated_at = ?, resolved_at = ?, resolution_reason = ?, clipped_payload_json = ?
     WHERE proposal_id = ?;`,
    status,
    now,
    isResolved ? now : null,
    options?.resolutionReason ?? null,
    options?.clippedPayload ? JSON.stringify(options.clippedPayload) : null,
    proposalId,
  );

  try {
    const existing = getProposalById(proposalId);
    if (existing) {
      const { writeProposalEdges } = require('../../knowledge/graph/adcpEdgeWriters') as typeof import('../../knowledge/graph/adcpEdgeWriters');
      writeProposalEdges(existing.patientId, proposalId, {
        intentId: existing.intent,
        section: existing.section,
        status,
      });
    }
  } catch {
    /* KG best-effort */
  }
}

export function listPendingProposals(patientId: string): PendingPlanProposal[] {
  const db = getDatabase();
  const rows = db.getAllSync<ProposalRow>(
    `SELECT proposal_id, patient_id, intent, section, kind, status,
            payload_json, drafted_by, ml_vet_json, notes,
            created_at, updated_at, resolved_at, resolution_reason,
            clipped_payload_json, pending_overrides_json
     FROM pending_plan_proposals
     WHERE patient_id = ?
     ORDER BY created_at DESC;`,
    patientId,
  );
  return rows.map(rowToProposal);
}

export function listPendingProposalSummaries(patientId: string): PendingPlanProposalSummary[] {
  return listPendingProposals(patientId).map((proposal) => summarizeProposal(proposal));
}

export function getProposalById(proposalId: string): PendingPlanProposal | null {
  const db = getDatabase();
  const row = db.getFirstSync<ProposalRow>(
    `SELECT proposal_id, patient_id, intent, section, kind, status,
            payload_json, drafted_by, ml_vet_json, notes,
            created_at, updated_at, resolved_at, resolution_reason,
            clipped_payload_json, pending_overrides_json
     FROM pending_plan_proposals
     WHERE proposal_id = ?
     LIMIT 1;`,
    proposalId,
  );
  return row ? rowToProposal(row) : null;
}

function rowToProposal(row: ProposalRow): PendingPlanProposal {
  let payload: AdcpProposalPayload;
  try {
    payload = JSON.parse(row.payload_json) as AdcpProposalPayload;
  } catch {
    payload = { kind: 'note_wording', patientId: row.patient_id, rationale: 'invalid', citations: [], extensionKey: '__invalid', text: '' };
  }
  let mlVetRequirement: AdcpProposalMlVetRequirement;
  try {
    mlVetRequirement = JSON.parse(row.ml_vet_json) as AdcpProposalMlVetRequirement;
  } catch {
    mlVetRequirement = { kind: 'fallback_24h' };
  }
  let clippedPayload: AdcpProposalPayload | null = null;
  if (row.clipped_payload_json) {
    try {
      clippedPayload = JSON.parse(row.clipped_payload_json) as AdcpProposalPayload;
    } catch {
      clippedPayload = null;
    }
  }
  let pendingOverrides: PendingPlanProposal['pendingOverrides'];
  if (row.pending_overrides_json) {
    try {
      pendingOverrides = JSON.parse(row.pending_overrides_json) as PendingPlanProposal['pendingOverrides'];
    } catch {
      pendingOverrides = undefined;
    }
  }
  return {
    proposalId: row.proposal_id,
    patientId: row.patient_id,
    intent: row.intent as AdcpProposalIntentId,
    section: row.section as AdcpProposalSection,
    kind: row.kind as AdcpProposalKind,
    status: row.status as AdcpProposalStatus,
    payload,
    draftedBy: row.drafted_by as PendingPlanProposal['draftedBy'],
    mlVetRequirement,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    resolutionReason: row.resolution_reason,
    clippedPayload,
    pendingOverrides,
  };
}

function summarizeProposal(proposal: PendingPlanProposal): PendingPlanProposalSummary {
  const summary = deriveProposalSummary(proposal);
  return {
    proposalId: proposal.proposalId,
    patientId: proposal.patientId,
    intent: proposal.intent,
    section: proposal.section,
    kind: proposal.kind,
    status: proposal.status,
    summary,
    rationale: deriveProposalRationale(proposal),
    draftedBy: proposal.draftedBy,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    resolvedAt: proposal.resolvedAt,
  };
}

function deriveProposalSummary(proposal: PendingPlanProposal): string {
  if (proposal.payload.kind === 'threshold_patch') {
    return `${proposal.payload.thresholds.length} threshold adjustment${proposal.payload.thresholds.length === 1 ? '' : 's'}`;
  }
  if (proposal.payload.kind === 'therapy_patch') {
    return 'Therapy contract patch';
  }
  if (proposal.payload.kind === 'priority_promote') {
    return `Promote: ${proposal.payload.priority.title}`;
  }
  if (proposal.payload.kind === 'goal_patch') {
    return `${proposal.payload.goalsPatch.length} goal update${proposal.payload.goalsPatch.length === 1 ? '' : 's'}`;
  }
  return 'Note re-wording';
}

function deriveProposalRationale(proposal: PendingPlanProposal): string {
  if ('rationale' in proposal.payload && typeof proposal.payload.rationale === 'string') {
    return proposal.payload.rationale;
  }
  return 'See proposal payload for full context.';
}

// ---------------------------------------------------------------------------
// Decision log
// ---------------------------------------------------------------------------

export type AppendDecisionLogInput = {
  patientId: string;
  proposalId?: string | null;
  type: PlanDecisionType;
  actor: PlanDecisionLogEntry['actor'];
  refIds: string[];
  summary: string;
  payload?: Record<string, unknown>;
};

export function appendDecisionLog(input: AppendDecisionLogInput): PlanDecisionLogEntry {
  const db = getDatabase();
  const now = new Date().toISOString();
  const decisionId = `pd:${input.patientId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const refIdsJson = JSON.stringify(input.refIds);
  const payloadJson = input.payload ? JSON.stringify(input.payload) : null;

  db.runSync(
    `INSERT INTO plan_decision_log
       (decision_id, patient_id, proposal_id, type, actor,
        ref_ids_json, summary, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    decisionId,
    input.patientId,
    input.proposalId ?? null,
    input.type,
    input.actor,
    refIdsJson,
    input.summary,
    payloadJson,
    now,
  );

  return {
    decisionId,
    patientId: input.patientId,
    proposalId: input.proposalId ?? null,
    type: input.type,
    actor: input.actor,
    refIdsJson,
    summary: input.summary,
    payloadJson,
    createdAt: now,
  };
}

export function listPlanDecisionLog(patientId: string, limit = 50): PlanDecisionLogEntry[] {
  const db = getDatabase();
  const rows = db.getAllSync<{
    decision_id: string;
    patient_id: string;
    proposal_id: string | null;
    type: string;
    actor: string;
    ref_ids_json: string;
    summary: string;
    payload_json: string | null;
    created_at: string;
  }>(
    `SELECT decision_id, patient_id, proposal_id, type, actor, ref_ids_json,
            summary, payload_json, created_at
     FROM plan_decision_log
     WHERE patient_id = ?
     ORDER BY created_at DESC
     LIMIT ?;`,
    patientId,
    limit,
  );
  return rows.map((row) => ({
    decisionId: row.decision_id,
    patientId: row.patient_id,
    proposalId: row.proposal_id,
    type: row.type as PlanDecisionType,
    actor: row.actor as PlanDecisionLogEntry['actor'],
    refIdsJson: row.ref_ids_json,
    summary: row.summary,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Seed helpers — produce the v1 ADCP revision from a PatientRecordSnapshot.
// ---------------------------------------------------------------------------

export type SeedAdcpV1FromSnapshotInput = {
  patientId: string;
  snapshot: PatientRecordSnapshot;
  source?: 'seed:onboarding' | 'seed:fhir_import';
  /** Caller-supplied stable plan id; default: `adcp:<patientId>:v1`. */
  planId?: string;
};

/**
 * Build and persist a v1 ADCP revision from the current snapshot. Idempotent:
 * if a v1 already exists, returns it without rewriting. Called from
 * seedFromProfile (onboarding) and from fhir-import (after a CarePlan
 * resource is upserted).
 */
export function seedAdcpV1FromSnapshot(input: SeedAdcpV1FromSnapshotInput): AdcpPlanDocument {
  // Idempotent: never re-seed once any ADCP revision exists for this patient.
  const existing = getActiveAdcpRevisionForPatient(input.patientId);
  if (existing) {
    return existing;
  }

  const s = input.snapshot;
  const primary = s.primaryCondition;
  const comorbidities = s.comorbidities.map((c) => ({ name: c.name, icd10: c.icd10 ?? null }));

  const monitoringContract = {
    thresholds: s.thresholds.map((t) => ({
      thresholdId: t.thresholdId,
      vitalType: t.vitalType,
      direction: (t.direction === 'below' ? 'below' : 'above') as 'above' | 'below',
      value: t.value,
      severity: ((t.severity >= 1 && t.severity <= 3) ? t.severity : 2) as 1 | 2 | 3,
      source: t.source,
      pendingMlVet: false,
    })),
    escalationPolicyRefs: [],
    vettingWindow: { kind: 'fallback_24h' as const },
  };

  const therapyContract: AdcpPlanDocument['therapyContract'] =
    s.rehabPlanMetrics.length === 0 && s.rehabExerciseAssignments.length === 0
      ? { present: false, reason: 'no_rehab_plan' as const }
      : {
          present: true as const,
          activities:
            s.carePlan?.activities?.map((a) => ({
              activityId: a.activityId,
              description: a.description ?? null,
              status: a.status ?? null,
            })) ?? [],
          rehabMetrics: s.rehabPlanMetrics.map((m) => ({
            id: m.id,
            metricKey: m.metricKey as
              | 'romDegrees'
              | 'exerciseReps'
              | 'adherence'
              | 'painScore'
              | 'fatigueScore'
              | 'walkingMinutes',
            displayName: m.displayName,
            baselineValue: m.baselineValue ?? null,
            targetValue: m.targetValue ?? null,
            unit: m.unit,
          })),
          exerciseAssignments: s.rehabExerciseAssignments
            .filter((a) => a.active)
            .map((a) => ({ exerciseKey: a.exerciseKey, active: true })),
          reviewWindowDays: 21,
        };

  const carePriorities = {
    priorities: s.latestUc4PriorityCards.map((card) => ({
      priorityId: `uc4-promoted:${card.cardId}`,
      sourceCardId: card.cardId,
      title: card.title,
      description: card.body,
      domain: card.domain,
      status: (card.status === 'active' ? 'active' : 'active') as 'active',
      promotedAt: card.generatedAt,
      weight: card.score,
    })),
  };

  const medicationBindings = {
    bindings: s.medications.map((m) => ({
      medicationId: m.medicationId,
      stableBindingId: `binding:${input.patientId}:${m.medicationId}`,
      role: 'monitor' as const,
      notes: null,
    })),
  };

  const safetyEnvelope = {
    neverDo: [],
    alwaysDo: [],
    emergencyContact: s.carePlan?.emergencyContact ?? null,
    safetyNotes: s.safetyNotes ?? null,
  };

  const goals = {
    goals: (s.carePlanGoals ?? []).map((g) => ({
      goalId: g.goalId,
      description: g.description,
      targetDate: g.targetDate ?? null,
      measurementTarget: null,
      status: (g.status === 'active' ? 'active' : 'active') as 'active',
    })),
  };

  try {
    return publishAdcpRevision({
      // Required — without this, lookup falls back to a broken planId split and
      // re-imports hit UNIQUE(patient_id, version) on version 1.
      patientId: input.patientId,
      identity: {
        planId: input.planId ?? `adcp:${input.patientId}:v1`,
        version: 1,
        effectiveAt: new Date().toISOString(),
        supersedes: null,
        source: input.source ?? 'seed:onboarding',
        publishedBy: 'system',
        title: s.carePlan?.title ?? undefined,
        description: s.carePlan?.description ?? undefined,
      },
      clinicalFraming: {
        primaryDiagnosis: primary ? { name: primary.name, icd10: primary.icd10 ?? null } : undefined,
        comorbidities,
        functionalScales: extractFunctionalScales(s.patient),
      },
      safetyEnvelope,
      goals,
      monitoringContract,
      therapyContract,
      carePriorities,
      medicationBindings,
      decisionLog: { entries: [] },
      evidenceAnchors: {
        knowledgeChunkIds: [],
        knowledgeGraphIds: [],
        citationsCount: 0,
      },
      extensions: {},
    });
  } catch (err) {
    // Race / re-import: if another path already wrote v1, return it.
    const raced = getActiveAdcpRevisionForPatient(input.patientId);
    if (raced) return raced;
    throw err;
  }
}

function extractFunctionalScales(patient: PatientRecordSnapshot['patient']): Record<string, string> | undefined {
  if (!patient) return undefined;
  const scales: Record<string, string> = {};
  if (patient.gmfcs && patient.gmfcs !== 'Not assessed') scales.gmfcs = patient.gmfcs;
  if (patient.fms && patient.fms !== 'Not assessed') scales.fms = patient.fms;
  if (patient.macs && patient.macs !== 'Not assessed') scales.macs = patient.macs;
  if (patient.cfcs && patient.cfcs !== 'Not assessed') scales.cfcs = patient.cfcs;
  if (patient.edacs && patient.edacs !== 'Not assessed') scales.edacs = patient.edacs;
  return Object.keys(scales).length === 0 ? undefined : scales;
}

// ---------------------------------------------------------------------------
// Convenience helpers used by services (typed views).
// ---------------------------------------------------------------------------

export function planHasTherapyContract(plan: AdcpPlanDocument | null): boolean {
  return Boolean(plan?.therapyContract && plan.therapyContract.present === true);
}
