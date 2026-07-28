/**
 * openfda layer — adverse-event summaries + recalls for active patient meds.
 */

import { fetchAdverseEvents, fetchDrugRecalls } from '@/clinical-evidence/openfda-client';
import { isFixtureMode } from '@/clinical-evidence/fixture-mode';
import type { KnowledgeChunk } from '@/data/types';

import { OPENFDA_LAYER_BUDGET_MS, OPENFDA_MAX_DRUGS } from '../catalog';
import { knowledgeChunksToPackRows } from '../normalize/chunk-builder';
import { mergeMedicationSeeds } from '../pack-seeds';
import type { PackChunkRow } from '../types';

const VERSION = '2.0.0';

export async function fetchOpenFdaLayer(medications: string[]): Promise<{
  version: string;
  rows: Omit<PackChunkRow, 'packLayer' | 'packVersion' | 'contentHash' | 'retrievedAt'>[];
}> {
  const names = mergeMedicationSeeds(medications).slice(0, OPENFDA_MAX_DRUGS);
  const chunks: KnowledgeChunk[] = [];
  const live = !isFixtureMode();
  let ok = 0;
  let fail = 0;

  if (live) {
    const t0 = Date.now();
    for (const name of names) {
      if (Date.now() - t0 > OPENFDA_LAYER_BUDGET_MS) {
        console.warn(
          `[pack/openfda] Budget ${OPENFDA_LAYER_BUDGET_MS}ms hit after ${ok + fail} drugs; stopping`,
        );
        break;
      }
      try {
        const [aes, recalls] = await Promise.all([
          fetchAdverseEvents(name),
          fetchDrugRecalls(name),
        ]);
        const got = [...aes, ...recalls];
        if (got.length === 0) {
          fail += 1;
          continue;
        }
        ok += 1;
        for (const c of got) {
          chunks.push({
            ...c,
            conditions: name.toLowerCase(),
            externalId: c.chunkId,
            documentType: c.documentType ?? 'synthetic',
            lengthTier: c.lengthTier ?? 'medium',
          });
        }
      } catch (err) {
        fail += 1;
        console.warn(
          `[pack/openfda] fail ${name}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  if (chunks.length === 0 && names.length > 0) {
    const now = new Date().toISOString();
    for (const name of names) {
      chunks.push({
        chunkId: `OPENFDA-FALLBACK-${name.replace(/\s+/g, '-')}`,
        externalId: `OPENFDA-FALLBACK-${name}`,
        source: 'openfda',
        text: `Drug safety note for ${name}. Review the full label and discuss new or worsening symptoms with the care team. Do not stop prescribed medicines without clinician guidance. Offline pack placeholder when OpenFDA is unavailable.`,
        conditions: name.toLowerCase(),
        retrievedAt: now,
        useCount: 0,
        documentType: 'synthetic',
        lengthTier: 'short',
      });
    }
  }

  const chars = chunks.reduce((n, c) => n + c.text.length, 0);
  console.log(
    `[pack/openfda] names=${names.length} chunks=${chunks.length} chars≈${chars} ok=${ok} fail=${fail} live=${live}`,
  );

  return {
    version: VERSION,
    rows: knowledgeChunksToPackRows(chunks, 'openfda', VERSION),
  };
}
