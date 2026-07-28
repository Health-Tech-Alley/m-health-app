/**
 * PubMed E-utilities client.
 *
 * Calls esearch.fcgi (search → PMIDs) and efetch.fcgi (PMIDs → abstracts).
 * De-identified queries only. All calls audited via the enrichment log.
 *
 * See planning/22_clinical-data-gathering.md §5a.
 */

import type { KnowledgeChunk } from '@/data/types';
import { getNcbiApiKey } from '@/services/ncbi-token-store';
import { withRetry } from './rate-limiter';

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const TIMEOUT_MS = 25_000;

/** PMC OA full-text API (not always available for every PMID). */
const PMC_FULLTEXT_BASE = 'https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi';

export interface PubMedSearchResult {
  pmids: string[];
  query: string;
}

/**
 * Search PubMed for abstracts matching a de-identified query.
 * Returns a list of PMIDs.
 *
 * @param params.filter Optional PubMed filter. Use 'systematic_review' to
 *                       restrict to meta-analyses + systematic reviews
 *                       (P5b). Use 'free_full_text' for the PMC OA subset.
 */
export async function searchPubMed(params: {
  query: string;
  retmax?: number;
  filter?: 'systematic_review' | 'free_full_text' | 'guideline';
}): Promise<PubMedSearchResult> {
  const { query, retmax = 20, filter } = params;
  const apiKey = await getNcbiApiKey();

  const url = new URL(`${EUTILS_BASE}/esearch.fcgi`);
  url.searchParams.set('db', 'pubmed');
  url.searchParams.set('term', query);
  url.searchParams.set('retmax', String(retmax));
  url.searchParams.set('retmode', 'json');
  url.searchParams.set('sort', 'relevance');
  if (apiKey) url.searchParams.set('api_key', apiKey);

  // P5b: PubMed filter tags.
  // - systematic[sb] OR meta-analysis[pt]   → high-quality evidence tier
  // - free full text[sb]                    → PMC OA subset for full-text
  // - guideline[pt]                         → published guidelines
  if (filter === 'systematic_review') {
    url.searchParams.set('term', `${query} AND (systematic[sb] OR meta-analysis[pt])`);
  } else if (filter === 'free_full_text') {
    url.searchParams.set('term', `${query} AND free full text[sb]`);
  } else if (filter === 'guideline') {
    url.searchParams.set('term', `${query} AND (guideline[pt] OR practice guideline[pt])`);
  }

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    throw new Error(`PubMed esearch failed: ${response.status}`);
  }

  const json = await response.json();
  const pmids: string[] = json?.esearchresult?.idlist ?? [];
  return { pmids, query };
}

/**
 * Fetch abstracts for a list of PMIDs. Returns KnowledgeChunk rows
 * ready for the knowledge_cache table.
 */
export async function fetchAbstracts(pmids: string[]): Promise<KnowledgeChunk[]> {
  if (pmids.length === 0) return [];
  const apiKey = await getNcbiApiKey();

  const url = new URL(`${EUTILS_BASE}/efetch.fcgi`);
  url.searchParams.set('db', 'pubmed');
  url.searchParams.set('id', pmids.join(','));
  url.searchParams.set('rettype', 'abstract');
  url.searchParams.set('retmode', 'text');
  if (apiKey) url.searchParams.set('api_key', apiKey);

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    throw new Error(`PubMed efetch failed: ${response.status}`);
  }

  const text = await response.text();
  return parseAbstractText(text);
}

/**
 * Fetch full PMC article text for a PMID (if available in PMC OA).
 * Returns null when not available (most PMIDs don't have PMC full text).
 */
export async function fetchPmcFullText(pmid: string): Promise<string | null> {
  try {
    const url = new URL(`${PMC_FULLTEXT_BASE}/BioC_json/PMID${pmid}/ascii`);
    const response = await fetchWithTimeout(url.toString(), 15_000);
    if (!response.ok) return null;
    const text = await response.text();
    if (!text || text.length < 500) return null;
    return text;
  } catch {
    return null;
  }
}

