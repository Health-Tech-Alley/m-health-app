/**
 * Spine layer — disability care gaps + emergency cards (owned fixtures).
 */

import {
  disabilityCareGapsToChunks,
  selectDisabilityCareGapsForConditions,
  DISABILITY_CARE_GAP_FIXTURES,
} from '@/knowledge/corpora/disability-care-gap-fixtures';

import { knowledgeChunksToPackRows } from '../normalize/chunk-builder';
import type { PackChunkRow } from '../types';

const VERSION = '1.0.0';

export async function fetchSpineLayer(conditions: string[]): Promise<{
  version: string;
  rows: Omit<PackChunkRow, 'packLayer' | 'packVersion' | 'contentHash' | 'retrievedAt'>[];
}> {
  // Global pack: always ship the full disability gap set (Approach C).
  const names = conditions.map((c) => c.trim()).filter(Boolean);
  const matched =
    names.length > 0 ? selectDisabilityCareGapsForConditions(names) : [];
  const byId = new Map(DISABILITY_CARE_GAP_FIXTURES.map((g) => [g.id, g]));
  for (const g of matched) byId.set(g.id, g);
  const gaps = [...byId.values()];
  const conditionCsv = names.join(',') || 'general';
  const chunks = disabilityCareGapsToChunks(gaps, conditionCsv);
  const rows = knowledgeChunksToPackRows(chunks, 'spine', VERSION).map((r) => ({
    ...r,
    documentType: r.documentType ?? 'guideline',
    lengthTier: r.lengthTier ?? 'short',
  }));
  return { version: VERSION, rows };
}
