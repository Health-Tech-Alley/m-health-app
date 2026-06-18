/**
 * OpenFDA client.
 *
 * Fetches adverse event reports and drug recalls. Returns KnowledgeChunk rows.
 * Adverse event chunks have a 30-day TTL (passive surveillance data changes).
 *
 * See planning/22_clinical-data-gathering.md §5e.
 */

import type { KnowledgeChunk } from '@/data/types';
import { getOpenFdaApiKey } from '@/services/openfda-token-store';

const OPENFDA_BASE = 'https://api.fda.gov';
const TIMEOUT_MS = 15_000;
const ADVERSE_EVENT_TTL_DAYS = 30;

export async function fetchAdverseEvents(drugName: string): Promise<KnowledgeChunk[]> {
  const url = new URL(`${OPENFDA_BASE}/drug/event.json`);
  url.searchParams.set('search', `patient.drug.medicinalproduct:"${drugName}"`);
  url.searchParams.set('limit', '5');
  const apiKey = await getOpenFdaApiKey();
  if (apiKey) url.searchParams.set('api_key', apiKey);

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    if (response.status === 404) return []; // no results
    throw new Error(`OpenFDA adverse events failed: ${response.status}`);
  }

  const json = await response.json();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ADVERSE_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const chunks: KnowledgeChunk[] = [];

  const results = json?.results ?? [];
  for (let i = 0; i < results.length; i++) {
    const event = results[i];
    const patient = event?.patient ?? {};
    const reactions = (patient?.reaction ?? []).map((r: any) => r?.reactionmeddrapt).filter(Boolean);
    const drugs = (patient?.drug ?? []).map((d: any) => d?.medicinalproduct).filter(Boolean);

    const text = [
      `Adverse event report for ${drugName}.`,
      `Reactions: ${reactions.join(', ') || 'not specified'}.`,
      `Drugs involved: ${drugs.join(', ') || 'not specified'}.`,
      `Received date: ${event?.receivedate ?? 'unknown'}.`,
    ].join(' ');

    if (text.length < 30) continue;

    const docId = `OPENFDA-AE-${drugName.toLowerCase().replace(/\s+/g, '-')}-${i}`;
    chunks.push({
      chunkId: docId,
      source: 'openfda',
      text: text.slice(0, 1500),
      retrievedAt: now,
      expiresAt,
      useCount: 0,
      metadataJson: JSON.stringify({ drugName, index: i }),
    });
  }

  return chunks;
}

export async function fetchDrugRecalls(drugName: string): Promise<KnowledgeChunk[]> {
  const url = new URL(`${OPENFDA_BASE}/drug/enforcement.json`);
  url.searchParams.set('search', `product_description:"${drugName}"`);
  url.searchParams.set('limit', '5');
  const apiKey = await getOpenFdaApiKey();
  if (apiKey) url.searchParams.set('api_key', apiKey);

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    if (response.status === 404) return []; // no results
    throw new Error(`OpenFDA recalls failed: ${response.status}`);
  }

  const json = await response.json();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ADVERSE_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
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

    const docId = `OPENFDA-RECALL-${drugName.toLowerCase().replace(/\s+/g, '-')}-${i}`;
    chunks.push({
      chunkId: docId,
      source: 'openfda',
      text: text.slice(0, 1500),
      retrievedAt: now,
      expiresAt,
      useCount: 0,
      metadataJson: JSON.stringify({ drugName, index: i }),
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