/**
 * Fetch full-text for a batch of PMIDs. Returns map of pmid → text (only those with full text).
 * Hard-capped and parallel to avoid long sequential hangs during pack install.
 */
export async function fetchPmcFullTextBatch(
  pmids: string[],
  opts?: { max?: number; timeoutMs?: number },
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const max = opts?.max ?? 100;
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const limited = pmids.slice(0, max);
  const t0 = Date.now();

  // Parallel batches of 5 to stay under NCBI rate limits but not hang.
  const batchSize = 5;
  for (let i = 0; i < limited.length; i += batchSize) {
    if (Date.now() - t0 > timeoutMs) {
      console.warn(`[pubmed] PMC full-text batch timeout after ${Date.now() - t0}ms (${results.size}/${limited.length} fetched)`);
      break;
    }
    const batch = limited.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map(async (pmid) => {
        const text = await fetchPmcFullText(pmid);
        if (text) results.set(pmid, text);
      }),
    );
    // Log failures only for first few to avoid log spam
    const fails = settled.filter((s) => s.status === 'rejected').length;
    if (fails > 0 && i === 0) {
      console.warn(`[pubmed] PMC batch ${i}-${i + batch.length}: ${fails} failed`);
    }
    if (i + batchSize < limited.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`[pubmed] PMC full-text: ${results.size}/${limited.length} fetched in ${Date.now() - t0}ms`);
  return results;
}

/**
 * Split efetch text on article numbering. NCBI format is usually:
 *   1: Author. Title. Journal. Year…
 *   PMID: 12345
 * Handle both "1." and "1:" and blank-line variants.
 */
function splitArticles(raw: string): string[] {
  // Normalize "1:" to "1."
  const normalized = raw.replace(/^(\d+):\s*/gm, '$1. ');
  const parts = normalized.split(/\n\n\d+\.\s+/);
  if (parts.length > 1) return parts.filter((s) => s.trim().length > 0);
  // Fallback: split on double newlines and keep chunks containing PMID
  return raw
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /PMID:\s*\d+/.test(s));
}

/**
 * Parse the plain-text abstract format returned by efetch.
 * Each article is separated by blank lines; the PMID is in the first line.
 */
function parseAbstractText(raw: string): KnowledgeChunk[] {
  const now = new Date().toISOString();
  const chunks: KnowledgeChunk[] = [];

  const articles = splitArticles(raw);

  for (const article of articles) {
    // Try to extract PMID from the first line
    const pmidMatch = article.match(/PMID:\s*(\d+)/);
    if (!pmidMatch) continue;

    const pmid = pmidMatch[1];
    const docId = `PMID-${pmid}`;

    // Extract the abstract text (skip the citation header)
    const lines = article.split('\n').map((l) => l.trim()).filter(Boolean);
    const abstractStart = lines.findIndex((l) =>
      /^(Abstract|BACKGROUND|OBJECTIVE|METHODS|RESULTS|CONCLUSION|PURPOSE|AIM)/i.test(l),
    );
    const abstract = abstractStart >= 0
      ? lines.slice(abstractStart).join(' ')
      : lines.slice(1).join(' ');

    if (abstract.length < 50) continue; // skip empty/too-short abstracts

    chunks.push({
      chunkId: docId,
      source: 'pubmed',
      // Pack density: keep fuller abstracts (hot-path callers can budget).
      text: abstract.slice(0, 12_000),
      retrievedAt: now,
      useCount: 0,
      metadataJson: JSON.stringify({ pmid }),
    });
  }

  return chunks;
}

async function fetchWithTimeout(url: string, timeoutMs = TIMEOUT_MS): Promise<Response> {
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`PubMed request failed: ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }, { maxRetries: 2, baseDelayMs: 800, maxDelayMs: 4000 });
}
