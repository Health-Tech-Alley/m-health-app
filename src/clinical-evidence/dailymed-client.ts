/**
 * DailyMed client.
 *
 * Two-step fetch:
 *   1. Search `/spls.json?drug_name=X` → get setids (metadata only)
 *   2. Fetch `/spls/{setid}` → full SPL XML → extract sections
 *
 * The search endpoint returns only metadata (setid, title, version). The full
 * drug label content (indications, warnings, dosage, adverse reactions) is
 * only available via the per-setid XML endpoint.
 *
 * See planning/22_clinical-data-gathering.md §5d.
 */

import type { KnowledgeChunk } from '@/data/types';
import { extractSectionsFromSplXml, buildDrugLabelText } from './dailymed-spl-parser';
import { withRetry } from './rate-limiter';

const DAILYMED_BASE = 'https://dailymed.nlm.nih.gov/dailymed/services/v2';
const TIMEOUT_MS = 15_000;
const FETCH_DELAY_MS = 600;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchDrugLabel(drugName: string, fullSpl = false): Promise<KnowledgeChunk[]> {
  // Step 1: Search for setids
  const searchUrl = new URL(`${DAILYMED_BASE}/spls.json`);
  searchUrl.searchParams.set('drug_name', drugName);
  searchUrl.searchParams.set('pagesize', '3');

  const searchResponse = await fetchWithTimeout(searchUrl.toString());
  if (!searchResponse.ok) {
    throw new Error(`DailyMed search failed: ${searchResponse.status}`);
  }

  const searchJson = await searchResponse.json();
  const spls = searchJson?.data ?? [];
  if (spls.length === 0) return [];

  const now = new Date().toISOString();
  const chunks: KnowledgeChunk[] = [];

  // Step 2: Fetch full SPL XML for top 1-2 results
  const setidsToFetch = spls.slice(0, 2).map((s: any) => s.setid).filter(Boolean);

  for (let i = 0; i < setidsToFetch.length; i++) {
    const setId = setidsToFetch[i];
    
    // Throttle between XML fetches to avoid overwhelming the API
    if (i > 0) {
      await delay(FETCH_DELAY_MS);
    }

    try {
      const xmlUrl = `${DAILYMED_BASE}/spls/${setId}.xml`;
      const xmlResponse = await fetchWithTimeout(xmlUrl);
      if (!xmlResponse.ok) continue;

      const xmlText = await xmlResponse.text();
      const sections = extractSectionsFromSplXml(xmlText);

      if (sections.size === 0) continue;

      // Find the title from the search results
      const spl = spls.find((s: any) => s.setid === setId);
      const title = spl?.title ?? drugName;

      if (fullSpl) {
        // Emit one chunk per section (deep mode)
        for (const [code, section] of sections) {
          chunks.push({
            chunkId: `DAILYMED-${setId}-${code}`,
            source: 'dailymed',
            text: `${section.heading}\n\n${section.text}`.slice(0, 6000),
            retrievedAt: now,
            useCount: 0,
            documentType: 'spl_full',
            lengthTier: 'long',
            sectionHeading: section.heading,
            metadataJson: JSON.stringify({ drugName, setId, title, section: section.heading }),
          });
        }
      } else {
        // Combine all sections into one chunk (default mode)
        const combinedText = buildDrugLabelText(title, sections);
        if (combinedText.length < 100) continue;

        chunks.push({
          chunkId: `DAILYMED-${setId}`,
          source: 'dailymed',
          text: combinedText.slice(0, 8000),
          retrievedAt: now,
          useCount: 0,
          metadataJson: JSON.stringify({ drugName, setId, title, fullSpl }),
        });
      }
    } catch (err) {
      console.error(`[dailymed] Failed to fetch SPL XML for setid ${setId}:`, err);
    }
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
        throw new Error(`DailyMed request failed: ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }, { maxRetries: 2, baseDelayMs: 1500, maxDelayMs: 8000 });
}
