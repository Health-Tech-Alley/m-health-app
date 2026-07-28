/**
 * Global on-device pack SQLite store (Approach C — doc 42).
 * Lives under Documents/knowledge-pack/pack.sqlite — not the patient DB.
 */

import { Directory, Paths } from 'expo-file-system';
import {
  deleteDatabaseSync,
  openDatabaseSync,
  type SQLiteDatabase,
} from 'expo-sqlite';

import type { PackChunkRow, PackEdgeRow, PackLayerId } from './types';
import { PACK_VECTOR_DIM } from './catalog';

const PACK_DB_NAME = 'pack.sqlite';
const PACK_DIR_NAME = 'knowledge-pack';

let packDb: SQLiteDatabase | null = null;

export function getKnowledgePackDirectory(): Directory {
  const dir = new Directory(Paths.document, PACK_DIR_NAME);
  if (!dir.exists) {
    dir.create();
  }
  return dir;
}

export function getPackDatabasePath(): string {
  const dir = getKnowledgePackDirectory();
  return `${dir.uri.replace(/\/$/, '')}/${PACK_DB_NAME}`;
}

export function getPackDatabase(): SQLiteDatabase {
  if (!packDb) {
    const dir = getKnowledgePackDirectory();
    packDb = openDatabaseSync(PACK_DB_NAME, undefined, dir.uri);
    migratePackSchema(packDb);
  }
  return packDb;
}

export function closePackDatabase(): void {
  if (packDb) {
    try {
      packDb.closeSync();
    } catch {
      /* ignore */
    }
    packDb = null;
  }
}

export function resetPackDatabase(): void {
  closePackDatabase();
  try {
    const dir = getKnowledgePackDirectory();
    deleteDatabaseSync(PACK_DB_NAME, dir.uri);
  } catch {
    /* file may not exist */
  }
  // Recreate empty
  getPackDatabase();
}

function migratePackSchema(db: SQLiteDatabase): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS pack_chunks (
      chunk_id TEXT PRIMARY KEY NOT NULL,
      pack_layer TEXT NOT NULL,
      pack_version TEXT NOT NULL,
      source TEXT NOT NULL,
      text TEXT NOT NULL,
      conditions TEXT,
      document_type TEXT,
      length_tier TEXT,
      section_heading TEXT,
      external_id TEXT,
      metadata_json TEXT,
      content_hash TEXT NOT NULL,
      retrieved_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pack_chunks_layer ON pack_chunks(pack_layer);
    CREATE INDEX IF NOT EXISTS idx_pack_chunks_conditions ON pack_chunks(conditions);

    CREATE TABLE IF NOT EXISTS pack_edges (
      from_chunk_id TEXT NOT NULL,
      to_chunk_id TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      source TEXT,
      metadata_json TEXT,
      pack_layer TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (from_chunk_id, to_chunk_id, type)
    );
    CREATE INDEX IF NOT EXISTS idx_pack_edges_from ON pack_edges(from_chunk_id);
    CREATE INDEX IF NOT EXISTS idx_pack_edges_to ON pack_edges(to_chunk_id);

    CREATE TABLE IF NOT EXISTS pack_vectors (
      chunk_id TEXT NOT NULL,
      embedder_id TEXT NOT NULL,
      dim INTEGER NOT NULL CHECK (dim = ${PACK_VECTOR_DIM}),
      vector BLOB NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (chunk_id, embedder_id)
    );
  `);
}

function simpleHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function contentHashForText(text: string): string {
  return simpleHash(text);
}

export function replaceLayerChunks(
  layerId: PackLayerId,
  version: string,
  chunks: Omit<PackChunkRow, 'packLayer' | 'packVersion' | 'contentHash' | 'retrievedAt'>[],
): PackChunkRow[] {
  const db = getPackDatabase();
  const now = new Date().toISOString();
  const rows: PackChunkRow[] = chunks.map((c) => ({
    ...c,
    packLayer: layerId,
    packVersion: version,
    contentHash: contentHashForText(c.text),
    retrievedAt: now,
  }));

  // Debug: verify section-splitting is actually happening for long docs.
  const longTexts = chunks.filter((c) => c.text.length > 1500).length;
  if (longTexts > 0) {
    console.log(
      `[pack-db] ${layerId}: ${longTexts}/${chunks.length} source rows >1500 chars before section-split`,
    );
  }

  db.withTransactionSync(() => {
    const oldIds = db
      .getAllSync<{ chunk_id: string }>(
        'SELECT chunk_id FROM pack_chunks WHERE pack_layer = ?;',
        layerId,
      )
      .map((r) => r.chunk_id);

    db.runSync('DELETE FROM pack_chunks WHERE pack_layer = ?;', layerId);

    if (oldIds.length > 0) {
      const ph = oldIds.map(() => '?').join(',');
      db.runSync(
        `DELETE FROM pack_edges WHERE from_chunk_id IN (${ph}) OR to_chunk_id IN (${ph});`,
        ...oldIds,
        ...oldIds,
      );
      db.runSync(`DELETE FROM pack_vectors WHERE chunk_id IN (${ph});`, ...oldIds);
    }

    for (const r of rows) {
      db.runSync(
        `INSERT OR REPLACE INTO pack_chunks
          (chunk_id, pack_layer, pack_version, source, text, conditions,
           document_type, length_tier, section_heading, external_id,
           metadata_json, content_hash, retrieved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        r.chunkId,
        r.packLayer,
        r.packVersion,
        r.source,
        r.text,
        r.conditions ?? null,
        r.documentType ?? null,
        r.lengthTier ?? null,
        r.sectionHeading ?? null,
        r.externalId ?? null,
        r.metadataJson ?? null,
        r.contentHash,
        r.retrievedAt,
      );
    }
  });

  return rows;
}

