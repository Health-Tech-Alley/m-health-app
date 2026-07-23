/**
 * Repository for the `patient_enrichment_log` table.
 *
 * Tracks every clinical-source enrichment: which field was enriched, which
 * source was used, the de-identified query, the result count, latency, and
 * the chunk IDs written. This makes enrichment observable and auditable per
 * the audit-spine rule in AGENTS.md §5.
 */

import { getDatabase } from '../db';
import type {
  PatientEnrichmentLogEntry,
  EnrichmentField,
} from '../types';

export function insertEnrichmentLogEntry(entry: PatientEnrichmentLogEntry): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO patient_enrichment_log
      (log_id, patient_id, field, resource_id, source, action,
       deidentified_query, result_count, latency_ms, chunk_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    entry.logId,
    entry.patientId,
    entry.field,
    entry.resourceId ?? null,
    entry.source,
    entry.action,
    entry.deidentifiedQuery ?? null,
    entry.resultCount ?? null,
    entry.latencyMs ?? null,
    entry.chunkIds ?? null,
    entry.createdAt,
  );
}

export function getEnrichmentLogForPatient(
  patientId: string,
  limit = 100,
): PatientEnrichmentLogEntry[] {
  const db = getDatabase();
  return db.getAllSync<PatientEnrichmentLogEntry>(
    `SELECT log_id AS logId, patient_id AS patientId, field, resource_id AS resourceId,
            source, action, deidentified_query AS deidentifiedQuery,
            result_count AS resultCount, latency_ms AS latencyMs,
            chunk_ids AS chunkIds, created_at AS createdAt
     FROM patient_enrichment_log
     WHERE patient_id = ?
     ORDER BY created_at DESC
     LIMIT ?;`,
    patientId,
    limit,
  );
}

export function getEnrichmentLogForField(
  patientId: string,
  field: EnrichmentField,
): PatientEnrichmentLogEntry[] {
  const db = getDatabase();
  return db.getAllSync<PatientEnrichmentLogEntry>(
    `SELECT log_id AS logId, patient_id AS patientId, field, resource_id AS resourceId,
            source, action, deidentified_query AS deidentifiedQuery,
            result_count AS resultCount, latency_ms AS latencyMs,
            chunk_ids AS chunkIds, created_at AS createdAt
     FROM patient_enrichment_log
     WHERE patient_id = ? AND field = ?
     ORDER BY created_at DESC;`,
    patientId,
    field,
  );
}

export interface EnrichmentStats {
  total: number;
  bySource: Record<string, number>;
  byAction: Record<string, number>;
  lastRunAt?: string;
}

export function getEnrichmentStats(patientId: string): EnrichmentStats {
  const db = getDatabase();
  const totalRow = db.getFirstSync<{ count: number; last: string | null }>(
    `SELECT COUNT(*) AS count, MAX(created_at) AS last
     FROM patient_enrichment_log WHERE patient_id = ?;`,
    patientId,
  );
  const bySourceRows = db.getAllSync<{ source: string; count: number }>(
    `SELECT source, COUNT(*) AS count FROM patient_enrichment_log
     WHERE patient_id = ? GROUP BY source;`,
    patientId,
  );
  const byActionRows = db.getAllSync<{ action: string; count: number }>(
    `SELECT action, COUNT(*) AS count FROM patient_enrichment_log
     WHERE patient_id = ? GROUP BY action;`,
    patientId,
  );
  const bySource: Record<string, number> = {};
  for (const row of bySourceRows) bySource[row.source] = row.count;
  const byAction: Record<string, number> = {};
  for (const row of byActionRows) byAction[row.action] = row.count;
  return {
    total: totalRow?.count ?? 0,
    bySource,
    byAction,
    lastRunAt: totalRow?.last ?? undefined,
  };
}
