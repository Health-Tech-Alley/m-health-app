/**
 * Optional SDOH / CDC PLACES layer (default OFF).
 */

import { fetchCdcPlaces, cdcToChunks } from '@/clinical-evidence/cdc-places-client';

import { knowledgeChunksToPackRows } from '../normalize/chunk-builder';
import type { PackChunkRow } from '../types';

const VERSION = '1.0.0';

export async function fetchSdohLayer(location?: string): Promise<{
  version: string;
  rows: Omit<PackChunkRow, 'packLayer' | 'packVersion' | 'contentHash' | 'retrievedAt'>[];
}> {
  if (!location?.trim()) {
    return { version: VERSION, rows: [] };
  }
  try {
    const rec = await fetchCdcPlaces({ location });
    const chunks = cdcToChunks(rec).map((c) => ({
      ...c,
      externalId: c.chunkId,
      documentType: 'synthetic' as const,
      lengthTier: 'short' as const,
      conditions: 'sdoh',
    }));
    return {
      version: VERSION,
      rows: knowledgeChunksToPackRows(chunks, 'sdoh', VERSION),
    };
  } catch {
    return { version: VERSION, rows: [] };
  }
}
