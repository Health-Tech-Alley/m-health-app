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

export function insertKnowledgeChunk(chunk: KnowledgeChunk): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO knowledge_cache
      (chunk_id, source, text, query_hash, conditions, retrieved_at, expires_at, use_count, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    chunk.chunkId,
    chunk.source,
    chunk.text,
    chunk.queryHash ?? null,
    chunk.conditions ?? null,
    chunk.retrievedAt,
    chunk.expiresAt ?? null,
    chunk.useCount,
    chunk.metadataJson ?? null,
  );
}

export function insertKnowledgeChunks(chunks: KnowledgeChunk[]): void {
  if (chunks.length === 0) return;
  const db = getDatabase();
  db.withTransactionSync(() => {
    for (const chunk of chunks) {
      db.runSync(
        `INSERT OR REPLACE INTO knowledge_cache
          (chunk_id, source, text, query_hash, conditions, retrieved_at, expires_at, use_count, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        chunk.chunkId,
        chunk.source,
        chunk.text,
        chunk.queryHash ?? null,
        chunk.conditions ?? null,
        chunk.retrievedAt,
        chunk.expiresAt ?? null,
        chunk.useCount,
        chunk.metadataJson ?? null,
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
              use_count AS useCount, metadata_json AS metadataJson
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
            use_count AS useCount, metadata_json AS metadataJson
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
            use_count AS useCount, metadata_json AS metadataJson
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
            use_count AS useCount, metadata_json AS metadataJson
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
            use_count AS useCount, metadata_json AS metadataJson
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
  db.runSync('DELETE FROM knowledge_cache;');
}

export function clearExpiredKnowledgeChunks(): number {
  const db = getDatabase();
  const now = new Date().toISOString();
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
