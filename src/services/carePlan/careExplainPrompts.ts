/**
 * Prompt builders for Care-tab SLM explain popups (Care tab rework).
 *
 * Pure string builders — the SLM is invoked by the popup (SlmInsightSheet
 * with reason 'care_explain'), which loads the model, streams the full
 * answer (deep generation, no fast path), then unloads. These builders only
 * compose the user prompt from data already present on the snapshot.
 */

import type { LatestUc4PriorityCardSummary } from '@/data/types';
import { UC4_RULE_REGISTRY } from '@/ml-models/uc4-micro-priorities/uc4RuleRegistry';
import {
  humanizeMedicationWatchCode,
  type CareTimelineBucket,
  type MedicationWatchArea,
} from './carePrioritiesService';

const RULE_DESCRIPTIONS: ReadonlyMap<string, string> = new Map(
  UC4_RULE_REGISTRY.map((rule) => [rule.ruleCode, rule.description]),
);

function formatEvidenceValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/**
 * Explain a care-focus priority card. Carries the same material the
 * deterministic engine used (rule descriptions + evidence) so the SLM can
 * explain the card without inventing causality.
 */
export function buildUc4CardExplainPrompt(card: LatestUc4PriorityCardSummary): string {
  const ruleLines = card.firedRuleCodes
    .map((code) => RULE_DESCRIPTIONS.get(code))
    .filter((line): line is string => Boolean(line))
    .map((line) => `- ${line}`)
    .join('\n');

  const evidenceLines = (card.evidence ?? [])
    .slice(0, 6)
    .map((item) => {
      const ref = item as { fieldPath?: string; value?: unknown; source?: string };
      const value = formatEvidenceValue(ref?.value);
      if (!ref?.fieldPath) return null;
      return `- ${ref.fieldPath}: ${value}${ref.source ? ` (source: ${ref.source})` : ''}`;
    })
    .filter((line): line is string => Boolean(line))
    .join('\n');

  return [
    `Please explain this care-focus item to me in plain language: "${card.title}".`,
    '',
    `What it says: ${card.body}`,
    `Safety note attached to it: ${card.safetyBoundary}`,
    ruleLines ? `\nWhy it was raised:\n${ruleLines}` : '',
    evidenceLines ? `\nStructured evidence behind it:\n${evidenceLines}` : '',
    '',
    'Keep it short and reassuring. Do not diagnose, do not say a medication caused anything,',
    'and do not suggest changing any treatment. End with one or two concrete things I can log or watch for next.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Explain a care-plan goal or care-team activity, including its status. */
export function buildGoalOrActivityExplainPrompt(params: {
  kind: 'goal' | 'activity';
  text: string;
  status?: string | null;
  targetDate?: string | null;
}): string {
  const statusLine = params.status
    ? `Its status is "${params.status}" — explain in one sentence what that means here (for example, that the care team has not marked it complete yet).`
    : '';
  const dateLine = params.targetDate ? `Target date: ${params.targetDate}.` : '';
  return [
    params.kind === 'goal'
      ? `Please explain this goal from the care plan in plain language: "${params.text}".`
      : `Please explain this care-team activity in plain language: "${params.text}".`,
    dateLine,
    statusLine,
    '',
    'Why does it matter for this patient, and what is one practical thing I can do about it this week?',
    'Keep it short. Do not diagnose or recommend treatment changes.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Narrate the deterministic care timeline. The SLM explains; it does not re-bucket. */
export function buildTimelineExplainPrompt(buckets: CareTimelineBucket[]): string {
  const lines = buckets
    .filter((bucket) => bucket.items.length > 0)
    .map((bucket) => {
      const items = bucket.items
        .slice(0, 6)
        .map((item) => `  - ${item.text}`)
        .join('\n');
      return `${bucket.label}:\n${items}`;
    })
    .join('\n');
  return [
    'Here is the current care timeline for this patient, grouped by when things need attention:',
    '',
    lines,
    '',
    'In a few short sentences, walk me through what to focus on first and what can wait.',
    'Do not add new clinical items, do not diagnose, and do not recommend treatment changes.',
  ].join('\n');
}

/** Explain a group of related goals/activities/priorities. */
export function buildCategoryExplainPrompt(params: {
  categoryLabel: string;
  items: string[];
}): string {
  const items = params.items
    .slice(0, 8)
    .map((item) => `- ${item}`)
    .join('\n');
  return [
    `These are the current "${params.categoryLabel}" items for this patient:`,
    '',
    items,
    '',
    'In plain language, explain what ties these together and the one or two most practical things to watch or do.',
    'Keep it short. Do not diagnose or recommend treatment changes.',
  ].join('\n');
}

/** Discuss a caregiver-recorded consideration from onboarding. */
export function buildConsiderationExplainPrompt(concernText: string): string {
  return [
    `When setting up care, I noted this concern: "${concernText}".`,
    '',
    'Given the current care plan and patient context, explain briefly how the plan already covers this,',
    'and suggest one or two practical things I could watch for or log. Keep it short and supportive.',
    'Do not diagnose or recommend treatment changes.',
  ].join('\n');
}

/** Explain a medication's watch areas. */
export function buildWatchAreaExplainPrompt(area: MedicationWatchArea): string {
  const areas = area.watchAreas.map(humanizeMedicationWatchCode).join(', ');
  return [
    `For the medication "${area.medicationName}", the app lists these areas to watch: ${areas}.`,
    '',
    'Explain in plain language why these are worth keeping an eye on day to day,',
    'and what I could note down when I observe them. Keep it short.',
    'Do not say the medication is causing anything, do not suggest changing the dose, and do not diagnose.',
  ].join('\n');
}

/**
 * Seed prompt for the in-card mini chat when explaining a rehab progress
 * (UC3) result — especially the "more information is needed" path.
 */
export function buildUc3ResultExplainPrompt(display: {
  statusLabel: string;
  explanation: string | null;
  detailLines: string[];
  dataQualityLabel: string | null;
  reviewLabel: string | null;
}): string {
  const details =
    display.detailLines.length > 0
      ? `Logged detail:\n${display.detailLines.map((line) => `- ${line}`).join('\n')}`
      : 'No metric detail lines were available.';

  return [
    'Please help me understand this rehabilitation progress evaluation in plain language.',
    '',
    `Status: ${display.statusLabel}`,
    display.reviewLabel ? `Review flag: ${display.reviewLabel}` : '',
    display.explanation ? `Engine note: ${display.explanation}` : '',
    display.dataQualityLabel ? display.dataQualityLabel : '',
    details,
    '',
    'If more information is needed, tell me exactly what I should log next (exercises, pain, fatigue, walking, range of motion)',
    'and why that would make the progress picture clearer. Keep it short and practical.',
    'Do not diagnose or recommend treatment changes. End with 1–3 concrete next logging steps.',
  ]
    .filter(Boolean)
    .join('\n');
}
