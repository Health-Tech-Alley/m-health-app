/**
 * Shared context assembler for the Care Concierge intent router
 * (planning/39 §2.4, P2).
 *
 * Every Care intent pulls context from here. The assembler:
 *   - Reads ONLY from the ADCP document + UC2/3/4 slices on the snapshot.
 *   - Never queries raw repositories.
 *   - Never skips the SLM (L8: no fast path / no importance-router bypass).
 *
 * Output shape: an in-memory PromptContext that the SLM path feeds into the
 * system prompt. Returns plain text fragments so the same assembler can be
 * used by the Care insight sheet or the concierge main chat.
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

export interface PromptContext {
  patientName: string;
  patientAge?: string;
  primaryDiagnosis: { name: string; icd10?: string | null } | null;
  comorbidities: { name: string; icd10?: string | null }[];
  activeAdcp: AdcpPlanDocument | null;
  activeAdcpSummaryLines: string[];
  pendingProposals: ReturnType<typeof listPendingProposalSummaries>;
  /** Plan-rooted KG digest (P3) — empty when graph unavailable. */
  planGraphSnippet: string;
  uc2Snippet: string;
  uc3Snippet: string;
  uc4Snippet: string;
  citations: string[];
}

const MAX_CONTEXT_CHARS = 4000; // Per planning/39 §4.3 prompt-budget caution

export function buildPromptContext(
  snapshot: PatientRecordSnapshot,
  intent: AdcpProposalIntentId,
  options?: { additionalCitations?: string[] },
): PromptContext {
  const patientName = snapshot.patient?.preferredName?.trim() || snapshot.patient?.name || 'the patient';
  const patientAge = snapshot.patient?.age;
  const primary = snapshot.primaryCondition;
  const comorbidities = snapshot.comorbidities.map((c) => ({ name: c.name, icd10: c.icd10 ?? null }));

  const activeAdcp = safeGetAdcp(snapshot.patient?.patientId ?? null);
  const summary = getActiveAdcpVersionSummary(snapshot.patient?.patientId ?? '');
  const pending = listPendingProposalSummaries(snapshot.patient?.patientId ?? '');

  const activeAdcpSummaryLines = describeActiveAdcp(summary, activeAdcp);
  const planGraphSnippet = describePlanRootedGraph(snapshot.patient?.patientId ?? null, activeAdcp);
  const uc2Snippet = describeUc2(snapshot);
  const uc3Snippet = describeUc3(snapshot);
  const uc4Snippet = describeUc4(snapshot);
  const citations = (options?.additionalCitations ?? []).slice();

  const ctx: PromptContext = {
    patientName,
    patientAge,
    primaryDiagnosis: primary ? { name: primary.name, icd10: primary.icd10 ?? null } : null,
    comorbidities,
    activeAdcp,
    activeAdcpSummaryLines,
    pendingProposals: pending,
    planGraphSnippet,
    uc2Snippet,
    uc3Snippet,
    uc4Snippet,
    citations,
  };

  // Apply a soft cap to keep the prompt manageable. The most relevant slice
  // (UC by intent mapping) is locked last so it's preserved.
  const intentHasUc2 = intent === 'explain_uc2_alert' || intent === 'review_monitoring_contract' || intent === 'weekly_care_plan_review';
  const intentHasUc3 = intent === 'explain_uc3_result' || intent === 'propose_therapy_contract_patch' || intent === 'weekly_care_plan_review';
  const intentHasUc4 = intent === 'explain_uc4_card' || intent === 'promote_uc4_to_plan_task' || intent === 'weekly_care_plan_review' || intent === 'review_monitoring_contract';

  if (!(intentHasUc2 && ctx.uc2Snippet)) truncate(ctx, 'uc2Snippet');
  if (!(intentHasUc3 && ctx.uc3Snippet)) truncate(ctx, 'uc3Snippet');
  if (!(intentHasUc4 && ctx.uc4Snippet)) truncate(ctx, 'uc4Snippet');

  for (const slice of ['activeAdcpSummaryLines', 'uc2Snippet', 'uc3Snippet', 'uc4Snippet'] as const) {
    if (serialize(slice, ctx).length > MAX_CONTEXT_CHARS) {
      truncate(ctx, slice);
    }
  }

  return ctx;
}

