/**
 * Repository for the `knowledge_cache` table — **per-patient isolated corpora**.
 *
 * Every row must carry `patient_id`. Retrieval and BM25 indexing only load the
 * active patient's rows. Literature is duplicated per patient (not shared).
 *
 * See planning/22_clinical-data-gathering.md §6b + per-patient isolation.
 */

import { getDatabase } from '../db';
import type {
  KnowledgeChunk,
  KnowledgeChunkFeedback,
  KnowledgeFeedbackSignal,
  KnowledgeSource,
} from '../types';
import {
  externalIdFromKnowledgeChunkId,
  patientIdFromKnowledgeChunkId,
  toPatientKnowledgeChunkId,
} from '../patientKnowledgeIds';
import { deleteEdgesForChunks, clearAllKnowledgeChunkEdges } from './knowledgeChunkEdgeRepository';

const CHUNK_SELECT = `
  chunk_id AS chunkId, source, text, query_hash AS queryHash,
  conditions, retrieved_at AS retrievedAt, expires_at AS expiresAt,
  use_count AS useCount, metadata_json AS metadataJson,
  document_type AS documentType, length_tier AS lengthTier,
  section_heading AS sectionHeading,
  patient_id AS patientId, external_id AS externalId,
  COALESCE(feedback_score, 0) AS feedbackScore
`;

const PRESERVED_KNOWLEDGE_SOURCES: KnowledgeSource[] = ['adcp_plan', 'patient-record'];

function mergeMetadata(
  existing: string | undefined,
  patch: Record<string, unknown>,
): string {
  let base: Record<string, unknown> = {};
  if (existing) {
    try {
      base = JSON.parse(existing) as Record<string, unknown>;
    } catch {
      base = {};
    }
  }
  return JSON.stringify({ ...base, ...patch });
}

/**
 * Ensure chunk is stamped with patientId and a patient-scoped chunkId before write.
 */
export function stampKnowledgeChunkForPatient(
  patientId: string,
  chunk: KnowledgeChunk,
): KnowledgeChunk {
  const pid = patientId.trim();
  if (!pid) {
    throw new Error('stampKnowledgeChunkForPatient requires patientId');
  }
  const externalId =
    chunk.externalId?.trim() ||
    chunk.sourceId?.trim() ||
    externalIdFromKnowledgeChunkId(chunk.chunkId) ||
    chunk.chunkId;
  const scopedId =
    patientIdFromKnowledgeChunkId(chunk.chunkId) === pid
      ? chunk.chunkId
      : chunk.source === 'adcp_plan' && chunk.chunkId.startsWith('adcp:')
        ? chunk.chunkId
        : toPatientKnowledgeChunkId(pid, chunk.source, externalId);

  return {
    ...chunk,
    chunkId: scopedId,
    patientId: pid,
    externalId,
    feedbackScore: chunk.feedbackScore ?? 0,
    metadataJson: mergeMetadata(chunk.metadataJson, {
      patientId: pid,
      externalId,
    }),
  };
}

