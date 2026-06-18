/**
 * DailyMed client.
 *
 * Fetches FDA-approved drug labels (package inserts): dosage, administration,
 * warnings, contraindications. Returns KnowledgeChunk rows.
 *
 * See planning/22_clinical-data-gathering.md §5d.
 */

import type { KnowledgeChunk } from '@/data/types';

const DAILYMED_BASE = 'https://dailymed.nlm.nih.gov/dailymed/services/v2';
const TIMEOUT_MS = 15_000;

export async function fetchDrugLabel(drugName: string): Promise<KnowledgeChunk[]> {
  const url = new URL(`${DAILYMED_BASE}/spls.json`);
  url.searchParams.set('drug_name', drugName);
  url.searchParams.set('pagesize', '5');

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    throw new Error(`DailyMed failed: ${response.status}`);
  }

  const json = await response.json();
  const now = new Date().toISOString();
  const chunks: KnowledgeChunk[] = [];

  const spls = json?.data ?? [];
  for (const spl of spls) {
    const title = spl?.title ?? drugName;
    const setId = spl?.setid ?? '';
    if (!setId) continue;

    // Extract text from the structured fields if available
    const sections = spl?.spl_sections ?? [];
    let text = title;
    for (const section of sections) {
      const sectionName = section?.name ?? '';
      const sectionText = section?.text ?? '';
      if (sectionText) {
        text += `\n\n${sectionName}: ${sectionText}`;
      }
    }

    if (text.length < 50) continue;

    const docId = `DAILYMED-${setId}`;
    chunks.push({
      chunkId: docId,
      source: 'dailymed',
      text: text.slice(0, 3000), // cap for BM25 index
      retrievedAt: now,
      useCount: 0,
      metadataJson: JSON.stringify({ drugName, setId, title }),
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
