import { getDatabase } from '@/data/db';
import type { LatestUc4CardSummary } from '@/data/repositories/patientRecordRepository';

export interface Uc4PriorityCardRow {
  card_id: string;
  patient_id: string;
  run_id: string;
  template_id: string;
  priority_kind: string | null;
  title: string;
  summary: string;
  body: string;
  why_this_matters: string | null;
  what_to_log_next_json: string;
  what_to_log_next_schema_json: string;
  evidence_json: string;
  score: number;
  score_trace_json: string | null;
  safety_tags_json: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function insertUc4PriorityCards(
  patientId: string,
  runId: string,
  cards: {
    cardId: string;
    templateId: string;
    priorityKind: string | null;
    title: string;
    summary: string;
    body: string;
    whyThisMatters?: string | null;
    whatToLogNextJson: string;
    whatToLogNextSchemaJson: string;
    evidenceJson: string;
    score: number;
    scoreTraceJson?: string | null;
    safetyTagsJson: string;
  }[],
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  for (const card of cards) {
    db.runSync(
      `INSERT OR REPLACE INTO uc4_priority_cards (
        card_id, patient_id, run_id, template_id, priority_kind,
        title, summary, body, why_this_matters,
        what_to_log_next_json, what_to_log_next_schema_json,
        evidence_json, score, score_trace_json, safety_tags_json,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      card.cardId, patientId, runId, card.templateId, card.priorityKind,
      card.title, card.summary, card.body, card.whyThisMatters ?? null,
      card.whatToLogNextJson, card.whatToLogNextSchemaJson,
      card.evidenceJson, card.score, card.scoreTraceJson ?? null, card.safetyTagsJson,
      'active', now, now,
    );
  }
}

export function supersedeActiveUc4Cards(patientId: string, exceptRunId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `UPDATE uc4_priority_cards
     SET status = 'superseded', updated_at = ?
     WHERE patient_id = ? AND status = 'active' AND run_id != ?;`,
    now, patientId, exceptRunId,
  );
}

export function getActiveUc4CardSummaries(
  patientId: string,
  limit = 3,
): LatestUc4CardSummary[] {
  try {
    const db = getDatabase();
    const rows = db.getAllSync<Uc4PriorityCardRow>(
      `SELECT * FROM uc4_priority_cards
       WHERE patient_id = ? AND status = 'active'
       ORDER BY score DESC
       LIMIT ?;`,
      patientId, limit,
    );
    return rows.map((row) => ({
      cardId: row.card_id,
      templateId: row.template_id,
      title: row.title,
      summary: row.summary,
      score: row.score,
      status: row.status,
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}

export function acknowledgeUc4Card(cardId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `UPDATE uc4_priority_cards SET status = 'acknowledged', updated_at = ? WHERE card_id = ?;`,
    now, cardId,
  );
}

export function dismissUc4Card(cardId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `UPDATE uc4_priority_cards SET status = 'dismissed', updated_at = ? WHERE card_id = ?;`,
    now, cardId,
  );
}

export function getUc4CardById(cardId: string): Uc4PriorityCardRow | null {
  try {
    const db = getDatabase();
    return (
      db.getFirstSync<Uc4PriorityCardRow>(
        `SELECT * FROM uc4_priority_cards WHERE card_id = ?;`,
        cardId,
      ) ?? null
    );
  } catch {
    return null;
  }
}

export function getActiveUc4Cards(
  patientId: string,
  limit = 10,
): Uc4PriorityCardRow[] {
  try {
    const db = getDatabase();
    return db.getAllSync<Uc4PriorityCardRow>(
      `SELECT * FROM uc4_priority_cards
       WHERE patient_id = ? AND status = 'active'
       ORDER BY score DESC
       LIMIT ?;`,
      patientId,
      limit,
    );
  } catch {
    return [];
  }
}
