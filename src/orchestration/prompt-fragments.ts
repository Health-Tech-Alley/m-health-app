/**
 * Prompt fragment builders.
 *
 * Shared, composable functions that turn structured data into prompt text
 * fragments. Both the orchestrator (explain path) and the chat path call
 * these so the field set stays consistent — only the voice and which
 * citation set is injected differs.
 *
 * Plan reference: planning/32 §8.3.
 */

import type { McpToolSummary } from '@/knowledge';
import type { CarePlanGoalSummary, AggregatedContext } from './context-aggregator';
import type { RetrievedChunk } from '@/knowledge/types';

export type PersonaVoice = 'chat' | 'explain';

function sourceTag(chunk: RetrievedChunk): string {
  const labels: Record<string, string> = {
    pubmed: 'PubMed',
    medlineplus: 'MedlinePlus',
    dailymed: 'Drug Label',
    openfda: 'FDA Safety',
    clinicaltrials: 'Clinical Trial',
    orphanet: 'Rare Disease',
    umls: 'UMLS',
    'cdc-places': 'SDOH',
    semmeddb: 'SemMedDB',
    hedis: 'HEDIS',
    synthetic: 'Development Fixture',
    'patient-plan': 'Care Plan',
    'patient-record': 'Patient Record',
    rxnorm: 'RxNorm',
  };
  const label = labels[String(chunk.source)] ?? String(chunk.source);
  const section = chunk.sectionHeading ? ` · ${chunk.sectionHeading}` : '';
  return `${label}${section}`;
}

