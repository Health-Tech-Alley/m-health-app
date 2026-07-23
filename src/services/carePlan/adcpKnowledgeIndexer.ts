/**
 * ADCP knowledge indexer (planning/39 §7.4 P4 — Plan-as-RAG).
 *
 * Project-on-write: every time `adcpRepository.publishAdcpRevision` succeeds,
 * we delete any prior `adcp:{patientId}:*` chunks (supersede-cleanup) and
 * insert one knowledge chunk per present ADCP section. The fused retriever
 * then ranks them like literature, with retrieval-helper injecting the
 * `adcp_plan` source label so Care Concierge cites them as
 * `[Care Plan #N]`.
 *
 * Idempotency: `INSERT OR REPLACE by chunk_id` (knowledge_cache PK).
 *
 * Best-effort: never block the publish. Failures log to the console; the
 * Care provider can rebuild from the dev-menu (P3 contract).
 */

import type {
  AdcpCarePrioritySection,
  AdcpGoalsSection,
  AdcpPlanDocument,
} from '@/data/adcp/types';

type AdcpGoal = AdcpGoalsSection['goals'][number];
import type { KnowledgeChunk } from '@/data/types';
import { getDatabase } from '@/data/db';
import {
  deleteKnowledgeChunk,
  deleteKnowledgeChunksBySourceAndChunkPrefix,
  insertKnowledgeChunks,
} from '@/data/repositories/knowledgeCacheRepository';
import { getActiveMedications } from '@/data/repositories/patientRepository';

/**
 * Stable chunk identity contract — chunk_id is parsed by retrieval-helper
 * and the citation tag formatter. `metadata.planId` lets readers (or future
 * graph writes) walk back to the ADCP revision.
 */
export const ADCP_CHUNK_PREFIX = 'adcp:';
export const ADCP_SOURCE = 'adcp_plan' as const;

export interface IndexerOptions {
  /** When true, also delete all chunks with `adcp:{patientId}:*` ids before insert. Default: true. */
  supersedeCleanup?: boolean;
  /** Decision-log rolled window. Default: 20 entries. */
  decisionLogWindowSize?: number;
  /** Whether to attach the primary diagnosis as the conditions column for retrieval. */
  indexByCondition?: boolean;
}

export interface IndexerResult {
  patientId: string;
  planId: string;
  version: number;
  chunkCount: number;
  chunkIds: string[];
  startedAt: string;
  finishedAt: string;
  warnings: string[];
}

/**
 * Build the chunk-ids AND insert chunks for one ADCP revision. Called from
 * `publishAdcpRevision` after the row write succeeds.
 */
export function indexAdcpPlanRevision(
  plan: AdcpPlanDocument,
  patientId: string,
  options: IndexerOptions = {},
): IndexerResult {
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  const supersedeCleanup = options.supersedeCleanup ?? true;
  const decisionLogWindowSize = options.decisionLogWindowSize ?? 20;
  const indexByCondition = options.indexByCondition ?? true;

  try {
    if (supersedeCleanup) {
      try {
        deleteAdcpChunksForPatient(patientId);
      } catch (err) {
        warnings.push(`supersede_cleanup_failed: ${errMessage(err)}`);
      }
    }

    const chunks = buildChunksForRevision(plan, patientId, {
      decisionLogWindowSize,
      indexByCondition,
    });

    if (chunks.length > 0) {
      insertKnowledgeChunks(chunks);
    }
    return {
      patientId,
      planId: plan.identity.planId,
      version: plan.identity.version,
      chunkCount: chunks.length,
      chunkIds: chunks.map((c) => c.chunkId),
      startedAt,
      finishedAt: new Date().toISOString(),
      warnings,
    };
  } catch (err) {
    return {
      patientId,
      planId: plan.identity.planId,
      version: plan.identity.version,
      chunkCount: 0,
      chunkIds: [],
      startedAt,
      finishedAt: new Date().toISOString(),
      warnings: [`index_failed: ${errMessage(err)}`],
    };
  }
}

