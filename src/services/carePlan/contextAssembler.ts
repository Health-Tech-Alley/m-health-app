/**
 * Shared context assembler for the Care Concierge intent router
 * (planning/39 §2.4, P2).
 *
 * Every Care intent pulls context from here. The assembler:
 *   - Reads ONLY from the ADCP document + UC2/3/4 slices on the snapshot.
 *   - Never queries raw repositories.
 *   - Never skips the SLM (L8: no fast path / no importance-router bypass).
 *
 * Output is intentionally compact: n_ctx is often 4096; stacking full caregiver
 * system + tools + literature was overflowing and capping n_predict to ~128.
 */

import type { PatientRecordSnapshot } from '@/data/types';
import {
  getActiveAdcpRevisionForPatient,
  getActiveAdcpVersionSummary,
  listPendingProposalSummaries,
} from '@/data/repositories/adcpRepository';
import type {
  AdcpPlanDocument,
  AdcpProposalIntentId,
} from '@/data/adcp/types';
import { getAssignedDevelopmentRehabExercises } from '@/data/uc3RehabExercises';
import { GraphProjector } from '@/knowledge/graph/graph-projector';
import { buildPlanRootedSubgraph } from '@/knowledge/graph/context-subgraph';

export interface PromptContext {
  patientName: string;
  patientAge?: string;
  primaryDiagnosis: { name: string; icd10?: string | null } | null;
  comorbidities: { name: string; icd10?: string | null }[];
  activeAdcp: AdcpPlanDocument | null;
  activeAdcpSummaryLines: string[];
  pendingProposals: ReturnType<typeof listPendingProposalSummaries>;
  /** Plan-rooted KG digest (P3) — kept short. */
  planGraphSnippet: string;
  uc2Snippet: string;
  uc3Snippet: string;
  uc4Snippet: string;
  /** Active medications from the patient record. */
  medicationsSnippet: string;
  citations: string[];
}

/**
 * Hard budget for the intent system block alone (leave room for user + answer).
 * Sections are assembled tail-first (plan graph is last), so truncation drops
 * the graph snippet before it ever cuts meds / UC2 / UC3 / UC4.
 */
const MAX_SYSTEM_CHARS = 2600;

export function buildPromptContext(
  snapshot: PatientRecordSnapshot,
  intent: AdcpProposalIntentId,
  options?: { additionalCitations?: string[] },
): PromptContext {
  const patientName =
    snapshot.patient?.preferredName?.trim() ||
    snapshot.patient?.name ||
    'the patient';
  const patientAge = snapshot.patient?.age;
  const primary = snapshot.primaryCondition;
  const comorbidities = snapshot.comorbidities.map((c) => ({
    name: c.name,
    icd10: c.icd10 ?? null,
  }));

  const patientId = snapshot.patient?.patientId ?? null;
  const activeAdcp = safeGetAdcp(patientId);
  const summary = getActiveAdcpVersionSummary(patientId ?? '');
  const pending = listPendingProposalSummaries(patientId ?? '');

  const activeAdcpSummaryLines = describeActiveAdcp(summary, activeAdcp, snapshot);
  const planGraphSnippet = describePlanRootedGraph(patientId, activeAdcp);
  const uc2Snippet = describeUc2(snapshot);
  const uc3Snippet = describeUc3(snapshot);
  const uc4Snippet = describeUc4(snapshot);
  const medicationsSnippet = describeMedications(snapshot);
  const citations = (options?.additionalCitations ?? []).slice();

  const ctx: PromptContext = {
    patientName,
    patientAge,
    primaryDiagnosis: primary
      ? { name: primary.name, icd10: primary.icd10 ?? null }
      : null,
    comorbidities,
    activeAdcp,
    activeAdcpSummaryLines,
    pendingProposals: pending,
    planGraphSnippet,
    uc2Snippet,
    uc3Snippet,
    uc4Snippet,
    medicationsSnippet,
    citations,
  };

  const intentHasUc2 =
    intent === 'explain_uc2_alert' ||
    intent === 'review_monitoring_contract' ||
    intent === 'weekly_care_plan_review';
  const intentHasUc3 =
    intent === 'explain_uc3_result' ||
    intent === 'propose_therapy_contract_patch' ||
    intent === 'weekly_care_plan_review';
  const intentHasUc4 =
    intent === 'explain_uc4_card' ||
    intent === 'promote_uc4_to_plan_task' ||
    intent === 'weekly_care_plan_review' ||
    intent === 'review_monitoring_contract';

  // Drop non-priority UC slices to a one-liner so intent-relevant data wins.
  if (!intentHasUc2) ctx.uc2Snippet = oneLine(ctx.uc2Snippet, 'UC2: (see ADCP thresholds)');
  if (!intentHasUc3) ctx.uc3Snippet = oneLine(ctx.uc3Snippet, 'UC3: (see therapy if present)');
  if (!intentHasUc4) ctx.uc4Snippet = oneLine(ctx.uc4Snippet, 'UC4: (see care priorities)');

  // Graph is rarely needed for caregiver Q&A — keep one line.
  ctx.planGraphSnippet = oneLine(ctx.planGraphSnippet, 'Plan KG: n/a');

  return ctx;
}

