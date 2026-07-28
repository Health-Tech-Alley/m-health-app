/**
 * Orphanet layer — rare/complex disease subset (fixtures + client).
 */

import { searchOrphanet, orphanetToChunks } from '@/clinical-evidence/orphanet-client';

import { knowledgeChunksToPackRows } from '../normalize/chunk-builder';
import { mergeConditionSeeds } from '../pack-seeds';
import type { PackChunkRow } from '../types';

const VERSION = '1.1.0';

const DEFAULT_DISEASES = [
  'Cerebral Palsy',
  'Spina Bifida',
  'Traumatic Brain Injury',
  'COPD',
  'Stroke',
  'Epilepsy',
  'Muscular dystrophy',
];

export async function fetchOrphanetLayer(conditions: string[]): Promise<{
  version: string;
  rows: Omit<PackChunkRow, 'packLayer' | 'packVersion' | 'contentHash' | 'retrievedAt'>[];
}> {
  const queries = [
    ...new Set([
      ...DEFAULT_DISEASES,
      ...mergeConditionSeeds(conditions),
    ]),
  ];
  const allChunks = [];
  for (const disease of queries) {
    try {
      const rec = await searchOrphanet({ disease });
      const chunks = orphanetToChunks(rec).map((c) => ({
        ...c,
        conditions: disease,
        externalId: c.chunkId,
        documentType: 'synthetic' as const,
        lengthTier: 'medium' as const,
      }));
      allChunks.push(...chunks);
    } catch {
      /* skip */
    }
  }
  return {
    version: VERSION,
    rows: knowledgeChunksToPackRows(allChunks, 'orphanet', VERSION),
  };
}