function citationProvenance(chunk: RetrievedChunk): string {
  const parts = [
    chunk.sourceId ? `source_id=${chunk.sourceId}` : null,
    chunk.resourceId ? `resource_id=${chunk.resourceId}` : null,
    chunk.effectiveAt ? `effective_at=${chunk.effectiveAt}` : null,
    chunk.createdAt ? `retrieved_at=${chunk.createdAt}` : null,
    chunk.retrievalMethod ? `method=${chunk.retrievalMethod}` : null,
    chunk.synthetic ? 'development_fixture=true' : null,
  ].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join('; ')})` : '';
}

function citationLine(chunk: RetrievedChunk, text: string): string {
  const base = `[${sourceTag(chunk).trim()}]${citationProvenance(chunk)} ${text}`;
  if (chunk.graphRelation && chunk.graphSeedId) {
    return `[${chunk.graphRelation}←${chunk.graphSeedId}] ${base}`;
  }
  return base;
}

export interface PatientBlockInput {
  name: string;
  age?: string;
  primaryCondition?: { name: string; icd10?: string; category?: string };
  comorbidities: string[];
  symptoms: { label: string; category: string }[];
  medications?: string;
  spo2Cutoff?: string;
  baselineHeartRate?: string;
  /** Functional scales for CP / post-stroke / TBI (planning/32 §8.4). */
  functionalScales?: {
    gmfcs?: string;
    fms?: string;
    macs?: string;
    cfcs?: string;
    edacs?: string;
  };
  /** Free-text patient location for SDOH (planning/32 §10.2 / D5). */
  location?: string;
}

export interface PriorDecisionEntry {
  verb: string;
  summary: string;
  at: string;
}

export function patientBlock(p: PatientBlockInput): string {
  const lines: string[] = [];
  lines.push('PATIENT');
  lines.push(
    `${p.name}${p.age ? `, age ${p.age}` : ''}.`,
  );

  if (p.primaryCondition) {
    const code = p.primaryCondition.icd10 ? ` (${p.primaryCondition.icd10})` : '';
    const cat = p.primaryCondition.category ? ` [${p.primaryCondition.category}]` : '';
    lines.push(`Primary: ${p.primaryCondition.name}${code}${cat} — PRIMARY`);
  } else {
    lines.push('Primary: None documented');
  }
  lines.push(
    p.comorbidities.length > 0
      ? `Comorbidities:\n${p.comorbidities.map((c) => `  - ${c}`).join('\n')}`
      : 'Comorbidities:  - None documented',
  );
  lines.push(
    p.symptoms.length > 0
      ? `Symptoms: ${p.symptoms.map((s) => `${s.label} [${s.category}]`).join(', ')}`
      : 'Symptoms: None documented',
  );
  lines.push(`Meds: ${p.medications ?? 'none documented'}.`);
  lines.push(
    `SpO2 floor: ${p.spo2Cutoff ?? 'not set'}. Baseline HR: ${p.baselineHeartRate ?? 'not set'}.`,
  );

  if (p.functionalScales) {
    const scales = p.functionalScales;
    const parts = [
      scales.gmfcs ? `GMFCS ${scales.gmfcs}` : null,
      scales.fms ? `FMS ${scales.fms}` : null,
      scales.macs ? `MACS ${scales.macs}` : null,
      scales.cfcs ? `CFCS ${scales.cfcs}` : null,
      scales.edacs ? `EDACS ${scales.edacs}` : null,
    ].filter(Boolean);
    if (parts.length > 0) {
      lines.push(`Functional scales: ${parts.join(' · ')}.`);
    }
  }

  if (p.location) {
    lines.push(`Location: ${p.location}.`);
  }
  return lines.join('\n');
}

export function thresholdsBlock(
  thresholds: { vitalType: string; value: number; direction: string; severity: number }[],
): string {
  if (thresholds.length === 0) return 'ACTIVE THRESHOLDS\nNone configured';
  return [
    'ACTIVE THRESHOLDS',
    ...thresholds.map((t) => `- ${t.vitalType} ${t.direction} ${t.value} (severity ${t.severity})`),
  ].join('\n');
}

export function carePlanGoalsBlock(goals: CarePlanGoalSummary[]): string {
  if (goals.length === 0) return 'CARE PLAN GOALS\nNone configured';
  return [
    'CARE PLAN GOALS',
    ...goals.map((g) => `- ${g.description}${g.targetDate ? ` (target: ${g.targetDate})` : ''}`),
  ].join('\n');
}

export function recentVitalsBlock(
  vitals: Record<string, { latest?: number; unit: string; samples: number }>,
): string {
  const entries = Object.entries(vitals);
  if (entries.length === 0) return 'RECENT VITALS (24h)\nNo recent vitals';
  return [
    'RECENT VITALS (24h)',
    ...entries.map(([type, info]) => `- ${type}: latest ${info.latest} ${info.unit} (${info.samples} samples in 24h)`),
  ].join('\n');
}

/**
 * Truncation budget for the citations block.
 * - Fast (chat / safety_note): 1500 chars across all chunks.
 * - Deep (explain / med_interaction): 3000 chars.
 */
export function citationsBlock(
  chunks: RetrievedChunk[],
  maxChars = 1500,
): string {
  if (chunks.length === 0) return 'CITATIONS\nNo citations retrieved';
  const lines: string[] = ['CITATIONS'];
  let used = 0;
  for (const c of chunks) {
    const remaining = maxChars - used;
    if (remaining <= 50) break;
    const text = c.text.length > remaining ? c.text.slice(0, remaining) + '…' : c.text;
    lines.push(citationLine(c, text));
    used += text.length + citationLine(c, '').length;
  }
  return lines.join('\n');
}

export function budgetAwareCitationsBlock(
  chunks: RetrievedChunk[],
  tokenBudget: number,
  opts: { maxCharsPerChunk?: number; minCharsPerChunk?: number } = {},
): string {
  if (chunks.length === 0) return 'CITATIONS\nNo citations retrieved';
  const maxPer = opts.maxCharsPerChunk ?? 1500;
  const minPer = opts.minCharsPerChunk ?? 200;
  const totalChars = tokenBudget * 4;
  const scored = chunks.map((c, i) => ({ c, score: (c.score ?? 0) || 1 / (i + 1) }));
  const totalScore = scored.reduce((s, x) => s + x.score, 0) || 1;
  const lines: string[] = ['CITATIONS'];
  let used = 0;
  for (const { c, score } of scored) {
    const remaining = totalChars - used;
    if (remaining <= minPer) break;
    const share = Math.max(minPer, Math.min(maxPer, Math.round((score / totalScore) * totalChars)));
    const cap = Math.min(share, remaining);
    const text = c.text.length > cap ? c.text.slice(0, cap - 1) + '…' : c.text;
    lines.push(citationLine(c, text));
    used += text.length + citationLine(c, '').length;
  }
  return lines.join('\n');
}

export function toolsBlock(tools: McpToolSummary[]): string {
  if (tools.length === 0) return 'AVAILABLE TOOLS\nNone';
  return [
    'AVAILABLE TOOLS',
    ...tools.map((t) => `- ${t.name}: ${t.description}`),
  ].join('\n');
}

/**
 * Chat-path instructions for Health Monitor tool proposals.
 * Tool execution is confirm-gated in the UI — the model only proposes ACTION.
 */
export function healthMonitorToolInstruction(): string {
  return [
    'HEALTH MONITOR TOOL (confirm-gated)',
    '- For vitals / what-if / Health Monitor questions, you may emit:',
    '  ACTION: evaluate_hypothetical_vitals({"blood_oxygen":86,"heart_rate":110,"respiratory_rate":28})',
    '- SpO2 is 0–100 percent (86 not 0.86). Only include vitals the caregiver stated or clearly implied.',
    '- Do not invent anomaly scores, severity, or ML results. The app may run Health Monitor automatically when vitals are present; wait for monitor results before claiming scores.',
    '- After an ACTION line, keep prose brief and do not claim results until confirmation.',
    '- Med/schedule/education questions: do not emit evaluate_hypothetical_vitals.',
  ].join('\n');
}

export function escalationBlock(pcpName?: string): string {
  return [
    'ESCALATION',
    `- Red flags (trouble breathing, chest pain, sudden one-sided weakness, severe bleeding, loss of consciousness, SpO2 below the cutoff): lead with 'Call 911 now' and a brief 'while you wait' checklist.`,
    `- Non-emergent but time-sensitive: 'Contact ${pcpName ?? 'the primary care provider'} today'.`,
    '- When unsure, escalate sooner.',
  ].join('\n');
}

/**
 * Caregiver-tone instruction extracted from slmService.buildCaregiverSystemContext.
 * Lifted here so the chat + explain paths both use the same wording.
 */
export function caregiverToneInstruction(comfortLevel?: string): string {
  const comfort = (comfortLevel ?? '').toLowerCase();
  if (
    comfort.includes('clinical') ||
    comfort.includes('medical professional') ||
    comfort.includes('nurse') ||
    comfort.includes('dnp') ||
    comfort.includes('fnp')
  ) {
    return 'This caregiver has clinical training (FNP/DNP/RN). You can use clinical terms and skip basic explanations.';
  }
  if (comfort.includes('comfortable') || comfort.includes('experienced')) {
    return 'This caregiver is medically comfortable. Brief clinical terms are OK; explain only the non-obvious.';
  }
  if (comfort.includes('not') || comfort.includes('limited') || comfort.includes('none')) {
    return 'This caregiver is not clinically trained. Avoid medical jargon or define it inline. Do not announce your tone.';
  }
  return 'Use short everyday wording. Define any medical term you introduce. Do not announce your tone or say you are simplifying.';
}

/**
 * Sensitive-topics & medication-description instruction.
 *
 * Teaches the Concierge to (a) describe medications purpose-first and (b) frame
 * severe/terminal outcomes tenderly without padding or false reassurance.
 * Comfort-level-aware on the chat path (where caregiverMedicalComfortLevel is
 * available); the explain path calls it with no arg for the gentle default —
 * AggregatedContext.caregiver does not currently carry medicalComfortLevel.
 */
export function sensitiveTopicsInstruction(comfortLevel?: string): string {
  const lines: string[] = [
    'SENSITIVE TOPICS & MEDICATION DESCRIPTIONS',
    "- When describing a medication, lead with what it is and what it's for (its purpose), then common effects, then — briefly and gently — note that serious reactions are possible. Favor the type of reaction over the worst outcome (e.g. \"serious allergic reactions have been reported\" rather than \"death is possible\").",
    '- When a severe or terminal outcome is relevant (death, life-threatening reactions, ICU, irreversible decline), state it plainly but tenderly — never lead with it, never dwell. One sentence, then move to what the caregiver can do.',
    '- Do not pad with reassurance or positivity. Stay direct and warm; just avoid bluntness.',
  ];
  const comfort = (comfortLevel ?? '').toLowerCase();
  if (
    comfort.includes('clinical') ||
    comfort.includes('medical professional') ||
    comfort.includes('nurse') ||
    comfort.includes('dnp') ||
    comfort.includes('fnp')
  ) {
    lines.push(
      '- This caregiver is clinically trained. State serious outcomes factually (including death where relevant) — still lead with purpose, never with the worst outcome, but do not soften or omit severe facts.',
    );
  } else if (comfort.includes('not') || comfort.includes('limited') || comfort.includes('none')) {
    lines.push(
      '- This caregiver is not clinically trained. Frame serious outcomes gently ("in rare cases, serious reactions have been reported"); do not lead with or emphasize death.',
    );
  } else {
    lines.push(
      '- Frame serious outcomes gently. Mention severe facts when relevant, but never lead with or dwell on the worst outcome.',
    );
  }
  return lines.join('\n');
}

/**
 * Persona preamble — voice differs between chat (warm) and explain (more clinical).
 */
export function personaPreamble(opts: {
  voice: PersonaVoice;
  caregiverFirst: string;
  patientFirst: string;
}): string {
  const { voice, caregiverFirst, patientFirst } = opts;
  if (voice === 'chat') {
    return [
      'You are a caregiving assistant called the Concierge. You talk like a warm, practical friend — not a textbook or a doctor.',
      'Adapt your response length to the query: brief for simple questions, more detailed when the situation warrants it.',
      'Be direct. If you need to think through a clinical question, do that thinking privately — the caregiver sees only your final answer, never a chain of thought.',
      '',
      `The caregiver's name is ${caregiverFirst}. The patient's name is ${patientFirst}. Speak as "I". Use the caregiver's name rarely — only in the first message or urgent situations, not in every response.`,
    ].join('\n');
  }
  return [
    `You are the Concierge — a warm, practical caregiving assistant. Speak to the caregiver as "I" and refer to the patient by first name (${patientFirst}). You are NOT a doctor.`,
    'You are contextualizing the alert for this specific caregiver. Be precise and grounded.',
  ].join('\n');
}