function oneLine(text: string, fallback: string): string {
  const first = text.split('\n').find((l) => l.trim().length > 0)?.trim();
  return first && first.length < 120 ? first : fallback;
}

function safeGetAdcp(patientId: string | null): AdcpPlanDocument | null {
  if (!patientId) return null;
  try {
    return getActiveAdcpRevisionForPatient(patientId);
  } catch {
    return null;
  }
}

function describeActiveAdcp(
  summary: ReturnType<typeof getActiveAdcpVersionSummary>,
  doc: AdcpPlanDocument | null,
  snapshot: PatientRecordSnapshot,
): string[] {
  if (!summary || !doc) {
    return ['ADCP: not yet seeded'];
  }
  const lines: string[] = [];
  lines.push(
    `ADCP v${summary.version} (${summary.publishedAt.slice(0, 10)}, ${summary.source})`,
  );
  if (doc.clinicalFraming.primaryDiagnosis) {
    const d = doc.clinicalFraming.primaryDiagnosis;
    lines.push(
      `Primary: ${d.name}${d.icd10 ? ` (${d.icd10})` : ''}`,
    );
  }
  const goals = doc.goals?.goals ?? [];
  if (goals.length > 0) {
    lines.push(
      `Goals: ${goals
        .slice(0, 5)
        .map((g) => g.description?.trim() || g.goalId)
        .filter(Boolean)
        .join('; ')}`,
    );
  } else if ((snapshot.carePlanGoals ?? []).length > 0) {
    lines.push(
      `Goals: ${snapshot.carePlanGoals
        .slice(0, 5)
        .map((g) => g.description)
        .join('; ')}`,
    );
  }

  if (doc.monitoringContract.thresholds.length > 0) {
    lines.push(
      `Thresholds: ${doc.monitoringContract.thresholds
        .slice(0, 6)
        .map((t) => `${t.vitalType} ${t.direction} ${t.value}`)
        .join('; ')}`,
    );
  }

  if (doc.carePriorities.priorities.length > 0) {
    const active = doc.carePriorities.priorities.filter((p) => p.status === 'active');
    const list = (active.length > 0 ? active : doc.carePriorities.priorities).slice(0, 6);
    lines.push(
      `Priorities: ${list
        .map((p) => `${p.title}${p.domain ? ` [${p.domain}]` : ''}`)
        .join('; ')}`,
    );
  }

  if (doc.therapyContract.present === true) {
    const t = doc.therapyContract;
    const acts = t.activities
      .slice(0, 4)
      .map((a) => a.description?.trim())
      .filter(Boolean);
    if (acts.length > 0) lines.push(`Therapy activities: ${acts.join('; ')}`);
    if (t.rehabMetrics.length > 0) {
      lines.push(
        `Rehab metrics: ${t.rehabMetrics
          .slice(0, 5)
          .map(
            (m) =>
              `${m.displayName} ${m.baselineValue ?? '—'}→${m.targetValue ?? '—'} ${m.unit}`,
          )
          .join('; ')}`,
      );
    }
    if (t.exerciseAssignments.length > 0) {
      lines.push(
        `Exercises: ${t.exerciseAssignments
          .filter((e) => e.active)
          .map((e) => e.exerciseKey.replace(/_/g, ' '))
          .join('; ')}`,
      );
    }
  } else {
    lines.push('Therapy contract: not present');
  }

  // Resolve medication binding ids to names from snapshot when possible.
  const bindings = doc.medicationBindings?.bindings ?? [];
  if (bindings.length > 0) {
    const byId = new Map(
      (snapshot.medications ?? []).map((m) => [m.medicationId, m.name]),
    );
    lines.push(
      `Med bindings: ${bindings
        .slice(0, 8)
        .map((b) => {
          const name = byId.get(b.medicationId) ?? b.medicationId;
          return `${name} (${b.role})`;
        })
        .join('; ')}`,
    );
  }

  if (
    'safetyEnvelope' in doc.safetyEnvelope &&
    doc.safetyEnvelope.safetyNotes
  ) {
    lines.push(`Safety: ${doc.safetyEnvelope.safetyNotes.slice(0, 160)}`);
  }

  return lines;
}

function describePlanRootedGraph(
  patientId: string | null,
  activeAdcp: AdcpPlanDocument | null,
): string {
  if (!patientId || !activeAdcp?.identity.planId) {
    return 'Plan KG: n/a';
  }
  try {
    const graph = new GraphProjector().build(patientId, 30);
    const sub = buildPlanRootedSubgraph(graph, activeAdcp.identity.planId);
    const goalN = sub.goals?.length ?? 0;
    return `Plan KG: plan=${sub.activeCarePlan ? 'yes' : 'no'} goals=${goalN}`;
  } catch {
    return 'Plan KG: n/a';
  }
}

