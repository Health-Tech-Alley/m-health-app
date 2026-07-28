/**
 * MedlinePlus Connect client.
 *
 * Fetches consumer-friendly health topic summaries by ICD-10 or SNOMED CT
 * code, and drug information by drug name. Returns KnowledgeChunk rows
 * ready for the knowledge_cache table.
 *
 * Response shape (Atom JSON): feed.entry[].title._value / summary._value (HTML).
 */

import type { KnowledgeChunk } from '@/data/types';

const MLP_BASE = 'https://connect.medlineplus.gov/service';
const TIMEOUT_MS = 12_000;

const ICD10_OID = '2.16.840.1.113883.6.90';
const SNOMED_OID = '2.16.840.1.113883.6.96';

function atomText(field: unknown): string {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object') {
    const o = field as Record<string, unknown>;
    if (typeof o._value === 'string') return o._value;
    if (typeof o.value === 'string') return o.value;
  }
  return '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function entriesFromResponse(json: unknown): unknown[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  // Live API: { feed: { entry: [...] } }
  const feed = root.feed as Record<string, unknown> | undefined;
  if (feed && Array.isArray(feed.entry)) return feed.entry;
  // Legacy / tests: { entry: [...] }
  if (Array.isArray(root.entry)) return root.entry;
  return [];
}

function entryLink(entry: Record<string, unknown>): string {
  const link = entry.link;
  if (Array.isArray(link) && link[0] && typeof link[0] === 'object') {
    const href = (link[0] as { href?: string }).href;
    if (typeof href === 'string') return href;
  }
  return '';
}

function parseTopicEntries(
  entries: unknown[],
  opts: { code?: string; codeSystem?: string; drugName?: string; idPrefix: string },
): KnowledgeChunk[] {
  const now = new Date().toISOString();
  const chunks: KnowledgeChunk[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const title = atomText(e.title) || opts.drugName || opts.code || 'MedlinePlus topic';
    const rawSummary = atomText(e.summary);
    const summary = stripHtml(rawSummary);
    if (!summary || summary.length < 40) continue;

    const href = entryLink(e);
    const slug = (opts.drugName ?? opts.code ?? 'topic')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const docId =
      entries.length === 1
        ? `${opts.idPrefix}-${slug}`
        : `${opts.idPrefix}-${slug}-${i + 1}`;

    chunks.push({
      chunkId: docId,
      source: 'medlineplus',
      text: `${title}. ${summary}`.slice(0, 4000),
      retrievedAt: now,
      useCount: 0,
      documentType: 'synthetic',
      lengthTier: 'medium',
      externalId: docId,
      metadataJson: JSON.stringify({
        code: opts.code,
        codeSystem: opts.codeSystem,
        drugName: opts.drugName,
        title,
        url: href,
      }),
    });
  }

  const seen = new Set<string>();
  return chunks.filter((c) => {
    if (seen.has(c.chunkId)) return false;
    seen.add(c.chunkId);
    return true;
  });
}

export async function fetchHealthTopic(params: {
  code: string;
  codeSystem?: 'icd10' | 'snomed';
}): Promise<KnowledgeChunk[]> {
  const { code, codeSystem = 'icd10' } = params;
  const oid = codeSystem === 'icd10' ? ICD10_OID : SNOMED_OID;

  const url = new URL(MLP_BASE);
  url.searchParams.set('mainSearchCriteria.v.cs', oid);
  url.searchParams.set('mainSearchCriteria.v.c', code);
  url.searchParams.set('knowledgeResponseType', 'application/json');

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    throw new Error(`MedlinePlus Connect failed: ${response.status}`);
  }

  const json = await response.json();
  return parseTopicEntries(entriesFromResponse(json), {
    code,
    codeSystem,
    idPrefix: 'MLP',
  });
}

export async function fetchDrugInfo(drugName: string): Promise<KnowledgeChunk[]> {
  const url = new URL(MLP_BASE);
  url.searchParams.set('mainSearchCriteria.v.dn', drugName);
  url.searchParams.set('knowledgeResponseType', 'application/json');

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    throw new Error(`MedlinePlus drug info failed: ${response.status}`);
  }

  const json = await response.json();
  return parseTopicEntries(entriesFromResponse(json), {
    drugName,
    idPrefix: 'MLP-DRUG',
  });
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