/**
 * Prior-decisions block (D8 / §9). Compresses the recent audit + the current
 * non-emergency decision into a compact 3–5 line prompt fragment.
 */
export function priorDecisionsBlock(entries: PriorDecisionEntry[]): string {
  if (entries.length === 0) return 'PRIOR DECISIONS\nNone on file';
  const lines = ['PRIOR DECISIONS (recent caregiver actions + open decisions)'];
  for (const e of entries.slice(0, 5)) {
    lines.push(`- ${e.at.slice(0, 10)} · ${e.verb} · ${e.summary}`);
  }
  return lines.join('\n');
}

/**
 * Progress measures block (P7). Surfaces the most-recent rehab measurement
 * per type + the last 5 longitudinal observations. Lets the SLM reason
 * over "Grip strength dropped from 18 to 14 kg" or "Seizure frequency
 * went from 2/month to 5/week" when the alert fires.
 */
export function progressMeasuresBlock(
  pm: AggregatedContext['progressMeasures'],
): string {
  if (!pm) return 'PROGRESS MEASURES\nNone recorded';
  const lines: string[] = ['PROGRESS MEASURES'];
  if (pm.rehabilitation && pm.rehabilitation.length > 0) {
    lines.push('Rehabilitation (latest per type):');
    for (const r of pm.rehabilitation) {
      lines.push(`- ${r.type}: ${r.value} ${r.unit} (${r.recordedAt.slice(0, 10)})`);
    }
  }
  if (pm.longitudinal && pm.longitudinal.length > 0) {
    lines.push('Longitudinal (last 5):');
    for (const o of pm.longitudinal) {
      const val = o.numericValue !== null && o.numericValue !== undefined
        ? `${o.numericValue}${o.textValue ? ` (${o.textValue})` : ''}`
        : (o.textValue ?? '—');
      lines.push(`- ${o.type}: ${val} (${o.recordedAt.slice(0, 10)})`);
    }
  }
  if (lines.length === 1) return 'PROGRESS MEASURES\nNone recorded';
  return lines.join('\n');
}

