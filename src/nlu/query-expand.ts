/**
 * Query expansion — combine user prompt with linked entities for retrieval.
 *
 * Do NOT stuff the full patient condition/med list into BM25 — that glued
 * every turn to the entire EHR corpus and ranked off-topic HEDIS/preventive
 * chunks into unrelated intents.
 */

import type { LinkedEntity } from './types';

/**
 * Expand a retrieval query by appending linked entity labels.
 * Deduplicates and caps total length.
 */
export function expandQuery(prompt: string, entities: LinkedEntity[]): string {
  if (entities.length === 0) return prompt;

  const seen = new Set<string>();
  const parts: string[] = [];

  // Add entity labels first (high signal)
  for (const e of entities) {
    const lower = e.label.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      parts.push(e.label);
    }
  }

  // Add prompt tokens that aren't already covered
  const promptTokens = prompt.toLowerCase().split(/\s+/).filter(Boolean);
  for (const t of promptTokens) {
    if (!seen.has(t) && t.length >= 3) {
      seen.add(t);
      parts.push(t);
    }
  }

  return parts.join(' ');
}

/**
 * Build a retrieval query string from entities only (for tool/dense search).
 */
export function entityQuery(entities: LinkedEntity[]): string {
  return entities.map((e) => e.label).join(' ');
}

export type ScopedRetrievalFilters = {
  /** Conditions mentioned in the turn, or primary diagnosis fallback. */
  conditions: string[];
  /** Medications mentioned in the turn only (never the full med list). */
  activeMeds: string[];
};

/**
 * Scope BM25 condition/med filters to linked entities for this turn.
 *
 * Fallback when no clinical entities linked: primary condition name only
 * (first entry of patient conditions) — not all comorbidities/meds.
 */
export function buildScopedRetrievalFilters(
  entities: LinkedEntity[],
  patientConditions: string[],
): ScopedRetrievalFilters {
  const conditions = entities
    .filter((e) => e.type === 'condition')
    .map((e) => e.label.trim())
    .filter(Boolean);
  const activeMeds = entities
    .filter((e) => e.type === 'medication')
    .map((e) => e.label.trim())
    .filter(Boolean);

  if (conditions.length > 0) {
    return { conditions: dedupeLabels(conditions), activeMeds: dedupeLabels(activeMeds) };
  }

  const primary = patientConditions.map((c) => c.trim()).find(Boolean);
  return {
    conditions: primary ? [primary] : [],
    activeMeds: dedupeLabels(activeMeds),
  };
}

function dedupeLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of labels) {
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}
