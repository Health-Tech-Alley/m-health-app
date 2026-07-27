/**
 * OpenFDA client.
 *
 * Fetches adverse event reports and drug recalls. Returns KnowledgeChunk rows.
 * Adverse event chunks have a 30-day TTL (passive surveillance data changes).
 *
 * Volume policy (NLU hygiene): collapse AE rows into **one summary chunk per
 * drug** plus up to a few recall chunks — never dump 5 raw AE reports into
 * BM25.
 *
 * See planning/22_clinical-data-gathering.md §5e.
 */

import type { KnowledgeChunk } from '@/data/types';
import { getOpenFdaApiKey } from '@/services/openfda-token-store';

const OPENFDA_BASE = 'https://api.fda.gov';
const TIMEOUT_MS = 8_000;
const ADVERSE_EVENT_TTL_DAYS = 30;
/** Fetch more rows than we store so the summary can merge reaction terms. */
const AE_FETCH_LIMIT = 10;
const RECALL_LIMIT = 3;

/**
 * MedDRA reaction terms that are too blunt to lead an adverse-event chunk.
 * These get moved to a trailing "serious outcomes reported in some cases"
 * clause so the SLM grounds in common reaction types first.
 */
const SEVERE_MEDDRA_TERMS = new Set([
  'Death',
  'Sudden death',
  'Completed suicide',
  'Suicide',
  'Suicide attempt',
  'Cardiac arrest',
  'Respiratory arrest',
  'Cardio-respiratory arrest',
  'Brain death',
  'Multiple organ dysfunction syndrome',
  'Intentional overdose',
  'Overdose',
  'Poisoning',
  'Accidental overdose',
]);

function slugDrug(drugName: string): string {
  return drugName.toLowerCase().replace(/\s+/g, '-');
}

/**
 * One consolidated adverse-event summary per drug (not one chunk per report).
 */
export async function fetchAdverseEvents(drugName: string): Promise<KnowledgeChunk[]> {
  const url = new URL(`${OPENFDA_BASE}/drug/event.json`);
  url.searchParams.set('search', `patient.drug.medicinalproduct:"${drugName}"`);
  url.searchParams.set('limit', String(AE_FETCH_LIMIT));
  const apiKey = await getOpenFdaApiKey();
  if (apiKey) url.searchParams.set('api_key', apiKey);

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`OpenFDA adverse events failed: ${response.status}`);
  }

  const json = await response.json();
  const results = json?.results ?? [];
  if (results.length === 0) return [];

  const reactionCounts = new Map<string, number>();
  for (const event of results) {
    const patient = event?.patient ?? {};
    const reactions = (patient?.reaction ?? [])
      .map((r: { reactionmeddrapt?: string }) => r?.reactionmeddrapt)
      .filter(Boolean) as string[];
    for (const r of reactions) {
      reactionCounts.set(r, (reactionCounts.get(r) ?? 0) + 1);
    }
  }

  const ranked = [...reactionCounts.entries()].sort((a, b) => b[1] - a[1]);
  const common = ranked
    .map(([r]) => r)
    .filter((r) => !SEVERE_MEDDRA_TERMS.has(r))
    .slice(0, 12);
  const severe = ranked
    .map(([r]) => r)
    .filter((r) => SEVERE_MEDDRA_TERMS.has(r))
    .slice(0, 6);

  const reactionParts: string[] = [];
  if (common.length > 0) {
    reactionParts.push(
      `Most commonly reported reaction types (passive surveillance, not incidence rates): ${common.join(', ')}.`,
    );
  }
  if (severe.length > 0) {
    reactionParts.push(
      `Serious outcomes also appear in some spontaneous reports: ${severe.join(', ')}.`,
    );
  }
  if (reactionParts.length === 0) {
    reactionParts.push('Reaction types were not specified in the sampled reports.');
  }

  const text = [
    `Adverse event summary for ${drugName} (FDA FAERS passive surveillance — spontaneous reports, not incidence rates).`,
    `Based on ${results.length} recent report(s) in this query sample.`,
    ...reactionParts,
    'Discuss new or worsening symptoms with the care team; do not stop prescribed medicines without clinician guidance.',
  ].join(' ');

  const now = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + ADVERSE_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  return [
    {
      chunkId: `OPENFDA-AE-${slugDrug(drugName)}-summary`,
      source: 'openfda',
      text: text.slice(0, 1500),
      retrievedAt: now,
      expiresAt,
      useCount: 0,
      conditions: drugName,
      metadataJson: JSON.stringify({
        drugName,
        kind: 'ae_summary',
        sampleSize: results.length,
      }),
    },
  ];
}

export async function fetchDrugRecalls(drugName: string): Promise<KnowledgeChunk[]> {
  const url = new URL(`${OPENFDA_BASE}/drug/enforcement.json`);
  url.searchParams.set('search', `product_description:"${drugName}"`);
  url.searchParams.set('limit', String(RECALL_LIMIT));
  const apiKey = await getOpenFdaApiKey();
  if (apiKey) url.searchParams.set('api_key', apiKey);

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`OpenFDA recalls failed: ${response.status}`);
  }

  const json = await response.json();
  const now = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + ADVERSE_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const chunks: KnowledgeChunk[] = [];

  const results = json?.results ?? [];
  for (let i = 0; i < results.length; i++) {
    const recall = results[i];
    const text = [
      `Drug recall: ${recall?.product_description ?? drugName}.`,
      `Reason: ${recall?.reason_for_recall ?? 'not specified'}.`,
      `Classification: ${recall?.classification ?? 'unknown'}.`,
      `Status: ${recall?.status ?? 'unknown'}.`,
      `Recall date: ${recall?.recall_initiation_date ?? 'unknown'}.`,
    ].join(' ');

    if (text.length < 30) continue;

    chunks.push({
      chunkId: `OPENFDA-RECALL-${slugDrug(drugName)}-${i}`,
      source: 'openfda',
      text: text.slice(0, 1500),
      retrievedAt: now,
      expiresAt,
      useCount: 0,
      conditions: drugName,
      metadataJson: JSON.stringify({ drugName, index: i, kind: 'recall' }),
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