function describeUc2(snapshot: PatientRecordSnapshot): string {
  if (snapshot.thresholds.length === 0) return 'UC2: no active thresholds';
  return `UC2: ${snapshot.thresholds
    .slice(0, 6)
    .map((t) => `${t.vitalType} ${t.direction} ${t.value}`)
    .join('; ')}`;
}

function describeUc3(snapshot: PatientRecordSnapshot): string {
  if (snapshot.therapyContractPresent === false) return 'UC3: not on this patient';
  const parts: string[] = [];
  const assigned = getAssignedDevelopmentRehabExercises(
    snapshot.rehabExerciseAssignments ?? [],
  );
  if (assigned.length > 0) {
    parts.push(`exercises ${assigned.map((e) => e.label).join(', ')}`);
  }
  if (snapshot.rehabPlanMetrics.length > 0) {
    parts.push(
      `metrics ${snapshot.rehabPlanMetrics
        .slice(0, 4)
        .map((m) => `${m.displayName} ${m.baselineValue ?? '—'}→${m.targetValue ?? '—'}`)
        .join(', ')}`,
    );
  }
  if (snapshot.latestUc3TrajectoryResult) {
    const r = snapshot.latestUc3TrajectoryResult;
    parts.push(`latest ${r.eventType} sev=${r.severity}`);
  }
  return parts.length > 0 ? `UC3: ${parts.join(' · ')}` : 'UC3: present, no detail yet';
}

function describeUc4(snapshot: PatientRecordSnapshot): string {
  if (snapshot.latestUc4PriorityCards.length === 0) return 'UC4: no active cards';
  return `UC4: ${snapshot.latestUc4PriorityCards
    .slice(0, 6)
    .map((c) => `${c.title} [${c.domain}]`)
    .join('; ')}`;
}

function describeMedications(snapshot: PatientRecordSnapshot): string {
  const active = (snapshot.medications ?? []).filter((m) => m.active !== false);
  if (active.length === 0) {
    const legacy = snapshot.patient?.currentMedications?.trim();
    return legacy ? `Meds: ${legacy.slice(0, 200)}` : 'Meds: none listed';
  }
  return `Meds: ${active
    .slice(0, 12)
    .map((m) => {
      const bits = [m.name.trim()];
      if (m.dosage?.trim()) bits.push(m.dosage.trim());
      if (m.frequency?.trim()) bits.push(m.frequency.trim());
      return bits.join(' ');
    })
    .join('; ')}`;
}

/**
 * Compact system context for Care intents (Ask about the plan / insight sheet).
 * Do not stack a second full caregiver+tools system on top of this.
 */
export function promptContextToSystemContext(ctx: PromptContext): string {
  const pending =
    ctx.pendingProposals.length > 0
      ? ctx.pendingProposals
          .slice(0, 4)
          .map((p) => `${p.kind}/${p.status}: ${p.summary}`)
          .join('; ')
      : 'none';

  let text = [
    'Care plan Concierge — ground answers in ADCP + UC slices + meds below.',
    'Do not invent plan items, exercises, or meds. Do not change the plan without HITL.',
    `Patient: ${ctx.patientName}${ctx.patientAge ? ` (${ctx.patientAge})` : ''}`,
    ctx.primaryDiagnosis
      ? `Primary: ${ctx.primaryDiagnosis.name}${ctx.primaryDiagnosis.icd10 ? ` (${ctx.primaryDiagnosis.icd10})` : ''}`
      : 'Primary: (none)',
    ctx.comorbidities.length > 0
      ? `Comorbidities: ${ctx.comorbidities.map((c) => c.name).join(', ')}`
      : null,
    '',
    'ADCP',
    ...ctx.activeAdcpSummaryLines.map((l) => `- ${l}`),
    ctx.medicationsSnippet,
    ctx.uc2Snippet,
    ctx.uc3Snippet,
    ctx.uc4Snippet,
    `Pending proposals: ${pending}`,
    ctx.planGraphSnippet,
    '',
    'Explain in plain language. Lead with the answer. No treatment changes or new diagnoses.',
  ]
    .filter((line): line is string => line != null)
    .join('\n');

  if (text.length > MAX_SYSTEM_CHARS) {
    text = `${text.slice(0, MAX_SYSTEM_CHARS)}\n…`;
  }
  return text;
}

/**
 * Compact ADCP + meds block for free-text Care plan follow-ups (no intent router).
 */
export function buildCompactCarePlanSystemContext(
  snapshot: PatientRecordSnapshot | null | undefined,
  intent: AdcpProposalIntentId = 'weekly_care_plan_review',
): string {
  if (!snapshot) {
    return 'Care plan: no patient loaded — do not invent plan or medication details.';
  }
  return promptContextToSystemContext(buildPromptContext(snapshot, intent));
}

