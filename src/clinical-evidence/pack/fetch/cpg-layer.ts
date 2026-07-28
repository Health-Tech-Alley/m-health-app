/**
 * CPG layer — owned guideline text digests (no PDFs).
 */

import {
  getAllCpgFixtures,
  selectCpgFixturesForConditions,
} from '@/knowledge/corpora/cpg-fixtures';
import type { KnowledgeChunk } from '@/data/types';

import { knowledgeChunksToPackRows } from '../normalize/chunk-builder';
import type { PackChunkRow } from '../types';

const VERSION = '1.0.0';

export async function fetchCpgLayer(conditions: string[]): Promise<{
  version: string;
  rows: Omit<PackChunkRow, 'packLayer' | 'packVersion' | 'contentHash' | 'retrievedAt'>[];
}> {
  // Global pack: full CPG digest set, not only current patient conditions.
  const names = conditions.map((c) => c.trim()).filter(Boolean);
  const matched = names.length > 0 ? selectCpgFixturesForConditions(names) : [];
  const byId = new Map(getAllCpgFixtures().map((f) => [f.docId, f]));
  for (const f of matched) byId.set(f.docId, f);
  const fixtures = [...byId.values()];
  const now = new Date().toISOString();
  const conditionCsv = names.join(',') || 'general';
  const chunks: KnowledgeChunk[] = fixtures.map((f) => ({
    chunkId: f.docId,
    externalId: f.docId,
    source: 'synthetic',
    text: f.text,
    conditions: conditionCsv,
    retrievedAt: now,
    useCount: 0,
    documentType: f.documentType ?? 'guideline',
    lengthTier: f.lengthTier ?? 'medium',
    sectionHeading: f.sectionHeading,
    metadataJson: JSON.stringify({ kind: 'cpg_digest', docId: f.docId }),
  }));
  return {
    version: VERSION,
    rows: knowledgeChunksToPackRows(chunks, 'cpg', VERSION),
  };
}
