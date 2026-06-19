/**
 * Shared clinical-knowledge retrieval helper for SLM screens.
 *
 * Provides a lightweight way to inject pre-bundled knowledge-cache chunks
 * (PubMed abstracts, MedlinePlus topics, RxNorm/DailyMed/OpenFDA data) into
 * SLM prompts as cited context. Uses `searchKnowledgeCache` (LIKE-based,
 * synchronous, no BM25 index needed) so it works from any screen without
 * constructing a full CachedFusedRetriever.
 *
 * Used by:
 *   - ML Care Analysis SLM (condition + anomaly type + top features)
 *   - Safety considerations SlmInsightSheet (condition + safety note)
 *   - Assistant tab (opt-in: condition/med keyword detection)
 */

import { searchKnowledgeCache, type KnowledgeChunk } from '@/data';

export interface RetrievedCitation {
  docId: string;
  source: string;
  text: string;
}

/**
 * Retrieve up to `limit` knowledge-cache chunks matching the given query
 * terms. Returns them as cited chunks ready for prompt injection.
 */
export function retrieveClinicalChunks(
  query: string,
  limit = 5,
): RetrievedCitation[] {
  if (!query.trim()) return [];
  try {
    const chunks = searchKnowledgeCache(query, limit);
    return chunks.map((c: KnowledgeChunk) => ({
      docId: c.chunkId,
      source: c.source,
      text: c.text,
    }));
  } catch {
    return [];
  }
}

/**
 * Format retrieved chunks as a prompt block the SLM can cite. Returns a string
 * suitable for injection into the system or user prompt.
 *
 * Example output:
 *   CLINICAL KNOWLEDGE (cited — use [docId] to reference)
 *   [PMID-12345678] Abstract text...
 *   [MLP-J44.1] Health topic summary...
 */
export function formatCitationsForPrompt(citations: RetrievedCitation[]): string {
  if (citations.length === 0) return '';
  const lines = ['CLINICAL KNOWLEDGE (cited — use [docId] to reference)'];
  for (const c of citations) {
    // Truncate very long chunks to keep the prompt budget reasonable.
    const maxLen = 500;
    const text = c.text.length > maxLen ? c.text.slice(0, maxLen) + '…' : c.text;
    lines.push(`[${c.docId}] ${text}`);
  }
  return lines.join('\n');
}

/**
 * Build a retrieval query from a condition + contextual terms (anomaly type,
 * features, safety note, etc.). Joens them into a single search string.
 */
export function buildRetrievalQuery(
  condition: string | undefined,
  ...contextTerms: string[]
): string {
  const parts = [condition, ...contextTerms].filter((p): p is string =>
    Boolean(p?.trim()),
  );
  return parts.join(' ');
}

/**
 * Check whether a free-text user message contains any of the patient's
 * condition or medication names — used by the Assistant tab to decide whether
 * to trigger retrieval (opt-in, to avoid latency on non-clinical questions).
 */
export function messageHasClinicalKeywords(
  message: string,
  conditions: string[],
  medications: string[],
): boolean {
  const lower = message.toLowerCase();
  return (
    conditions.some((c) => lower.includes(c.toLowerCase())) ||
    medications.some((m) => lower.includes(m.toLowerCase()))
  );
}
