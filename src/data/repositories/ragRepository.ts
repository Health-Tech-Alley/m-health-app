/**
 * Repository for RAG citations and SLM turns.
 */

import { getDatabase } from '../db';
import type { RagCitation, SlmTurn } from '../types';

export function insertCitation(citation: RagCitation): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO rag_citations
      (citation_id, doc_id, source, text, retrieved_at, use_count)
     VALUES (?, ?, ?, ?, ?, ?);`,
    citation.citationId,
    citation.docId,
    citation.source,
    citation.text,
    citation.retrievedAt,
    citation.useCount,
  );
}

export function bumpCitationUseCount(citationId: string): void {
  const db = getDatabase();
  db.runSync(
    'UPDATE rag_citations SET use_count = use_count + 1 WHERE citation_id = ?;',
    citationId,
  );
}

export function getCitationByDocId(docId: string): RagCitation | null {
  const db = getDatabase();
  return (
    db.getFirstSync<RagCitation>(
      `SELECT citation_id AS citationId, doc_id AS docId, source, text,
              retrieved_at AS retrievedAt, use_count AS useCount
       FROM rag_citations WHERE doc_id = ?;`,
      docId,
    ) ?? null
  );
}

export function insertSlmTurn(turn: SlmTurn, citationIds: string[]): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO slm_turns
      (turn_id, alert_id, patient_id, model_id, prompt_hash, response_hash, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    turn.turnId,
    turn.alertId ?? null,
    turn.patientId,
    turn.modelId ?? null,
    turn.promptHash ?? null,
    turn.responseHash ?? null,
    turn.latencyMs ?? null,
    turn.createdAt,
  );
  for (const cid of citationIds) {
    db.runSync(
      'INSERT OR IGNORE INTO slm_citations (turn_id, citation_id) VALUES (?, ?);',
      turn.turnId,
      cid,
    );
    bumpCitationUseCount(cid);
  }
}