function insertOne(db: ReturnType<typeof getDatabase>, chunk: KnowledgeChunk): void {
  const patientId = chunk.patientId?.trim();
  if (!patientId) {
    throw new Error(
      `insertKnowledgeChunk requires patientId (chunk ${chunk.chunkId})`,
    );
  }
  db.runSync(
    `INSERT OR REPLACE INTO knowledge_cache
      (chunk_id, source, text, query_hash, conditions, retrieved_at, expires_at, use_count, metadata_json,
       document_type, length_tier, section_heading, patient_id, external_id, feedback_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
    patientId,
    chunk.externalId ?? externalIdFromKnowledgeChunkId(chunk.chunkId),
    chunk.feedbackScore ?? 0,
  );
}

export function insertKnowledgeChunk(chunk: KnowledgeChunk): void {
  const db = getDatabase();
  const stamped = chunk.patientId
    ? stampKnowledgeChunkForPatient(chunk.patientId, chunk)
    : chunk;
  insertOne(db, stamped);
}

export function insertKnowledgeChunks(chunks: KnowledgeChunk[]): void {
  if (chunks.length === 0) return;
  const db = getDatabase();
  db.withTransactionSync(() => {
    for (const chunk of chunks) {
      const stamped = chunk.patientId
        ? stampKnowledgeChunkForPatient(chunk.patientId, chunk)
        : chunk;
      insertOne(db, stamped);
    }
  });
}

/** Insert many chunks under one patient (stamps all). */
export function insertKnowledgeChunksForPatient(
  patientId: string,
  chunks: KnowledgeChunk[],
): void {
  if (!patientId.trim() || chunks.length === 0) return;
  insertKnowledgeChunks(
    chunks.map((c) => stampKnowledgeChunkForPatient(patientId, c)),
  );
}

export function getKnowledgeChunk(chunkId: string): KnowledgeChunk | null {
  const db = getDatabase();
  return (
    db.getFirstSync<KnowledgeChunk>(
      `SELECT ${CHUNK_SELECT} FROM knowledge_cache WHERE chunk_id = ?;`,
      chunkId,
    ) ?? null
  );
}

export function getKnowledgeChunkForPatient(
  patientId: string,
  chunkId: string,
): KnowledgeChunk | null {
  const db = getDatabase();
  return (
    db.getFirstSync<KnowledgeChunk>(
      `SELECT ${CHUNK_SELECT}
       FROM knowledge_cache
       WHERE chunk_id = ? AND patient_id = ?;`,
      chunkId,
      patientId,
    ) ?? null
  );
}

export function getKnowledgeChunksForPatient(patientId: string): KnowledgeChunk[] {
  if (!patientId.trim()) return [];
  const db = getDatabase();
  return db.getAllSync<KnowledgeChunk>(
    `SELECT ${CHUNK_SELECT}
     FROM knowledge_cache
     WHERE patient_id = ?
     ORDER BY retrieved_at DESC;`,
    patientId,
  );
}

export function getKnowledgeChunksBySource(
  source: KnowledgeSource,
  patientId?: string,
): KnowledgeChunk[] {
  const db = getDatabase();
  if (patientId?.trim()) {
    return db.getAllSync<KnowledgeChunk>(
      `SELECT ${CHUNK_SELECT}
       FROM knowledge_cache
       WHERE source = ? AND patient_id = ?
       ORDER BY retrieved_at DESC;`,
      source,
      patientId,
    );
  }
  return db.getAllSync<KnowledgeChunk>(
    `SELECT ${CHUNK_SELECT}
     FROM knowledge_cache
     WHERE source = ?
     ORDER BY retrieved_at DESC;`,
    source,
  );
}

export function getKnowledgeChunksByCondition(
  condition: string,
  patientId?: string,
): KnowledgeChunk[] {
  const db = getDatabase();
  if (patientId?.trim()) {
    return db.getAllSync<KnowledgeChunk>(
      `SELECT ${CHUNK_SELECT}
       FROM knowledge_cache
       WHERE patient_id = ? AND conditions LIKE ?
       ORDER BY retrieved_at DESC;`,
      patientId,
      `%${condition}%`,
    );
  }
  return db.getAllSync<KnowledgeChunk>(
    `SELECT ${CHUNK_SELECT}
     FROM knowledge_cache
     WHERE conditions LIKE ?
     ORDER BY retrieved_at DESC;`,
    `%${condition}%`,
  );
}

/**
 * @deprecated Prefer getKnowledgeChunksForPatient. Cross-patient dump for
 * developer tools only — never use for retrieval.
 */
export function getAllKnowledgeChunks(): KnowledgeChunk[] {
  const db = getDatabase();
  return db.getAllSync<KnowledgeChunk>(
    `SELECT ${CHUNK_SELECT}
     FROM knowledge_cache
     ORDER BY retrieved_at DESC;`,
  );
}

/** Simple LIKE search — patient-scoped when patientId provided. */
export function searchKnowledgeCache(
  query: string,
  limit = 10,
  patientId?: string,
): KnowledgeChunk[] {
  const db = getDatabase();
  if (patientId?.trim()) {
    return db.getAllSync<KnowledgeChunk>(
      `SELECT ${CHUNK_SELECT}
       FROM knowledge_cache
       WHERE patient_id = ?
         AND (text LIKE ? OR conditions LIKE ?)
       ORDER BY feedback_score DESC, use_count DESC, retrieved_at DESC
       LIMIT ?;`,
      patientId,
      `%${query}%`,
      `%${query}%`,
      limit,
    );
  }
  // Fail closed for retrieval paths that forget patientId.
  return [];
}

export function bumpChunkUseCount(chunkId: string, patientId?: string): void {
  const db = getDatabase();
  if (patientId?.trim()) {
    db.runSync(
      'UPDATE knowledge_cache SET use_count = use_count + 1 WHERE chunk_id = ? AND patient_id = ?;',
      chunkId,
      patientId,
    );
    return;
  }
  db.runSync(
    'UPDATE knowledge_cache SET use_count = use_count + 1 WHERE chunk_id = ?;',
    chunkId,
  );
}

/** Dev-only: wipe every patient's knowledge. Prefer clearKnowledgeCacheForPatient. */
export function clearKnowledgeCache(): void {
  const db = getDatabase();
  clearAllKnowledgeChunkEdges();
  db.runSync('DELETE FROM knowledge_cache;');
  try {
    db.runSync('DELETE FROM knowledge_chunk_feedback;');
  } catch {
    /* table may not exist on very old DBs mid-migrate */
  }
}

/** Clear one patient's entire knowledge corpus (literature + plan + record). */
export function clearKnowledgeCacheForPatient(patientId: string): number {
  if (!patientId.trim()) return 0;
  const db = getDatabase();
  const ids = db
    .getAllSync<{ chunk_id: string }>(
      'SELECT chunk_id FROM knowledge_cache WHERE patient_id = ?;',
      patientId,
    )
    .map((r) => r.chunk_id);
  if (ids.length) deleteEdgesForChunks(ids);
  const result = db.runSync(
    'DELETE FROM knowledge_cache WHERE patient_id = ?;',
    patientId,
  );
  try {
    db.runSync('DELETE FROM knowledge_chunk_feedback WHERE patient_id = ?;', patientId);
  } catch {
    /* ignore */
  }
  return result.changes;
}

/**
 * Wipe literature / remote evidence for one patient. Preserves ADCP plan +
 * patient-record narrative for that patient.
 */
export function clearLiteratureKnowledgeCacheForPatient(patientId: string): number {
  if (!patientId.trim()) return 0;
  const db = getDatabase();
  const placeholders = PRESERVED_KNOWLEDGE_SOURCES.map(() => '?').join(', ');
  const doomed = db.getAllSync<{ chunk_id: string }>(
    `SELECT chunk_id FROM knowledge_cache
     WHERE patient_id = ? AND source NOT IN (${placeholders});`,
    patientId,
    ...PRESERVED_KNOWLEDGE_SOURCES,
  );
  const ids = doomed.map((r) => r.chunk_id);
  if (ids.length) deleteEdgesForChunks(ids);
  const result = db.runSync(
    `DELETE FROM knowledge_cache
     WHERE patient_id = ? AND source NOT IN (${placeholders});`,
    patientId,
    ...PRESERVED_KNOWLEDGE_SOURCES,
  );
  return result.changes;
}

/**
 * @deprecated Global literature wipe — use clearLiteratureKnowledgeCacheForPatient.
 * Still used by legacy re-download-all; clears literature for ALL patients.
 */
export function clearLiteratureKnowledgeCache(): number {
  const db = getDatabase();
  const placeholders = PRESERVED_KNOWLEDGE_SOURCES.map(() => '?').join(', ');
  const doomed = db.getAllSync<{ chunk_id: string }>(
    `SELECT chunk_id FROM knowledge_cache WHERE source NOT IN (${placeholders});`,
    ...PRESERVED_KNOWLEDGE_SOURCES,
  );
  const ids = doomed.map((r) => r.chunk_id);
  if (ids.length) deleteEdgesForChunks(ids);
  const result = db.runSync(
    `DELETE FROM knowledge_cache WHERE source NOT IN (${placeholders});`,
    ...PRESERVED_KNOWLEDGE_SOURCES,
  );
  return result.changes;
}

export function deleteKnowledgeChunk(chunkId: string): void {
  deleteEdgesForChunks([chunkId]);
  getDatabase().runSync('DELETE FROM knowledge_cache WHERE chunk_id = ?;', chunkId);
}

export function deleteKnowledgeChunksBySource(
  source: string,
  patientId?: string,
): number {
  const db = getDatabase();
  if (patientId?.trim()) {
    const ids = db
      .getAllSync<{ chunk_id: string }>(
        'SELECT chunk_id FROM knowledge_cache WHERE source = ? AND patient_id = ?;',
        source,
        patientId,
      )
      .map((r) => r.chunk_id);
    if (ids.length) deleteEdgesForChunks(ids);
    const result = db.runSync(
      'DELETE FROM knowledge_cache WHERE source = ? AND patient_id = ?;',
      source,
      patientId,
    );
    return result.changes;
  }
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

export function deleteKnowledgeChunksBySourceAndChunkPrefix(
  source: string,
  chunkIdPrefix: string,
): number {
  const db = getDatabase();
  const like = `${chunkIdPrefix}%`;
  const ids = db
    .getAllSync<{ chunk_id: string }>(
      'SELECT chunk_id FROM knowledge_cache WHERE source = ? AND chunk_id LIKE ?;',
      source,
      like,
    )
    .map((r) => r.chunk_id);
  if (ids.length) deleteEdgesForChunks(ids);
  const result = db.runSync(
    'DELETE FROM knowledge_cache WHERE source = ? AND chunk_id LIKE ?;',
    source,
    like,
  );
  return result.changes;
}

export function deleteKnowledgeChunksByCondition(
  condition: string,
  patientId?: string,
): number {
  const db = getDatabase();
  const like = `%${condition}%`;
  if (patientId?.trim()) {
    const ids = db
      .getAllSync<{ chunk_id: string }>(
        'SELECT chunk_id FROM knowledge_cache WHERE patient_id = ? AND conditions LIKE ?;',
        patientId,
        like,
      )
      .map((r) => r.chunk_id);
    if (ids.length) deleteEdgesForChunks(ids);
    const result = db.runSync(
      'DELETE FROM knowledge_cache WHERE patient_id = ? AND conditions LIKE ?;',
      patientId,
      like,
    );
    return result.changes;
  }
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
  patientId?: string,
): number {
  const db = getDatabase();
  const like = `%"documentType":"${documentType}"%`;
  if (patientId?.trim()) {
    const ids = db
      .getAllSync<{ chunk_id: string }>(
        `SELECT chunk_id FROM knowledge_cache
         WHERE patient_id = ? AND metadata_json LIKE ?;`,
        patientId,
        like,
      )
      .map((r) => r.chunk_id);
    if (ids.length) deleteEdgesForChunks(ids);
    const result = db.runSync(
      `DELETE FROM knowledge_cache
       WHERE patient_id = ? AND metadata_json LIKE ?;`,
      patientId,
      like,
    );
    return result.changes;
  }
  const ids = db
    .getAllSync<{ chunk_id: string }>(
      `SELECT chunk_id FROM knowledge_cache WHERE metadata_json LIKE ?;`,
      like,
    )
    .map((r) => r.chunk_id);
  if (ids.length) deleteEdgesForChunks(ids);
  const result = db.runSync(
    `DELETE FROM knowledge_cache WHERE metadata_json LIKE ?;`,
    like,
  );
  return result.changes;
}

export function getKnowledgeChunkForExport(chunkId: string): KnowledgeChunk | null {
  return getKnowledgeChunk(chunkId);
}

export function clearExpiredKnowledgeChunks(patientId?: string): number {
  const db = getDatabase();
  const now = new Date().toISOString();
  if (patientId?.trim()) {
    const expired = db.getAllSync<{ chunk_id: string }>(
      `SELECT chunk_id FROM knowledge_cache
       WHERE patient_id = ? AND expires_at IS NOT NULL AND expires_at < ?;`,
      patientId,
      now,
    );
    const ids = expired.map((r) => r.chunk_id);
    if (ids.length) deleteEdgesForChunks(ids);
    const result = db.runSync(
      `DELETE FROM knowledge_cache
       WHERE patient_id = ? AND expires_at IS NOT NULL AND expires_at < ?;`,
      patientId,
      now,
    );
    return result.changes;
  }
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
  byPatient?: Record<string, number>;
}

export function getKnowledgeCacheStats(patientId?: string): KnowledgeCacheStats {
  const db = getDatabase();
  if (patientId?.trim()) {
    const totalRow = db.getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM knowledge_cache WHERE patient_id = ?;',
      patientId,
    );
    const bySourceRows = db.getAllSync<{ source: string; count: number }>(
      `SELECT source, COUNT(*) AS count FROM knowledge_cache
       WHERE patient_id = ? GROUP BY source;`,
      patientId,
    );
    const bySource: Record<string, number> = {};
    for (const row of bySourceRows) {
      bySource[row.source] = row.count;
    }
    return { total: totalRow?.count ?? 0, bySource };
  }
  const totalRow = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM knowledge_cache;',
  );
  const bySourceRows = db.getAllSync<{ source: string; count: number }>(
    'SELECT source, COUNT(*) AS count FROM knowledge_cache GROUP BY source;',
  );
  const byPatientRows = db.getAllSync<{ patient_id: string | null; count: number }>(
    `SELECT patient_id, COUNT(*) AS count FROM knowledge_cache GROUP BY patient_id;`,
  );
  const bySource: Record<string, number> = {};
  for (const row of bySourceRows) {
    bySource[row.source] = row.count;
  }
  const byPatient: Record<string, number> = {};
  for (const row of byPatientRows) {
    byPatient[row.patient_id?.trim() || '(orphan)'] = row.count;
  }
  return {
    total: totalRow?.count ?? 0,
    bySource,
    byPatient,
  };
}

// ---------------------------------------------------------------------------
// Relevance feedback (per-patient NLU tuning)
// ---------------------------------------------------------------------------

function signalToScore(signal: KnowledgeFeedbackSignal): number {
  if (signal === 'useful') return 1;
  if (signal === 'not_useful') return -1;
  return 0;
}

export function recordKnowledgeChunkFeedback(input: {
  patientId: string;
  chunkId: string;
  signal: KnowledgeFeedbackSignal;
  note?: string;
}): KnowledgeChunkFeedback {
  const patientId = input.patientId.trim();
  const chunkId = input.chunkId.trim();
  if (!patientId || !chunkId) {
    throw new Error('recordKnowledgeChunkFeedback requires patientId and chunkId');
  }
  const now = new Date().toISOString();
  const feedback: KnowledgeChunkFeedback = {
    feedbackId: `kcf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    patientId,
    chunkId,
    signal: input.signal,
    createdAt: now,
    note: input.note,
  };
  const db = getDatabase();
  db.runSync(
    `INSERT INTO knowledge_chunk_feedback
      (feedback_id, patient_id, chunk_id, signal, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
    feedback.feedbackId,
    feedback.patientId,
    feedback.chunkId,
    feedback.signal,
    feedback.note ?? null,
    feedback.createdAt,
  );
  // Aggregate latest score onto the chunk row for fast BM25 boost.
  db.runSync(
    `UPDATE knowledge_cache
     SET feedback_score = ?
     WHERE chunk_id = ? AND patient_id = ?;`,
    signalToScore(input.signal),
    chunkId,
    patientId,
  );
  return feedback;
}

export function getKnowledgeFeedbackForPatient(
  patientId: string,
  limit = 50,
): KnowledgeChunkFeedback[] {
  if (!patientId.trim()) return [];
  const db = getDatabase();
  return db.getAllSync<KnowledgeChunkFeedback>(
    `SELECT feedback_id AS feedbackId, patient_id AS patientId, chunk_id AS chunkId,
            signal, note, created_at AS createdAt
     FROM knowledge_chunk_feedback
     WHERE patient_id = ?
     ORDER BY created_at DESC
     LIMIT ?;`,
    patientId,
    limit,
  );
}