/**
 * Delete all chunks belonging to one patient's ADCP (supersede cleanup).
 *
 * Scoped by `source = adcp_plan` AND `chunk_id LIKE adcp:{patientId}:%` so
 * re-indexing Mike never wipes Sofia's plan chunks (multi-patient safe).
 */
export function deleteAdcpChunksForPatient(patientId: string): number {
  if (!patientId.trim()) return 0;
  const prefix = `${ADCP_CHUNK_PREFIX}${patientId}:`;
  return deleteKnowledgeChunksBySourceAndChunkPrefix(ADCP_SOURCE, prefix);
}

/**
 * Section-key filter for targeted rebuilds.
 * chunk_id shape: adcp:{patientId}:v{version}:{sectionKey}[:subId]
 */
export function deleteAdcpChunksForPatientAndSection(
  patientId: string,
  sectionKey: string,
): number {
  if (!patientId.trim() || !sectionKey.trim()) return 0;
  const prefix = `${ADCP_CHUNK_PREFIX}${patientId}:`;
  const db = getDatabase();
  const rows = db.getAllSync<{ chunk_id: string }>(
    `SELECT chunk_id FROM knowledge_cache
     WHERE source = ? AND chunk_id LIKE ?;`,
    ADCP_SOURCE,
    `${prefix}%`,
  );
  let deleted = 0;
  for (const row of rows) {
    const parts = row.chunk_id.split(':');
    // adcp : patientId : vN : sectionKey [ : subId ]
    if (parts.length >= 4 && parts[3] === sectionKey) {
      deleteKnowledgeChunk(row.chunk_id);
      deleted += 1;
    }
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Chunk builders
// ---------------------------------------------------------------------------

interface BuildChunksOptions {
  decisionLogWindowSize: number;
  indexByCondition: boolean;
}

function buildChunksForRevision(
  plan: AdcpPlanDocument,
  patientId: string,
  options: BuildChunksOptions,
): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  const retrievedAt = plan.identity.publishedAt ?? plan.identity.effectiveAt ?? new Date().toISOString();
  const conditions = joinConditions(plan.clinicalFraming.primaryDiagnosis?.name, options.indexByCondition ? plan.clinicalFraming.primaryDiagnosis?.icd10 : undefined);
  const meta = {
    planId: plan.identity.planId,
    version: plan.identity.version,
    patientId,
    source: 'ADCP',
  };

  // 1) Clinical framing — 1 chunk.
  chunks.push(makeChunk({
    chunkId: chunkIdFor(plan.identity.planId, 'clinicalFraming'),
    text: renderClinicalFraming(plan),
    sectionHeading: 'Clinical framing',
    documentType: 'care_plan_section',
    conditions,
    metadata: { ...meta, sectionKey: 'clinicalFraming' },
    retrievedAt,
  }));

  // 2) Safety envelope — 1 chunk (high boost).
  if (
    plan.safetyEnvelope.neverDo.length > 0 ||
    plan.safetyEnvelope.alwaysDo.length > 0 ||
    (plan.safetyEnvelope.safetyNotes ?? '').trim().length > 0
  ) {
    chunks.push(makeChunk({
      chunkId: chunkIdFor(plan.identity.planId, 'safetyEnvelope'),
      text: renderSafetyEnvelope(plan),
      sectionHeading: 'Safety envelope',
      documentType: 'care_plan_section',
      conditions,
      metadata: { ...meta, sectionKey: 'safetyEnvelope', safetyPriority: true },
      retrievedAt,
    }));
  }

  // 3) Goals — 1 chunk per goal (or batched when ≤5 goals).
  if (plan.goals.goals.length > 0) {
    if (plan.goals.goals.length <= 5) {
      chunks.push(makeChunk({
        chunkId: chunkIdFor(plan.identity.planId, 'goals'),
        text: renderGoals(plan.goals.goals),
        sectionHeading: 'Goals',
        documentType: 'care_plan_section',
        conditions,
        metadata: { ...meta, sectionKey: 'goals' },
        retrievedAt,
      }));
    } else {
      for (const goal of plan.goals.goals) {
        chunks.push(makeChunk({
          chunkId: chunkIdFor(plan.identity.planId, 'goal', goal.goalId),
          text: renderGoal(goal),
          sectionHeading: `Goal: ${goal.description.slice(0, 60)}`,
          documentType: 'care_plan_section',
          conditions,
          metadata: { ...meta, sectionKey: 'goals', goalId: goal.goalId },
          retrievedAt,
        }));
      }
    }
  }

  // 4) Monitoring contract — 1 chunk (narrative, not raw table dump).
  if (plan.monitoringContract.thresholds.length > 0) {
    chunks.push(makeChunk({
      chunkId: chunkIdFor(plan.identity.planId, 'monitoringContract'),
      text: renderMonitoringContract(plan),
      sectionHeading: 'Monitoring contract',
      documentType: 'care_plan_section',
      conditions,
      metadata: { ...meta, sectionKey: 'monitoringContract' },
      retrievedAt,
    }));
  }

  // 5) Therapy contract — 0/1 chunk based on presence.
  if (plan.therapyContract.present) {
    chunks.push(makeChunk({
      chunkId: chunkIdFor(plan.identity.planId, 'therapyContract'),
      text: renderTherapyContract(plan),
      sectionHeading: 'Therapy contract',
      documentType: 'care_plan_section',
      conditions,
      metadata: { ...meta, sectionKey: 'therapyContract' },
      retrievedAt,
    }));
  }

  // 6) Care priorities — active only.
  if (plan.carePriorities.priorities.length > 0) {
    chunks.push(makeChunk({
      chunkId: chunkIdFor(plan.identity.planId, 'carePriorities'),
      text: renderPriorities(plan.carePriorities),
      sectionHeading: 'Care priorities',
      documentType: 'care_plan_section',
      conditions,
      metadata: { ...meta, sectionKey: 'carePriorities' },
      retrievedAt,
    }));
  }

  // 7) Medication bindings — 1 chunk per patient, joining med display names.
  if (plan.medicationBindings.bindings.length > 0) {
    chunks.push(makeChunk({
      chunkId: chunkIdFor(plan.identity.planId, 'medicationBindings'),
      text: renderMedicationBindings(plan, patientId),
      sectionHeading: 'Medication bindings',
      documentType: 'care_plan_section',
      conditions,
      metadata: { ...meta, sectionKey: 'medicationBindings' },
      retrievedAt,
    }));
  }

  // 8) Decision log — rolling window (default: 20 most recent entries).
  const window = plan.decisionLog.entries.slice(-options.decisionLogWindowSize);
  if (window.length > 0) {
    chunks.push(makeChunk({
      chunkId: chunkIdFor(plan.identity.planId, 'decisionLog'),
      text: renderDecisionLog(window),
      sectionHeading: `Decision log (last ${window.length})`,
      documentType: 'care_plan_decision_log',
      conditions,
      metadata: { ...meta, sectionKey: 'decisionLog', windowSize: window.length },
      retrievedAt,
    }));
  }

  // 9) Extensions (L20 — care-context SDOH/equipment/school-work).
  if (Object.keys(plan.extensions ?? {}).length > 0) {
    chunks.push(makeChunk({
      chunkId: chunkIdFor(plan.identity.planId, 'extensions'),
      text: renderExtensions(plan.extensions),
      sectionHeading: 'Care context extensions',
      documentType: 'care_plan_section',
      conditions,
      metadata: { ...meta, sectionKey: 'extensions' },
      retrievedAt,
    }));
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Helpers — chunk identity + renderers
// ---------------------------------------------------------------------------

function chunkIdFor(planId: string, sectionKey: string, subId?: string): string {
  // adcp:<patientId>:v<version>:<sectionKey>[:<subId>]. Use a stable-shaped
  // chunk_id so retrieval-helper can route / cite, and so supersedeCleanup
  // can find prior versions by source.
  return `${ADCP_CHUNK_PREFIX}${planId}:${sectionKey}${subId ? ':' + subId : ''}`;
}

function makeChunk(input: {
  chunkId: string;
  text: string;
  sectionHeading: string;
  documentType: KnowledgeChunk['documentType'];
  metadata: Record<string, unknown>;
  retrievedAt: string;
  conditions?: string;
  patientId?: string;
}): KnowledgeChunk {
  const patientId =
    (typeof input.metadata.patientId === 'string' && input.metadata.patientId) ||
    input.patientId;
  return {
    chunkId: input.chunkId,
    source: ADCP_SOURCE,
    text: input.text,
    retrievedAt: input.retrievedAt,
    useCount: 0,
    documentType: input.documentType,
    sectionHeading: input.sectionHeading,
    conditions: input.conditions,
    patientId,
    externalId: input.chunkId,
    metadataJson: JSON.stringify(input.metadata),
  };
}

function joinConditions(label?: string | null, code?: string | null): string | undefined {
  // CSV-shaped column. Undefined means no condition value is available.
  const parts = [label, code].filter((p): p is string => {
    if (typeof p !== 'string') return false;
    const normalized = p.trim().toLowerCase();
    return normalized.length > 0 && normalized !== 'null' && normalized !== 'undefined';
  });
  return parts.length > 0 ? parts.join(',') : undefined;
}

function renderClinicalFraming(plan: AdcpPlanDocument): string {
  const lines: string[] = ['CLINICAL FRAMING'];
  if (plan.clinicalFraming.primaryDiagnosis) {
    lines.push(
      `Primary: ${plan.clinicalFraming.primaryDiagnosis.name}${
        plan.clinicalFraming.primaryDiagnosis.icd10
          ? ` (ICD-10 ${plan.clinicalFraming.primaryDiagnosis.icd10})`
          : ''
      }`,
    );
  }
  if (plan.clinicalFraming.comorbidities.length > 0) {
    lines.push(
      `Comorbidities: ${plan.clinicalFraming.comorbidities
        .map((c) =>
          `${c.name}${c.icd10 ? ` (${c.icd10})` : ''}`,
        )
        .join(', ')}`,
    );
  }
  if (plan.clinicalFraming.functionalScales) {
    const scales = Object.entries(plan.clinicalFraming.functionalScales)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    if (scales) lines.push(`Functional scales: ${scales}`);
  }
  return lines.join('\n');
}

function renderSafetyEnvelope(plan: AdcpPlanDocument): string {
  const lines: string[] = ['SAFETY ENVELOPE'];
  if (plan.safetyEnvelope.neverDo.length > 0) {
    lines.push(`Never do:\n${plan.safetyEnvelope.neverDo.map((l) => `  - ${l}`).join('\n')}`);
  }
  if (plan.safetyEnvelope.alwaysDo.length > 0) {
    lines.push(`Always do:\n${plan.safetyEnvelope.alwaysDo.map((l) => `  - ${l}`).join('\n')}`);
  }
  if (plan.safetyEnvelope.emergencyContact) {
    lines.push(`Emergency contact: ${plan.safetyEnvelope.emergencyContact}`);
  }
  if (plan.safetyEnvelope.safetyNotes) {
    lines.push(`Safety notes: ${plan.safetyEnvelope.safetyNotes}`);
  }
  return lines.join('\n');
}

function renderGoals(goals: AdcpGoal[]): string {
  const lines: string[] = ['GOALS'];
  for (const g of goals) {
    lines.push(`- ${g.description}${g.targetDate ? ` (target ${g.targetDate})` : ''} [${g.status}]`);
  }
  return lines.join('\n');
}

function renderGoal(g: AdcpGoal): string {
  const lines: string[] = [`GOAL: ${g.description}`];
  if (g.targetDate) lines.push(`Target date: ${g.targetDate}`);
  if (g.measurementTarget) {
    lines.push(
      `Target: ${g.measurementTarget.displayName} = ${g.measurementTarget.targetValue ?? '—'} ${g.measurementTarget.unit} (baseline ${g.measurementTarget.baselineValue ?? '—'})`,
    );
  }
  lines.push(`Status: ${g.status}`);
  return lines.join('\n');
}

function renderMonitoringContract(plan: AdcpPlanDocument): string {
  const lines: string[] = ['MONITORING CONTRACT'];
  for (const t of plan.monitoringContract.thresholds) {
    const clause = `${t.severity === 3 ? 'CRITICAL' : t.severity === 2 ? 'URGENT' : 'CAUTION'} alert when ${t.vitalType} ${t.direction} ${t.value}`;
    lines.push(`- ${clause} (source=${t.source}${t.pendingMlVet ? ', awaiting ML vet' : ''})`);
  }
  if (plan.monitoringContract.escalationPolicyRefs.length > 0) {
    lines.push(`Escalation policies: ${plan.monitoringContract.escalationPolicyRefs.join(', ')}`);
  }
  return lines.join('\n');
}

function renderTherapyContract(plan: AdcpPlanDocument): string {
  if (!plan.therapyContract.present) return 'THERAPY CONTRACT: not active.';
  const t = plan.therapyContract;
  const lines: string[] = ['THERAPY CONTRACT'];
  if (t.activities.length > 0) {
    lines.push('Activities:');
    for (const a of t.activities) {
      lines.push(`- ${a.description ?? 'Activity'} [${a.status ?? 'active'}]`);
    }
  }
  if (t.rehabMetrics.length > 0) {
    lines.push('Rehab metrics:');
    for (const m of t.rehabMetrics) {
      lines.push(
        `- ${m.displayName}: baseline ${m.baselineValue ?? '—'} → target ${m.targetValue ?? '—'} ${m.unit}`,
      );
    }
  }
  if (t.exerciseAssignments.length > 0) {
    lines.push(`Active exercises: ${t.exerciseAssignments.map((e) => e.exerciseKey).join(', ')}`);
  }
  return lines.join('\n');
}

function renderPriorities(p: AdcpCarePrioritySection): string {
  const active = p.priorities.filter((x) => x.status === 'active');
  const lines: string[] = [`CARE PRIORITIES (${active.length} active)`];
  for (const pri of active) {
    lines.push(
      `- ${pri.title}${pri.domain ? ` [${pri.domain}]` : ''} (weight=${pri.weight.toFixed(2)})`,
    );
  }
  return lines.join('\n');
}

function renderMedicationBindings(plan: AdcpPlanDocument, patientId: string): string {
  const meds = safeGetActiveMedications(patientId);
  const byId = new Map<string, { name: string }>();
  for (const med of meds) byId.set(med.medicationId, { name: med.name });
  const lines: string[] = ['MEDICATION BINDINGS'];
  for (const b of plan.medicationBindings.bindings) {
    const med = byId.get(b.medicationId);
    lines.push(
      `- [${b.role}] ${med?.name ?? b.medicationId}${b.notes ? ` — ${b.notes}` : ''}`,
    );
  }
  return lines.join('\n');
}

function renderDecisionLog(
  entries: AdcpPlanDocument['decisionLog']['entries'],
): string {
  const lines: string[] = ['RECENT PLAN DECISIONS'];
  for (const e of entries) {
    lines.push(`- ${e.occurredAt.slice(0, 10)}: ${e.sentence}`);
  }
  return lines.join('\n');
}

function renderExtensions(extensions: Record<string, unknown>): string {
  const lines: string[] = ['CARE CONTEXT EXTENSIONS'];
  for (const [k, v] of Object.entries(extensions ?? {})) {
    const text = typeof v === 'string' ? v : JSON.stringify(v);
    lines.push(`- ${k}: ${text}`);
  }
  return lines.join('\n');
}

function safeGetActiveMedications(patientId: string): Array<{ medicationId: string; name: string }> {
  try {
    return getActiveMedications(patientId).map((m) => ({ medicationId: m.medicationId, name: m.name }));
  } catch {
    return [];
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Convenience: Build the expected chunk set for an in-memory plan (test-only
// path that does not need to call `indexAdcpPlanRevision` / write to DB).
// ---------------------------------------------------------------------------

export function describeAdcpChunks(plan: AdcpPlanDocument): string[] {
  const chunks = buildChunksForRevision(plan, plan.identity.planId.split(':v')[0] ?? '', {
    decisionLogWindowSize: 20,
    indexByCondition: true,
  });
  return chunks.map((c) => c.chunkId);
}
