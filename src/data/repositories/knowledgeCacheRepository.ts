/**
 * Repository for the `knowledge_cache` table.
 *
 * Stores de-identified clinical chunks retrieved from PubMed / MedlinePlus /
 * RxNorm / DailyMed / OpenFDA. Read by the CachedFusedRetriever (BM25 index)
 * and surfaced as SLM citations.
 *
 * See planning/22_clinical-data-gathering.md §6b.
 */

import { getDatabase } from '../db';
import type { KnowledgeChunk, KnowledgeSource } from '../types';
import { deleteEdgesForChunks, clearAllKnowledgeChunkEdges } from './knowledgeChunkEdgeRepository';

export function insertKnowledgeChunk(chunk: KnowledgeChunk): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO knowledge_cache
      (chunk_id, source, text, query_hash, conditions, retrieved_at, expires_at, use_count, metadata_json,
       document_type, length_tier, section_heading)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    chunk.chunkId,
    chunk.source,
    chunk.text,
    chunk.queryHash ?? null,
    chunk.conditions ?? null,
    chunk.retrievedAt,
    chunk.expiresAt ?? null,
    chunk.useCount,
    chunk.metadataJson ?? null,
    chunk.documentType ?? null,
    chunk.lengthTier ?? null,
    chunk.sectionHeading ?? null,
  );
}

