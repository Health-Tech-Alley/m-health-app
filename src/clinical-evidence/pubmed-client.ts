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
const TIMEOUT_MS = 15_000;

export interface PubMedSearchResult {
  pmids: string[];
  query: string;
}

/**
 * Search PubMed for abstracts matching a de-identified query.
 * Returns a list of PMIDs.
 */
export async function searchPubMed(params: {
  query: string;
  retmax?: number;
}): Promise<PubMedSearchResult> {
  const { query, retmax = 20 } = params;
  const apiKey = await getNcbiApiKey();

  const url = new URL(`${EUTILS_BASE}/esearch.fcgi`);
  url.searchParams.set('db', 'pubmed');
  url.searchParams.set('term', query);
  url.searchParams.set('retmax', String(retmax));
  url.searchParams.set('retmode', 'json');
  url.searchParams.set('sort', 'relevance');
  if (apiKey) url.searchParams.set('api_key', apiKey);

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
 * Parse the plain-text abstract format returned by efetch.
 * Each article is separated by blank lines; the PMID is in the first line.
 */
function parseAbstractText(raw: string): KnowledgeChunk[] {
  const now = new Date().toISOString();
  const chunks: KnowledgeChunk[] = [];

  // Split on "1. " style article numbering or double-newline boundaries
  const articles = raw.split(/\n\n\d+\.\s+/).filter((s) => s.trim().length > 0);

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
      text: abstract.slice(0, 2000), // cap at 2000 chars for BM25 index size
      retrievedAt: now,
      useCount: 0,
      metadataJson: JSON.stringify({ pmid }),
    });
  }

  return chunks;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`PubMed request failed: ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }, { maxRetries: 4, baseDelayMs: 1500, maxDelayMs: 12000 });
}
