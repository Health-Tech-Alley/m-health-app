/**
 * MedlinePlus Connect client.
 *
 * Fetches consumer-friendly health topic summaries by ICD-10 or SNOMED CT
 * code, and drug information by drug name. Returns KnowledgeChunk rows
 * ready for the knowledge_cache table.
 *
 * See planning/22_clinical-data-gathering.md §5b.
 */

import type { KnowledgeChunk } from '@/data/types';

const MLP_BASE = 'https://connect.medlineplus.gov/service';
const TIMEOUT_MS = 15_000;

const ICD10_OID = '2.16.840.1.113883.6.90';
const SNOMED_OID = '2.16.840.1.113883.6.96';

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
  const now = new Date().toISOString();
  const chunks: KnowledgeChunk[] = [];

  const entries = json?.entry ?? [];
  for (const entry of entries) {
    const title = entry?.title ?? '';
    const summary = entry?.summary ?? '';
    const url = entry?.link?.[0]?.href ?? '';

    if (!summary || summary.length < 50) continue;

    const docId = `MLP-${code}`;
    chunks.push({
      chunkId: docId,
      source: 'medlineplus',
      text: `${title}. ${summary}`.slice(0, 2000),
      retrievedAt: now,
      useCount: 0,
      metadataJson: JSON.stringify({ code, codeSystem, title, url }),
    });
  }

  // Deduplicate by docId (MedlinePlus may return multiple entries for the same code)
  const seen = new Set<string>();
  return chunks.filter((c) => {
    if (seen.has(c.chunkId)) return false;
    seen.add(c.chunkId);
    return true;
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
  const now = new Date().toISOString();
  const chunks: KnowledgeChunk[] = [];

  const entries = json?.entry ?? [];
  for (const entry of entries) {
    const title = entry?.title ?? drugName;
    const summary = entry?.summary ?? '';

    if (!summary || summary.length < 50) continue;

    const docId = `MLP-DRUG-${drugName.toLowerCase().replace(/\s+/g, '-')}`;
    chunks.push({
      chunkId: docId,
      source: 'medlineplus',
      text: `${title}. ${summary}`.slice(0, 2000),
      retrievedAt: now,
      useCount: 0,
      metadataJson: JSON.stringify({ drugName, title }),
    });
  }

  return chunks;
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