function serialize(slice: keyof PromptContext, ctx: PromptContext): string {
  if (slice === 'activeAdcpSummaryLines') return ctx.activeAdcpSummaryLines.join('\n');
  if (slice === 'uc2Snippet') return ctx.uc2Snippet;
  if (slice === 'uc3Snippet') return ctx.uc3Snippet;
  if (slice === 'uc4Snippet') return ctx.uc4Snippet;
  if (slice === 'citations') return ctx.citations.join('\n');
  return '';
}

function truncate(ctx: PromptContext, slice: 'activeAdcpSummaryLines' | 'uc2Snippet' | 'uc3Snippet' | 'uc4Snippet'): void {
  const MAX_LINES = 25;
  const value: string | string[] =
    slice === 'activeAdcpSummaryLines' ? ctx.activeAdcpSummaryLines : ctx[slice];
  const lines = typeof value === 'string' ? value.split('\n') : value;
  const cap = lines.slice(0, MAX_LINES);
  if (slice === 'activeAdcpSummaryLines') {
    ctx.activeAdcpSummaryLines = cap;
    return;
  }
  (ctx as unknown as Record<string, string>)[slice] = cap.join('\n');
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
): string[] {
  if (!summary || !doc) {
    return ['Active ADCP: not yet seeded'];
  }
  const lines: string[] = [];
  lines.push(`Active ADCP version: v${summary.version} (${summary.publishedAt.slice(0, 10)}, source=${summary.source})`);
  lines.push(`Therapy contract present: ${summary.therapyContractPresent}`);
  lines.push(`Care priorities: ${summary.prioritiesCount}`);
  lines.push(`Medication bindings: ${summary.medicationBindingsCount}`);
  if (doc.clinicalFraming.primaryDiagnosis) {
    lines.push(`Primary: ${doc.clinicalFraming.primaryDiagnosis.name}${doc.clinicalFraming.primaryDiagnosis.icd10 ? ' (' + doc.clinicalFraming.primaryDiagnosis.icd10 + ')' : ''}`);
  }
  if (doc.monitoringContract.thresholds.length > 0) {
    lines.push('Active thresholds:');
    for (const t of doc.monitoringContract.thresholds.slice(0, 10)) {
      lines.push(`  - ${t.vitalType} ${t.direction} ${t.value} (sev ${t.severity})`);
    }
  }
  if (doc.carePriorities.priorities.length > 0) {
    lines.push('Care priorities:');
    for (const p of doc.carePriorities.priorities.slice(0, 5)) {
      lines.push(`  - ${p.title} (${p.domain}, weight=${p.weight.toFixed(2)})`);
    }
  }
  if (doc.therapyContract.present === true) {
    lines.push(`Therapy activities: ${doc.therapyContract.activities.length}`);
    lines.push(`Therapy metrics: ${doc.therapyContract.rehabMetrics.length}`);
  }
  if ('safetyEnvelope' in doc.safetyEnvelope && doc.safetyEnvelope.safetyNotes) {
    lines.push(`Safety notes: ${doc.safetyEnvelope.safetyNotes.slice(0, 240)}`);
  }
  return lines;
}

function describePlanRootedGraph(
  patientId: string | null,
  activeAdcp: AdcpPlanDocument | null,
): string {
  if (!patientId || !activeAdcp?.identity.planId) {
    return 'Plan KG: not available (no active ADCP).';
  }
  try {
    const { GraphProjector } = require('../../knowledge/graph/graph-projector') as typeof import('../../knowledge/graph/graph-projector');
    const { buildPlanRootedSubgraph } = require('../../knowledge/graph/context-subgraph') as typeof import('../../knowledge/graph/context-subgraph');
    const graph = new GraphProjector().build(patientId, 30);
    const sub = buildPlanRootedSubgraph(graph, activeAdcp.identity.planId);
    const lines: string[] = ['Plan-rooted knowledge graph:'];
    if (sub.activeCarePlan) {
      lines.push(
        `  Active plan node: ${sub.activeCarePlan.label} (${sub.activeCarePlan.id})`,
      );
    } else {
      lines.push('  Active plan node: missing (edges may not be projected yet)');
    }
    if (sub.goals.length > 0) {
      lines.push(`  Goals linked: ${sub.goals.length}`);
      for (const g of sub.goals.slice(0, 5)) {
        lines.push(`    - ${g.label}`);
      }
    }
    if (sub.recentRevisions.length > 0) {
      lines.push(`  Revision lineage edges: ${sub.recentRevisions.length}`);
    }
    if (sub.pendingProposals.length > 0) {
      lines.push(`  Pending proposal nodes: ${sub.pendingProposals.length}`);
    }
    if (sub.edges.length > 0) {
      lines.push(`  Local edges from plan root: ${sub.edges.length}`);
    }
    return lines.join('\n');
  } catch {
    return 'Plan KG: unavailable (projection error).';
  }
}

