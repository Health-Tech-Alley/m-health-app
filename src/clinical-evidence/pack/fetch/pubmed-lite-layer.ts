/**
 * lit_lite — dense PubMed abstract corpus (default ON).
 * Primary literature density driver alongside full DailyMed SPLs.
 */

import {
  fetchAbstracts,
  fetchPmcFullTextBatch,
  searchPubMed,
} from '@/clinical-evidence/pubmed-client';
import { buildPubMedQuery, deidentifyQuery } from '@/clinical-evidence/deidentify';
import { isFixtureMode } from '@/clinical-evidence/fixture-mode';
import type { KnowledgeChunk } from '@/data/types';

import {
  LIT_FULLTEXT_TOP_N,
  LIT_LAYER_BUDGET_MS,
  LIT_LITE_MAX_CHUNKS,
  LIT_LITE_MAX_QUERIES,
  LIT_LITE_RETMAX,
} from '../catalog';
import { knowledgeChunksToPackRows } from '../normalize/chunk-builder';
import { mergeConditionSeeds, PACK_LIT_EXTRA_QUERIES } from '../pack-seeds';
import type { PackChunkRow } from '../types';

const VERSION = '2.0.0';

const FALLBACK_ABSTRACTS: { id: string; condition: string; text: string }[] = [
  {
    id: 'PMID-PACK-CP-1',
    condition: 'cerebral palsy',
    text: 'Home monitoring in severe cerebral palsy (digest abstract). Caregivers of GMFCS IV–V children report value from structured vital thresholds and clear escalation paths when SpO2 or work of breathing changes from baseline.',
  },
  {
    id: 'PMID-PACK-COPD-1',
    condition: 'copd',
    text: 'COPD exacerbation recognition at home (digest abstract). Increased dyspnea, sputum change, and desaturation relative to personal baseline predict need for clinical contact.',
  },
  {
    id: 'PMID-PACK-TBI-1',
    condition: 'tbi',
    text: 'Caregiver education after moderate-severe TBI (digest abstract). Tracking sleep, mood, headaches, and new neurologic deficits supports safer recovery.',
  },
  {
    id: 'PMID-PACK-SB-1',
    condition: 'spina bifida',
    text: 'Spina bifida home surveillance (digest abstract). Bladder/bowel programs, skin checks, and shunt warning education reduce preventable complications.',
  },
  {
    id: 'PMID-PACK-STROKE-1',
    condition: 'stroke',
    text: 'Post-stroke home recovery (digest abstract). FAST recognition, fall prevention, and therapy continuity improve outcomes.',
  },
  {
    id: 'PMID-PACK-EPI-1',
    condition: 'epilepsy',
    text: 'Epilepsy rescue planning at home (digest abstract). Written seizure action plans and clear 911 criteria reduce injury.',
  },
  {
    id: 'PMID-PACK-ASP-1',
    condition: 'dysphagia',
    text: 'Aspiration risk in complex disability (digest abstract). Texture modification and upright feeding are core caregiver skills.',
  },
  {
    id: 'PMID-PACK-PRESSURE-1',
    condition: 'pressure injury',
    text: 'Pressure injury prevention in wheelchair users (digest abstract). Scheduled repositioning and cushion checks reduce deep tissue injury.',
  },
];

