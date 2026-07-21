import { getDatabase } from '@/data/db';
import type { UC4StructuredEvent } from '@/ml-models/uc4-micro-priorities';

export interface Uc4RecentEventRow {
  event_id: string;
  patient_id: string;
  timestamp_iso: string;
  source: string;
  observation_codes_json: string;
  context_codes_json: string;
  severity: number | null;
  free_text_used_for_scoring: number;
  free_text_provider_context: string | null;
  metadata_json: string | null;
  created_at: string;
}

export function insertUc4RecentEvent(event: UC4StructuredEvent & { eventId: string }): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `INSERT INTO uc4_recent_events (
      event_id, patient_id, timestamp_iso, source,
      observation_codes_json, context_codes_json, severity,
      free_text_used_for_scoring, free_text_provider_context, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    event.eventId, event.patientId, event.timestampIso, event.source,
    JSON.stringify(event.observationCodes), JSON.stringify(event.contextCodes),
    event.severity ?? null, event.freeTextUsedForScoring ? 1 : 0,
    event.freeTextProviderContext ?? null, event.metadata ? JSON.stringify(event.metadata) : null,
    now,
  );
}

export function getRecentUc4Events(patientId: string, limit = 20): UC4StructuredEvent[] {
  try {
    const db = getDatabase();
    const rows = db.getAllSync<Uc4RecentEventRow>(
      `SELECT * FROM uc4_recent_events
       WHERE patient_id = ?
       ORDER BY timestamp_iso DESC
       LIMIT ?;`,
      patientId, limit,
    );
    return rows.map((row) => ({
      eventId: row.event_id,
      patientId: row.patient_id,
      timestampIso: row.timestamp_iso,
      source: row.source as UC4StructuredEvent['source'],
      observationCodes: JSON.parse(row.observation_codes_json),
      contextCodes: JSON.parse(row.context_codes_json),
      severity: row.severity as UC4StructuredEvent['severity'],
      freeTextUsedForScoring: false,
      freeTextProviderContext: row.free_text_provider_context ?? undefined,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    }));
  } catch {
    return [];
  }
}