/** UC3 persisted trajectory result — structured only (doc 38). */
export function rehabTrajectoryBlock(
  rt: AggregatedContext['rehabTrajectory'],
): string {
  if (!rt) return 'REHAB TRAJECTORY (UC3)\nNone recorded';
  const lines = [
    'REHAB TRAJECTORY (UC3) — persisted result; do not re-score',
    `resultId: ${rt.resultId}`,
    `eventType: ${rt.eventType}`,
    `severity: ${rt.severity}`,
    `requiresHumanReview: ${rt.requiresHumanReview}`,
    `emergencyThresholdBreach: ${rt.emergencyThresholdBreach}`,
    `reviewPriorityScore: ${rt.reviewPriorityScore}`,
    `reasonCodes: ${rt.reasonCodes.join(', ') || 'none'}`,
  ];
  if (rt.caregiverMessagePreview) {
    lines.push(`caregiverMessagePreview: ${rt.caregiverMessagePreview}`);
  }
  return lines.join('\n');
}

/** UC4 active micro-priority cards — structured only (doc 38). */
export function uc4PrioritiesBlock(
  cards: AggregatedContext['uc4Priorities'],
): string {
  if (!cards || cards.length === 0) return 'CARE FOCUS PRIORITIES (UC4)\nNone active';
  const lines = ['CARE FOCUS PRIORITIES (UC4) — do not re-score or invent templates'];
  for (const c of cards) {
    lines.push(
      `- ${c.title} (templateId=${c.templateId}, score=${c.score.toFixed(3)}, cardId=${c.cardId})`,
    );
  }
  return lines.join('\n');
}
