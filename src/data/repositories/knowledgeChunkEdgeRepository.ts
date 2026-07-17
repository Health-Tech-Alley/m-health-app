/**
 * Repository for the `knowledge_chunk_edges` table.
 *
 * Stores structural edges between evidence chunks (PARENT_OF, SHARES_CONDITION,
 * SHARES_MEDICATION) used for 1-hop RAG seed expansion behind the
 * knowledgeGraphExpansion flag (doc 36).
 */

import { getDatabase } from '../db';
import type { KnowledgeChunkEdge, KnowledgeChunkEdgeType } from '../types';

function now(): string {
  return new Date().toISOString();
}

export function normalizeUndirectedEndpoints(
  a: string,
  b: string,
): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function upsertKnowledgeChunkEdge(
  edge: Omit<KnowledgeChunkEdge, 'createdAt'> & { createdAt?: string },
): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO knowledge_chunk_edges
      (from_chunk_id, to_chunk_id, type, weight, source, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    edge.fromChunkId,
    edge.toChunkId,
    edge.type,
    edge.weight,
    edge.source ?? null,
    edge.metadataJson ?? null,
    edge.createdAt ?? now(),
  );
}

export function upsertKnowledgeChunkEdges(edges: KnowledgeChunkEdge[]): void {
  if (edges.length === 0) return;
  const db = getDatabase();
  db.withTransactionSync(() => {
    for (const e of edges) upsertKnowledgeChunkEdge(e);
  });
}

export function getIncidentEdges(
  chunkIds: string[],
  types?: KnowledgeChunkEdgeType[],
): KnowledgeChunkEdge[] {
  if (chunkIds.length === 0) return [];
  const db = getDatabase();
  const ph = chunkIds.map(() => '?').join(',');
  let typeClause = '';
  const params: string[] = [...chunkIds];
  if (types && types.length > 0) {
    const typePh = types.map(() => '?').join(',');
    typeClause = ` AND type IN (${typePh})`;
    params.push(...types);
  }
  params.push(...chunkIds);
  if (types && types.length > 0) {
    params.push(...types);
  }
  const rows = db.getAllSync<{
    from_chunk_id: string;
    to_chunk_id: string;
    type: string;
    weight: number;
    source: string | null;
    metadata_json: string | null;
    created_at: string;
  }>(
    `SELECT from_chunk_id, to_chunk_id, type, weight, source,
            metadata_json, created_at
     FROM knowledge_chunk_edges
     WHERE from_chunk_id IN (${ph})${typeClause}
     UNION
     SELECT from_chunk_id, to_chunk_id, type, weight, source,
            metadata_json, created_at
     FROM knowledge_chunk_edges
     WHERE to_chunk_id IN (${ph})${typeClause};`,
    ...params,
  );
  return rows.map((r) => ({
    fromChunkId: r.from_chunk_id,
    toChunkId: r.to_chunk_id,
    type: r.type as KnowledgeChunkEdgeType,
    weight: r.weight,
    source: r.source ?? undefined,
    metadataJson: r.metadata_json ?? undefined,
    createdAt: r.created_at,
  }));
}

export function deleteEdgesForChunks(chunkIds: string[]): number {
  if (chunkIds.length === 0) return 0;
  const db = getDatabase();
  const ph = chunkIds.map(() => '?').join(',');
  const r1 = db.runSync(
    `DELETE FROM knowledge_chunk_edges WHERE from_chunk_id IN (${ph});`,
    ...chunkIds,
  );
  const r2 = db.runSync(
    `DELETE FROM knowledge_chunk_edges WHERE to_chunk_id IN (${ph});`,
    ...chunkIds,
  );
  return (r1.changes ?? 0) + (r2.changes ?? 0);
}

export function clearAllKnowledgeChunkEdges(): void {
  getDatabase().runSync('DELETE FROM knowledge_chunk_edges;');
}