function describeUc2(snapshot: PatientRecordSnapshot): string {
  if (snapshot.thresholds.length === 0) return 'UC2 monitoring contract: no active thresholds.';
  const lines = ['UC2 monitoring contract:'];
  for (const t of snapshot.thresholds.slice(0, 10)) {
    lines.push(`  - ${t.vitalType} ${t.direction} ${t.value} (sev ${t.severity}, source=${t.source})`);
  }
  return lines.join('\n');
}

function describeUc3(snapshot: PatientRecordSnapshot): string {
  if (snapshot.therapyContractPresent === false) {
    return 'UC3 therapy contract: not on this patient.';
  }
  const lines: string[] = [];
  lines.push('UC3 therapy contract:');
  if (snapshot.rehabPlanMetrics.length > 0) {
    for (const m of snapshot.rehabPlanMetrics.slice(0, 6)) {
      lines.push(`  - ${m.displayName}: baseline=${m.baselineValue ?? '—'} target=${m.targetValue ?? '—'} ${m.unit}`);
    }
  }
  if (snapshot.latestUc3TrajectoryResult) {
    const r = snapshot.latestUc3TrajectoryResult;
    lines.push(`  Latest result: ${r.eventType} (sev ${r.severity}, generated ${r.generatedAt.slice(0, 10)})`);
  } else {
    lines.push('  Latest result: not yet evaluated.');
  }
  return lines.join('\n');
}

function describeUc4(snapshot: PatientRecordSnapshot): string {
  if (snapshot.latestUc4PriorityCards.length === 0) return 'UC4 care focus checklist: no active cards.';
  const lines = ['UC4 care focus checklist:'];
  for (const c of snapshot.latestUc4PriorityCards.slice(0, 5)) {
    lines.push(`  - ${c.title} (${c.domain}, score=${c.score.toFixed(2)})`);
  }
  return lines.join('\n');
}

export function promptContextToSystemContext(ctx: PromptContext): string {
  return [
    'Working from the active ADCP (AccessDP Care Plan) document plus the latest UC2/3/4 slices.',
    'Never rewrite the plan without going through HITL + ML vetting.',
    '',
    `PATIENT: ${ctx.patientName}${ctx.patientAge ? ` (${ctx.patientAge})` : ''}`,
    ctx.primaryDiagnosis
      ? `PRIMARY: ${ctx.primaryDiagnosis.name}${ctx.primaryDiagnosis.icd10 ? ` (${ctx.primaryDiagnosis.icd10})` : ''}`
      : 'PRIMARY: (none on record)',
    ctx.comorbidities.length > 0
      ? `COMORBIDITIES: ${ctx.comorbidities.map((c) => c.name).join(', ')}`
      : 'COMORBIDITIES: (none on record)',
    '',
    'ACTIVE ADCP',
    ...ctx.activeAdcpSummaryLines.map((line) => `- ${line}`),
    '',
    'PLAN KNOWLEDGE GRAPH',
    ctx.planGraphSnippet,
    '',
    'PENDING PROPOSALS',
    ...(ctx.pendingProposals.length > 0
      ? ctx.pendingProposals.map((p) => `- [${p.status}] ${p.kind} (${p.section}): ${p.summary}`)
      : ['- none']),
    '',
    'UC2 MONITORING CONTRACT',
    ctx.uc2Snippet,
    '',
    'UC3 THERAPY CONTRACT',
    ctx.uc3Snippet,
    '',
    'UC4 CARE PRIORITIES',
    ctx.uc4Snippet,
    '',
    'REQUIREMENTS',
    '- Use only next-step taxonomy actions (Call 911 / Go to ER / Contact PCP / Find nearby / Schedule appt / Share record / Monitor at home / Add note).',
    '- When recommending a plan change, return JSON with a "kind" + "section" + "rationale" + payload.',
    '- When explaining, lead with the answer. Use Markdown sparingly.',
    '',
    'OUTPUT CONTRACT',
    'For explanation-only intents: return Markdown text. Optional citations as [PMID-NNN].',
    'For proposal-yielding intents: return a JSON object ONLY; otherwise return Markdown.',
  ].join('\n');
}