export function getAllPackChunks(): PackChunkRow[] {
  const db = getPackDatabase();
  const rows = db.getAllSync<{
    chunk_id: string;
    pack_layer: string;
    pack_version: string;
    source: string;
    text: string;
    conditions: string | null;
    document_type: string | null;
    length_tier: string | null;
    section_heading: string | null;
    external_id: string | null;
    metadata_json: string | null;
    content_hash: string;
    retrieved_at: string;
  }>('SELECT * FROM pack_chunks;');

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    packLayer: r.pack_layer as PackLayerId,
    packVersion: r.pack_version,
    source: r.source,
    text: r.text,
    conditions: r.conditions ?? undefined,
    documentType: r.document_type ?? undefined,
    lengthTier: r.length_tier ?? undefined,
    sectionHeading: r.section_heading ?? undefined,
    externalId: r.external_id ?? undefined,
    metadataJson: r.metadata_json ?? undefined,
    contentHash: r.content_hash,
    retrievedAt: r.retrieved_at,
  }));
}

export function getPackChunksByIds(ids: string[]): PackChunkRow[] {
  if (ids.length === 0) return [];
  const db = getPackDatabase();
  const ph = ids.map(() => '?').join(',');
  const rows = db.getAllSync<{
    chunk_id: string;
    pack_layer: string;
    pack_version: string;
    source: string;
    text: string;
    conditions: string | null;
    document_type: string | null;
    length_tier: string | null;
    section_heading: string | null;
    external_id: string | null;
    metadata_json: string | null;
    content_hash: string;
    retrieved_at: string;
  }>(`SELECT * FROM pack_chunks WHERE chunk_id IN (${ph});`, ...ids);

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    packLayer: r.pack_layer as PackLayerId,
    packVersion: r.pack_version,
    source: r.source,
    text: r.text,
    conditions: r.conditions ?? undefined,
    documentType: r.document_type ?? undefined,
    lengthTier: r.length_tier ?? undefined,
    sectionHeading: r.section_heading ?? undefined,
    externalId: r.external_id ?? undefined,
    metadataJson: r.metadata_json ?? undefined,
    contentHash: r.content_hash,
    retrievedAt: r.retrieved_at,
  }));
}

export function countPackChunks(): number {
  const db = getPackDatabase();
  const row = db.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM pack_chunks;');
  return row?.c ?? 0;
}

/**
 * LIKE search over pack chunks (conditions + text) for med-glance lookups.
 * Device-global corpus — no patient scoping.
 */