function litQueries(conditions: string[]): string[] {
  const seeds = [
    ...mergeConditionSeeds(conditions),
    ...PACK_LIT_EXTRA_QUERIES,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of seeds) {
    if (out.length >= LIT_LITE_MAX_QUERIES) break;
    const q = buildPubMedQuery(deidentifyQuery(c), { caregiverFocus: true });
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

function fallbackChunks(): KnowledgeChunk[] {
  const now = new Date().toISOString();
  return FALLBACK_ABSTRACTS.map((f) => ({
    chunkId: f.id,
    externalId: f.id,
    source: 'pubmed' as const,
    text: `${f.text} Guidance only. Source: pack lit_lite offline abstract.`,
    conditions: f.condition,
    retrievedAt: now,
    useCount: 0,
    documentType: 'abstract' as const,
    lengthTier: 'medium' as const,
  }));
}

export type LitLiteProgress = {
  done: number;
  total: number;
  chunks: number;
};

export async function fetchLitLiteLayer(
  conditions: string[],
  opts?: {
    onProgress?: (p: LitLiteProgress) => void;
    signal?: { cancelled: boolean };
  },
): Promise<{
  version: string;
  rows: Omit<PackChunkRow, 'packLayer' | 'packVersion' | 'contentHash' | 'retrievedAt'>[];
}> {
  const chunks: KnowledgeChunk[] = [];
  const seenPmids = new Set<string>();
  const live = !isFixtureMode();
  let queriesOk = 0;
  let queriesFail = 0;
  const t0 = Date.now();

  if (live) {
    const queries = litQueries(conditions);
    let done = 0;
    const report = () =>
      opts?.onProgress?.({ done, total: queries.length, chunks: chunks.length });
    report();
    for (const q of queries) {
      if (opts?.signal?.cancelled) break;
      if (chunks.length >= LIT_LITE_MAX_CHUNKS) break;
      if (Date.now() - t0 > LIT_LAYER_BUDGET_MS) {
        console.warn(
          `[pack/lit_lite] Budget ${LIT_LAYER_BUDGET_MS}ms hit with ${chunks.length} chunks; stopping`,
        );
        break;
      }
      try {
        const { pmids } = await searchPubMed({
          query: q,
          retmax: LIT_LITE_RETMAX,
        });
        const unique = pmids.filter((p) => {
          if (seenPmids.has(p)) return false;
          seenPmids.add(p);
          return true;
        });
        if (unique.length === 0) {
          queriesFail += 1;
          done += 1;
          report();
          continue;
        }
        const batch = unique.slice(0, LIT_LITE_RETMAX);
        // efetch in batches of 40 to keep payloads manageable
        for (let i = 0; i < batch.length; i += 40) {
          if (opts?.signal?.cancelled) break;
          if (Date.now() - t0 > LIT_LAYER_BUDGET_MS) break;
          const slice = batch.slice(i, i + 40);
          const abstracts = await fetchAbstracts(slice);
          queriesOk += 1;
          for (const a of abstracts) {
            if (chunks.length >= LIT_LITE_MAX_CHUNKS) break;
            chunks.push({
              ...a,
              externalId: a.chunkId,
              documentType: a.documentType ?? 'abstract',
              lengthTier: a.lengthTier ?? 'medium',
              conditions: conditions.join(',') || undefined,
            });
          }
        }
      } catch (err) {
        queriesFail += 1;
        console.warn(
          `[pack/lit_lite] Query failed:`,
          err instanceof Error ? err.message : err,
        );
      }
      done += 1;
      report();
    }
  }

  if (chunks.length < 8) {
    console.warn(
      `[pack/lit_lite] Thin live set (${chunks.length}); merging offline digests. live=${live}`,
    );
    chunks.push(...fallbackChunks());
  }

  // Fetch full PMC text for top-ranked abstracts (if time allows).
  // Skip PMC fetch if budget is tight — abstracts alone provide most value.
  let fullTextCount = 0;
  const remainingBudget = LIT_LAYER_BUDGET_MS - (Date.now() - t0);
  if (live && chunks.length > 0 && remainingBudget > 30_000) {
    const topPmids = chunks
      .filter((c) => c.metadataJson?.includes('pmid'))
      .slice(0, LIT_FULLTEXT_TOP_N)
      .map((c) => JSON.parse(c.metadataJson ?? '{}').pmid as string)
      .filter(Boolean);
    if (topPmids.length > 0) {
      console.log(`[pack/lit_lite] Fetching PMC full text for ${topPmids.length} top articles…`);
      const fullTexts = await fetchPmcFullTextBatch(topPmids, {
        max: 100,
        timeoutMs: 60_000,
      });
      for (const chunk of chunks) {
        const pmid = JSON.parse(chunk.metadataJson ?? '{}').pmid as string | undefined;
        if (pmid && fullTexts.has(pmid)) {
          chunk.text = fullTexts.get(pmid)!.slice(0, 50_000); // Cap full text at 50k
          chunk.documentType = 'fulltext';
          chunk.lengthTier = 'long';
          fullTextCount++;
        }
      }
    }
  }

  const chars = chunks.reduce((n, c) => n + c.text.length, 0);
  console.log(
    `[pack/lit_lite] chunks=${chunks.length} chars≈${chars} live=${live} ` +
      `queriesOk=${queriesOk} queriesFail=${queriesFail} fullText=${fullTextCount}`,
  );

  return {
    version: VERSION,
    rows: knowledgeChunksToPackRows(chunks, 'lit_lite', VERSION),
  };
}
