/**
 * Repository for alert thresholds.
 */

import { getDatabase } from '../db';
import type { Threshold } from '../types';

export function insertThreshold(threshold: Threshold): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO thresholds
      (threshold_id, patient_id, vital_type, value, direction, severity, source, citation_id, created_at, superseded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    threshold.thresholdId,
    threshold.patientId,
    threshold.vitalType,
    threshold.value,
    threshold.direction,
    threshold.severity,
    threshold.source,
    threshold.citationId ?? null,
    threshold.createdAt,
    threshold.supersededAt ?? null,
  );
}

export function getActiveThresholds(patientId: string): Threshold[] {
  const db = getDatabase();
  return db.getAllSync<Threshold>(
    `SELECT threshold_id AS thresholdId, patient_id AS patientId, vital_type AS vitalType,
            value, direction, severity, source, citation_id AS citationId,
            created_at AS createdAt, superseded_at AS supersededAt
     FROM thresholds
     WHERE patient_id = ? AND superseded_at IS NULL
     ORDER BY vital_type, severity DESC;`,
    patientId,
  );
}

export function getActiveThresholdsForVital(
  patientId: string,
  vitalType: string,
): Threshold[] {
  const db = getDatabase();
  return db.getAllSync<Threshold>(
    `SELECT threshold_id AS thresholdId, patient_id AS patientId, vital_type AS vitalType,
            value, direction, severity, source, citation_id AS citationId,
            created_at AS createdAt, superseded_at AS supersededAt
     FROM thresholds
     WHERE patient_id = ? AND vital_type = ? AND superseded_at IS NULL
     ORDER BY severity DESC;`,
    patientId,
    vitalType,
  );
}

/** Mark all active thresholds for a vital as superseded, then insert the new one. */
export function replaceThresholdsForVital(
  patientId: string,
  vitalType: string,
  newThresholds: Threshold[],
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    'UPDATE thresholds SET superseded_at = ? WHERE patient_id = ? AND vital_type = ? AND superseded_at IS NULL;',
    now,
    patientId,
    vitalType,
  );
  for (const t of newThresholds) {
    insertThreshold(t);
  }
}