export function searchPackChunks(query: string, limit = 12): PackChunkRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  try {
    const db = getPackDatabase();
    const like = `%${q}%`;
    const rows = db.getAllSync<{
      chunk_id: string;
      pack_layer: string;
      pack_version: string;
      source: string;
      text: string;
      conditions: string | null;
      document_type: string | null;
      length_tier: string | null;
      section_heading: string | null;
      external_id: string | null;
      metadata_json: string | null;
      content_hash: string;
      retrieved_at: string;
    }>(
      `SELECT * FROM pack_chunks
       WHERE lower(COALESCE(conditions, '')) LIKE ? OR lower(text) LIKE ?
       ORDER BY CASE WHEN lower(COALESCE(conditions, '')) LIKE ? THEN 0 ELSE 1 END
       LIMIT ?;`,
      like,
      like,
      like,
      limit,
    );
    return rows.map((r) => ({
      chunkId: r.chunk_id,
      packLayer: r.pack_layer as PackLayerId,
      packVersion: r.pack_version,
      source: r.source,
      text: r.text,
      conditions: r.conditions ?? undefined,
      documentType: r.document_type ?? undefined,
      lengthTier: r.length_tier ?? undefined,
      sectionHeading: r.section_heading ?? undefined,
      externalId: r.external_id ?? undefined,
      metadataJson: r.metadata_json ?? undefined,
      contentHash: r.content_hash,
      retrievedAt: r.retrieved_at,
    }));
  } catch {
    return [];
  }
}

/** Per-layer counts + text bytes for density debugging. */
export function getPackLayerStats(): {
  layer: string;
  chunks: number;
  textChars: number;
}[] {
  try {
    const db = getPackDatabase();
    return db.getAllSync<{ layer: string; chunks: number; textChars: number }>(
      `SELECT pack_layer AS layer,
              COUNT(*) AS chunks,
              COALESCE(SUM(LENGTH(text)), 0) AS textChars
       FROM pack_chunks
       GROUP BY pack_layer
       ORDER BY textChars DESC;`,
    );
  } catch {
    return [];
  }
}

