/**
 * Build pack chunk rows from text sources.
 */

import type { KnowledgeChunk } from '@/data/types';
import { sectionChunkKnowledgeBatch } from '@/clinical-evidence/section-chunk-helper';

import type { PackChunkRow, PackLayerId } from '../types';
import { contentHashForText } from '../pack-db';

export type RawPackDoc = {
  chunkId: string;
  source: string;
  text: string;
  conditions?: string;
  documentType?: string;
  lengthTier?: string;
  sectionHeading?: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
};

export function knowledgeChunksToPackRows(
  chunks: KnowledgeChunk[],
  layerId: PackLayerId,
  version: string,
): Omit<PackChunkRow, 'packLayer' | 'packVersion' | 'contentHash' | 'retrievedAt'>[] {
  // Section-split long rows so retrieval/BM25 density matches multi-source pack goals.
  const expanded = sectionChunkKnowledgeBatch(chunks);
  return expanded.map((c) => ({
    // Row id must use the (possibly section-suffixed) chunkId — section children
    // share the parent's externalId, so keying on externalId collapses all
    // sections of one document into a single row on INSERT OR REPLACE.
    chunkId: c.chunkId.startsWith('pack:')
      ? c.chunkId
      : `pack:${layerId}:${c.chunkId}`,
    source: c.source,
    text: c.text,
    conditions: c.conditions,
    documentType: c.documentType,
    lengthTier: c.lengthTier,
    sectionHeading: c.sectionHeading,
    externalId: c.externalId ?? c.chunkId,
    metadataJson: c.metadataJson,
  }));
}

export function rawDocsToSectionedPackRows(
  docs: RawPackDoc[],
  layerId: PackLayerId,
  version: string,
): Omit<PackChunkRow, 'packLayer' | 'packVersion' | 'contentHash' | 'retrievedAt'>[] {
  const now = new Date().toISOString();
  const asKnowledge: KnowledgeChunk[] = docs
    .filter((d) => d.text.trim().length >= 40)
    .map((d) => ({
      chunkId: d.chunkId.startsWith('pack:') ? d.chunkId : `pack:${layerId}:${d.chunkId}`,
      source: d.source as KnowledgeChunk['source'],
      text: d.text,
      conditions: d.conditions,
      retrievedAt: now,
      useCount: 0,
      documentType: d.documentType as KnowledgeChunk['documentType'],
      lengthTier: d.lengthTier as KnowledgeChunk['lengthTier'],
      sectionHeading: d.sectionHeading,
      externalId: d.externalId ?? d.chunkId,
      metadataJson: JSON.stringify({
        ...(d.metadata ?? {}),
        packLayer: layerId,
        packVersion: version,
      }),
    }));

  const sectioned = sectionChunkKnowledgeBatch(asKnowledge);
  return knowledgeChunksToPackRows(sectioned, layerId, version);
}

export function stampContentHash(
  rows: Omit<PackChunkRow, 'contentHash' | 'retrievedAt' | 'packLayer' | 'packVersion'>[],
): { contentHash: string }[] {
  return rows.map((r) => ({ contentHash: contentHashForText(r.text) }));
}
