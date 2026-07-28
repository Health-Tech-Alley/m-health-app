/**
 * Section-chunk helper for knowledge_cache insertion.
 *
 * Wraps the section-chunker to split long KnowledgeChunk rows into
 * section-aware children before insertion into the cache.
 *
 * planning/35 §5.4.
 */

import { sectionChunk, SHORT_MAX_CHARS } from '@/nlu/section-chunker';
import type { KnowledgeChunk } from '@/data/types';

/**
 * Section-chunk a KnowledgeChunk if its text exceeds SHORT_MAX_CHARS.
 * Returns an array of KnowledgeChunk objects — either the original (if short)
 * or section children with parentDocId linkage.
 */
export function sectionChunkKnowledge(chunk: KnowledgeChunk): KnowledgeChunk[] {
  if (chunk.text.length <= SHORT_MAX_CHARS) {
    return [chunk];
  }

  const children = sectionChunk({
    text: chunk.text,
    documentType: chunk.documentType,
    lengthTier: chunk.lengthTier,
    sectionHeading: chunk.sectionHeading,
    parentDocId: chunk.chunkId,
  });

  // If only one child (same as parent), return original
  if (children.length === 1 && children[0].chunkId === chunk.chunkId) {
    return [chunk];
  }

  return children.map((child) => {
    // Merge (not replace) metadata so section children keep pmid / medKey /
    // source fields used by the evidence graph and citation rendering.
    let parentMeta: Record<string, unknown> = {};
    if (chunk.metadataJson) {
      try {
        parentMeta = JSON.parse(chunk.metadataJson) as Record<string, unknown>;
      } catch {
        parentMeta = {};
      }
    }
    return {
      ...chunk,
      chunkId: child.chunkId,
      text: child.text,
      lengthTier: child.lengthTier,
      sectionHeading: child.sectionHeading ?? chunk.sectionHeading,
      metadataJson: JSON.stringify({
        ...parentMeta,
        parentDocId: child.parentDocId,
        sectionHeading: child.sectionHeading,
      }),
    };
  });
}

/**
 * Section-chunk an array of KnowledgeChunks.
 * Flattens the result so all children are at the top level.
 */
export function sectionChunkKnowledgeBatch(chunks: KnowledgeChunk[]): KnowledgeChunk[] {
  const result: KnowledgeChunk[] = [];
  for (const chunk of chunks) {
    result.push(...sectionChunkKnowledge(chunk));
  }
  return result;
}
