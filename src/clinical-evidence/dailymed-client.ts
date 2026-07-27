/**
 * DailyMed client.
 *
 * Two-step fetch:
 *   1. Search `/spls.json?drug_name=X` → get setids (metadata only)
 *   2. Fetch `/spls/{setid}.xml` → full SPL XML → extract sections
 *
 * Upstream DailyMed is flaky under load (intermittent 5xx / HTML error pages).
 * This client normalizes noisy medication strings, retries transient failures,
 * and soft-fails to `[]` so profile switches never surface redbox errors.
 *
 * See planning/22_clinical-data-gathering.md §5d.
 */

import type { KnowledgeChunk } from '@/data/types';
import { extractSectionsFromSplXml, buildDrugLabelText } from './dailymed-spl-parser';
import { sleep, withRetry } from './rate-limiter';

const DAILYMED_BASE = 'https://dailymed.nlm.nih.gov/dailymed/services/v2';
/** Keep short — DailyMed is flaky; fail fast and soft-skip rather than hang the bundle. */
const TIMEOUT_MS = 6_000;
const FETCH_DELAY_MS = 200;
/** One label is enough for med safety context; second SPL doubled hang time. */
const MAX_SETIDS = 1;

/**
 * Reduce free-text medication labels to a DailyMed-friendly query.
 * "Albuterol 90mcg inhaler PRN" → "Albuterol"
 * "diazePAM (VALIUM) 2 MG tablet" → "diazepam"
 * "cholecalciferol / Vitamin D3 tablet" → "cholecalciferol"
 */
export function normalizeDailyMedDrugQuery(drugName: string): string {
  let s = drugName.trim();
  if (!s) return drugName;

  // Drop parenthetical brand aliases first.
  s = s.replace(/\([^)]*\)/g, ' ');
  // Prefer the token before a slash when both sides look like names.
  if (s.includes('/')) {
    const [left] = s.split('/');
    if (left.trim().split(/\s+/).length <= 3) {
      s = left;
    }
  }

  s = s
    .replace(/\b\d+(\.\d+)?\s*(mg|mcg|µg|ug|g|ml|mL|%|iu|units?)\b[^\s,]*/gi, ' ')
    .replace(/\b\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?\s*(hr|h|hour|day)\b/gi, ' ')
    .replace(
      /\b(tablet|tablets|capsule|capsules|inhaler|patch|ointment|cream|powder|solution|suspension|injection|oral|topical|nasal|extended[-\s]?release|delayed[-\s]?release|immediate[-\s]?release|er|xr|sr|cr|dr|prn|daily|twice|once|bid|tid|qid|qhs|qam|as needed|with food|by mouth)\b/gi,
      ' ',
    )
    .replace(/[,;:+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = s.split(' ').filter(Boolean);
  if (parts.length === 0) {
    return drugName.trim().split(/\s+/)[0] ?? drugName.trim();
  }
  // Generic name is almost always the first 1–2 tokens.
  return parts.slice(0, Math.min(2, parts.length)).join(' ');
}

export async function fetchDrugLabel(drugName: string, fullSpl = false): Promise<KnowledgeChunk[]> {
  const query = normalizeDailyMedDrugQuery(drugName);
  if (!query) return [];

  // Step 1: Search for setids (soft-fail on upstream 5xx / empty / HTML).
  const searchUrl = new URL(`${DAILYMED_BASE}/spls.json`);
  searchUrl.searchParams.set('drug_name', query);
  searchUrl.searchParams.set('pagesize', '3');

  const searchResponse = await fetchDailyMed(searchUrl.toString(), 'search');
  if (!searchResponse) return [];

  let searchJson: { data?: Array<{ setid?: string; title?: string }> };
  try {
    searchJson = (await searchResponse.json()) as typeof searchJson;
  } catch {
    console.warn(`[dailymed] Non-JSON search response for "${query}"`);
    return [];
  }

  const spls = Array.isArray(searchJson?.data) ? searchJson.data : [];
  if (spls.length === 0) {
    // Retry once with the first token only when the normalized query was multi-word.
    const first = query.split(/\s+/)[0];
    if (first && first.toLowerCase() !== query.toLowerCase()) {
      return fetchDrugLabel(first, fullSpl);
    }
    return [];
  }

  const now = new Date().toISOString();
  const chunks: KnowledgeChunk[] = [];
  const setidsToFetch = spls
    .slice(0, MAX_SETIDS)
    .map((s) => s.setid)
    .filter((id): id is string => Boolean(id));

  for (let i = 0; i < setidsToFetch.length; i++) {
    const setId = setidsToFetch[i];
    if (i > 0) {
      await sleep(FETCH_DELAY_MS);
    }

    try {
      const xmlUrl = `${DAILYMED_BASE}/spls/${setId}.xml`;
      const xmlResponse = await fetchDailyMed(xmlUrl, 'spl');
      if (!xmlResponse) continue;

      const xmlText = await xmlResponse.text();
      // Upstream sometimes returns an HTML error page with a 200.
      if (!xmlText.includes('<') || /something went wrong|Web application could not be started/i.test(xmlText)) {
        console.warn(`[dailymed] Bad SPL payload for setid ${setId}`);
        continue;
      }

      const sections = extractSectionsFromSplXml(xmlText);
      if (sections.size === 0) continue;

      const spl = spls.find((s) => s.setid === setId);
      const title = spl?.title ?? drugName;

      if (fullSpl) {
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
            metadataJson: JSON.stringify({
              drugName,
              query,
              setId,
              title,
              section: section.heading,
            }),
          });
        }
      } else {
        const combinedText = buildDrugLabelText(title, sections);
        if (combinedText.length < 100) continue;

        chunks.push({
          chunkId: `DAILYMED-${setId}`,
          source: 'dailymed',
          text: combinedText.slice(0, 8000),
          retrievedAt: now,
          useCount: 0,
          metadataJson: JSON.stringify({ drugName, query, setId, title, fullSpl }),
        });
      }
    } catch (err) {
      console.warn(
        `[dailymed] SPL fetch skipped for setid ${setId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return chunks;
}

/**
 * Fetch DailyMed with timeout + retries on transient failures.
 * Returns null on exhausted retries / non-OK so callers can soft-fail.
 */
async function fetchDailyMed(
  url: string,
  kind: 'search' | 'spl',
): Promise<Response | null> {
  try {
      const result = await withRetry(
      async (): Promise<Response | 'soft-fail'> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              Accept:
                kind === 'search' ? 'application/json' : 'application/xml,text/xml,*/*',
            },
          });
          if (response.ok) return response;

          const status = response.status;
          // Retryable upstream / rate-limit statuses.
          if (status === 429 || status >= 500) {
            throw new DailyMedTransientError(status, kind);
          }
          // Other 4xx: not retryable — soft-fail.
          console.warn(`[dailymed] ${kind} HTTP ${status}`);
          return 'soft-fail';
        } finally {
          clearTimeout(timer);
        }
      },
      // One quick 5xx retry only — never stack timeouts (was hanging profile load).
      { maxRetries: 1, baseDelayMs: 400, maxDelayMs: 1_200 },
    );
    return result === 'soft-fail' ? null : result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[dailymed] ${kind} unavailable: ${msg}`);
    return null;
  }
}

class DailyMedTransientError extends Error {
  readonly status: number;
  constructor(status: number, kind: string) {
    super(`DailyMed ${kind} failed: ${status}`);
    this.name = 'DailyMedTransientError';
    this.status = status;
  }
}