export function insertKnowledgeChunks(chunks: KnowledgeChunk[]): void {
  if (chunks.length === 0) return;
  const db = getDatabase();
  db.withTransactionSync(() => {
    for (const chunk of chunks) {
      db.runSync(
        `INSERT OR REPLACE INTO knowledge_cache
          (chunk_id, source, text, query_hash, conditions, retrieved_at, expires_at, use_count, metadata_json,
           document_type, length_tier, section_heading)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        chunk.chunkId,
        chunk.source,
        chunk.text,
        chunk.queryHash ?? null,
        chunk.conditions ?? null,
        chunk.retrievedAt,
        chunk.expiresAt ?? null,
        chunk.useCount,
        chunk.metadataJson ?? null,
        chunk.documentType ?? null,
        chunk.lengthTier ?? null,
        chunk.sectionHeading ?? null,
      );
    }
  });
}

export function getKnowledgeChunk(chunkId: string): KnowledgeChunk | null {
  const db = getDatabase();
  return (
    db.getFirstSync<KnowledgeChunk>(
      `SELECT chunk_id AS chunkId, source, text, query_hash AS queryHash,
              conditions, retrieved_at AS retrievedAt, expires_at AS expiresAt,
              use_count AS useCount, metadata_json AS metadataJson,
              document_type AS documentType, length_tier AS lengthTier,
              section_heading AS sectionHeading
       FROM knowledge_cache WHERE chunk_id = ?;`,
      chunkId,
    ) ?? null
  );
}

export function getKnowledgeChunksBySource(source: KnowledgeSource): KnowledgeChunk[] {
  const db = getDatabase();
  return db.getAllSync<KnowledgeChunk>(
    `SELECT chunk_id AS chunkId, source, text, query_hash AS queryHash,
            conditions, retrieved_at AS retrievedAt, expires_at AS expiresAt,
            use_count AS useCount, metadata_json AS metadataJson,
            document_type AS documentType, length_tier AS lengthTier,
            section_heading AS sectionHeading
     FROM knowledge_cache
     WHERE source = ?
     ORDER BY retrieved_at DESC;`,
    source,
  );
}

export function getKnowledgeChunksByCondition(condition: string): KnowledgeChunk[] {
  const db = getDatabase();
  return db.getAllSync<KnowledgeChunk>(
    `SELECT chunk_id AS chunkId, source, text, query_hash AS queryHash,
            conditions, retrieved_at AS retrievedAt, expires_at AS expiresAt,
            use_count AS useCount, metadata_json AS metadataJson,
            document_type AS documentType, length_tier AS lengthTier,
            section_heading AS sectionHeading
     FROM knowledge_cache
     WHERE conditions LIKE ?
     ORDER BY retrieved_at DESC;`,
    `%${condition}%`,
  );
}

export function getAllKnowledgeChunks(): KnowledgeChunk[] {
  const db = getDatabase();
  return db.getAllSync<KnowledgeChunk>(
    `SELECT chunk_id AS chunkId, source, text, query_hash AS queryHash,
            conditions, retrieved_at AS retrievedAt, expires_at AS expiresAt,
            use_count AS useCount, metadata_json AS metadataJson,
            document_type AS documentType, length_tier AS lengthTier,
            section_heading AS sectionHeading
     FROM knowledge_cache
     ORDER BY retrieved_at DESC;`,
  );
}

/** Simple LIKE search — fallback if the BM25 index is not built. */
export function searchKnowledgeCache(query: string, limit = 10): KnowledgeChunk[] {
  const db = getDatabase();
  return db.getAllSync<KnowledgeChunk>(
    `SELECT chunk_id AS chunkId, source, text, query_hash AS queryHash,
            conditions, retrieved_at AS retrievedAt, expires_at AS expiresAt,
            use_count AS useCount, metadata_json AS metadataJson,
            document_type AS documentType, length_tier AS lengthTier,
            section_heading AS sectionHeading
     FROM knowledge_cache
     WHERE text LIKE ? OR conditions LIKE ?
     ORDER BY use_count DESC, retrieved_at DESC
     LIMIT ?;`,
    `%${query}%`,
    `%${query}%`,
    limit,
  );
}

export function bumpChunkUseCount(chunkId: string): void {
  const db = getDatabase();
  db.runSync(
    'UPDATE knowledge_cache SET use_count = use_count + 1 WHERE chunk_id = ?;',
    chunkId,
  );
}

export function clearKnowledgeCache(): void {
  const db = getDatabase();
  clearAllKnowledgeChunkEdges();
  db.runSync('DELETE FROM knowledge_cache;');
}

export function deleteKnowledgeChunk(chunkId: string): void {
  deleteEdgesForChunks([chunkId]);
  getDatabase().runSync('DELETE FROM knowledge_cache WHERE chunk_id = ?;', chunkId);
}

export function deleteKnowledgeChunksBySource(source: string): number {
  const db = getDatabase();
  const ids = db
    .getAllSync<{ chunk_id: string }>(
      'SELECT chunk_id FROM knowledge_cache WHERE source = ?;',
      source,
    )
    .map((r) => r.chunk_id);
  if (ids.length) deleteEdgesForChunks(ids);
  const result = db.runSync('DELETE FROM knowledge_cache WHERE source = ?;', source);
  return result.changes;
}

export function deleteKnowledgeChunksByCondition(condition: string): number {
  const db = getDatabase();
  // conditions is a CSV column — match anywhere in the list.
  const like = `%,${condition},%`;
  const ids = db
    .getAllSync<{ chunk_id: string }>(
      'SELECT chunk_id FROM knowledge_cache WHERE conditions LIKE ?;',
      like,
    )
    .map((r) => r.chunk_id);
  if (ids.length) deleteEdgesForChunks(ids);
  const result = db.runSync(
    'DELETE FROM knowledge_cache WHERE conditions LIKE ?;',
    like,
  );
  return result.changes;
}

export function deleteKnowledgeChunksByDocumentType(
  documentType: string,
): number {
  const db = getDatabase();
  const like = `%"documentType":"${documentType}"%`;
  const ids = db
    .getAllSync<{ chunk_id: string }>(
      `SELECT chunk_id FROM knowledge_cache WHERE metadata_json LIKE ?;`,
      like,
    )
    .map((r) => r.chunk_id);
  if (ids.length) deleteEdgesForChunks(ids);
  const result = db.runSync(
    `DELETE FROM knowledge_cache
     WHERE metadata_json LIKE ?;`,
    like,
  );
  return result.changes;
}

export function getKnowledgeChunkForExport(chunkId: string): KnowledgeChunk | null {
  return getKnowledgeChunk(chunkId);
}

export function clearExpiredKnowledgeChunks(): number {
  const db = getDatabase();
  const now = new Date().toISOString();
  const expired = db.getAllSync<{ chunk_id: string }>(
    `SELECT chunk_id FROM knowledge_cache
     WHERE expires_at IS NOT NULL AND expires_at < ?;`,
    now,
  );
  const ids = expired.map((r) => r.chunk_id);
  if (ids.length) deleteEdgesForChunks(ids);
  const result = db.runSync(
    'DELETE FROM knowledge_cache WHERE expires_at IS NOT NULL AND expires_at < ?;',
    now,
  );
  return result.changes;
}

export interface KnowledgeCacheStats {
  total: number;
  bySource: Record<string, number>;
}

export function getKnowledgeCacheStats(): KnowledgeCacheStats {
  const db = getDatabase();
  const totalRow = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM knowledge_cache;',
  );
  const bySourceRows = db.getAllSync<{ source: string; count: number }>(
    'SELECT source, COUNT(*) AS count FROM knowledge_cache GROUP BY source;',
  );
  const bySource: Record<string, number> = {};
  for (const row of bySourceRows) {
    bySource[row.source] = row.count;
  }
  return {
    total: totalRow?.count ?? 0,
    bySource,
  };
}
