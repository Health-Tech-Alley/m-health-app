/**
 * Query expansion — combine user prompt with linked entities for retrieval.
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