export function upsertPackEdges(edges: PackEdgeRow[]): void {
  if (edges.length === 0) return;
  const db = getPackDatabase();
  const now = new Date().toISOString();
  db.withTransactionSync(() => {
    for (const e of edges) {
      db.runSync(
        `INSERT OR REPLACE INTO pack_edges
          (from_chunk_id, to_chunk_id, type, weight, source, metadata_json, pack_layer, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        e.fromChunkId,
        e.toChunkId,
        e.type,
        e.weight,
        e.source ?? null,
        e.metadataJson ?? null,
        e.packLayer ?? null,
        now,
      );
    }
  });
}

export function clearAllPackEdges(): void {
  const db = getPackDatabase();
  db.runSync('DELETE FROM pack_edges;');
}

export function getPackIncidentEdges(chunkIds: string[]): PackEdgeRow[] {
  if (chunkIds.length === 0) return [];
  const db = getPackDatabase();
  const ph = chunkIds.map(() => '?').join(',');
  const rows = db.getAllSync<{
    from_chunk_id: string;
    to_chunk_id: string;
    type: string;
    weight: number;
    source: string | null;
    metadata_json: string | null;
    pack_layer: string | null;
  }>(
    `SELECT from_chunk_id, to_chunk_id, type, weight, source, metadata_json, pack_layer
     FROM pack_edges
     WHERE from_chunk_id IN (${ph})
     UNION
     SELECT from_chunk_id, to_chunk_id, type, weight, source, metadata_json, pack_layer
     FROM pack_edges
     WHERE to_chunk_id IN (${ph});`,
    ...chunkIds,
    ...chunkIds,
  );
  return rows.map((r) => ({
    fromChunkId: r.from_chunk_id,
    toChunkId: r.to_chunk_id,
    type: r.type as PackEdgeRow['type'],
    weight: r.weight,
    source: r.source ?? undefined,
    metadataJson: r.metadata_json ?? undefined,
    packLayer: r.pack_layer ?? undefined,
  }));
}

export function upsertPackVector(
  chunkId: string,
  embedderId: string,
  dim: number,
  vector: Uint8Array,
): void {
  const db = getPackDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO pack_vectors (chunk_id, embedder_id, dim, vector, updated_at)
     VALUES (?, ?, ?, ?, ?);`,
    chunkId,
    embedderId,
    dim,
    vector,
    new Date().toISOString(),
  );
}

/** Batch vector upserts in one transaction (much faster than per-row commits). */
export function upsertPackVectorsBatch(
  rows: { chunkId: string; embedderId: string; dim: number; vector: Uint8Array }[],
): void {
  if (rows.length === 0) return;
  const db = getPackDatabase();
  const now = new Date().toISOString();
  db.withTransactionSync(() => {
    for (const r of rows) {
      db.runSync(
        `INSERT OR REPLACE INTO pack_vectors (chunk_id, embedder_id, dim, vector, updated_at)
         VALUES (?, ?, ?, ?, ?);`,
        r.chunkId,
        r.embedderId,
        r.dim,
        r.vector,
        now,
      );
    }
  });
}

export function getPackVectorsForChunks(
  chunkIds: string[],
  embedderId: string,
): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  if (chunkIds.length === 0) return out;
  const db = getPackDatabase();
  const ph = chunkIds.map(() => '?').join(',');
  const rows = db.getAllSync<{ chunk_id: string; vector: Uint8Array }>(
    `SELECT chunk_id, vector FROM pack_vectors
     WHERE embedder_id = ? AND chunk_id IN (${ph});`,
    embedderId,
    ...chunkIds,
  );
  for (const r of rows) {
    const v = r.vector;
    out.set(
      r.chunk_id,
      v instanceof Uint8Array ? v : new Uint8Array(v as unknown as ArrayBuffer),
    );
  }
  return out;
}

export function getChunkIdsMissingVectors(embedderId: string): string[] {
  const db = getPackDatabase();
  const rows = db.getAllSync<{ chunk_id: string }>(
    `SELECT c.chunk_id FROM pack_chunks c
     LEFT JOIN pack_vectors v
       ON v.chunk_id = c.chunk_id AND v.embedder_id = ?
     WHERE v.chunk_id IS NULL;`,
    embedderId,
  );
  return rows.map((r) => r.chunk_id);
}

export function clearPackVectorsForEmbedder(embedderId: string): void {
  const db = getPackDatabase();
  db.runSync('DELETE FROM pack_vectors WHERE embedder_id = ?;', embedderId);
}

export function estimatePackOnDiskBytes(): number {
  try {
    const dir = getKnowledgePackDirectory();
    let total = 0;
    for (const item of dir.list()) {
      if ('size' in item && typeof item.size === 'number') {
        total += item.size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/** Content-based size when file listing is 0 / unreliable (Expo Go). */
export function estimatePackContentBytes(): number {
  try {
    const db = getPackDatabase();
    const chunks = db.getAllSync<{ text: string }>('SELECT text FROM pack_chunks;');
    let bytes = 0;
    for (const c of chunks) {
      // UTF-8 approx + row overhead
      bytes += (c.text?.length ?? 0) + 160;
    }
    const vecRow = db.getFirstSync<{ c: number; blob: number }>(
      `SELECT COUNT(*) AS c,
              COALESCE(SUM(LENGTH(vector)), 0) AS blob
       FROM pack_vectors;`,
    );
    bytes += vecRow?.blob ?? 0;
    bytes += (vecRow?.c ?? 0) * 64;
    const edgeRow = db.getFirstSync<{ c: number }>(
      'SELECT COUNT(*) AS c FROM pack_edges;',
    );
    bytes += (edgeRow?.c ?? 0) * 80;
    // SQLite page overhead floor
    bytes = Math.max(bytes, chunks.length > 0 ? 8_192 : 0);
    return bytes;
  } catch {
    return 0;
  }
}

/** Prefer larger of on-disk file size and content estimate. */
export function getPackSizeBytes(): number {
  const disk = estimatePackOnDiskBytes();
  const content = estimatePackContentBytes();
  // SQLite files can be much larger than content before VACUUM (deleted pages).
  // If disk >> content, prefer content as the truthful "data size" for UI.
  if (disk > content * 3 && content > 0) {
    return content;
  }
  return Math.max(disk, content);
}

export function countPackVectors(): number {
  try {
    const db = getPackDatabase();
    const row = db.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM pack_vectors;');
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

/** Compact the pack database (reclaim deleted-page space). Call at end of install. */
export function vacuumPackDatabase(): void {
  try {
    const db = getPackDatabase();
    db.execSync('VACUUM;');
    console.log('[pack-db] VACUUM complete');
  } catch (err) {
    console.warn('[pack-db] VACUUM failed:', err);
  }
}
