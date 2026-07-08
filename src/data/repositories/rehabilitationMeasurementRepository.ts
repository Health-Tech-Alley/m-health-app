import { getDatabase } from '../db';
import type { RehabilitationMeasurement, RehabilitationMeasurementType } from '../types';

type DatabaseLike = ReturnType<typeof getDatabase>;

export function upsertRehabilitationMeasurement(
  measurement: RehabilitationMeasurement,
  db: DatabaseLike = getDatabase(),
): void {
  db.runSync(
    `INSERT OR REPLACE INTO rehabilitation_measurements
      (measurement_id, patient_id, type, value, unit, recorded_at, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    measurement.measurementId,
    measurement.patientId,
    measurement.type,
    measurement.value,
    measurement.unit,
    measurement.recordedAt,
    measurement.source,
    measurement.createdAt,
  );
}

export function getRehabilitationMeasurements(
  patientId: string,
  type: RehabilitationMeasurementType,
): RehabilitationMeasurement[] {
  const db = getDatabase();
  return db.getAllSync<RehabilitationMeasurement>(
    `SELECT measurement_id AS measurementId, patient_id AS patientId, type,
            value, unit, recorded_at AS recordedAt, source, created_at AS createdAt
     FROM rehabilitation_measurements
     WHERE patient_id = ? AND type = ?
     ORDER BY recorded_at ASC, measurement_id ASC;`,
    patientId,
    type,
  );
}

/**
 * Get the most-recent measurement for each rehab type (planning/32 §8.4).
 * The SLM's `progressMeasures` block surfaces one row per type so the
 * caregiver can read "Grip strength: 14 kg (last measured 2026-06-30)" in
 * the prompt.
 */
export function getLatestRehabilitationMeasurements(
  patientId: string,
): RehabilitationMeasurement[] {
  const db = getDatabase();
  return db.getAllSync<RehabilitationMeasurement>(
    `SELECT m.measurement_id AS measurementId, m.patient_id AS patientId, m.type,
            m.value, m.unit, m.recorded_at AS recordedAt, m.source, m.created_at AS createdAt
     FROM rehabilitation_measurements m
     INNER JOIN (
       SELECT type, MAX(recorded_at) AS max_recorded
       FROM rehabilitation_measurements
       WHERE patient_id = ?
       GROUP BY type
     ) latest ON latest.type = m.type AND latest.max_recorded = m.recorded_at
     WHERE m.patient_id = ?
     ORDER BY m.type;`,
    patientId,
    patientId,
  );
}

export function countRehabilitationMeasurements(
  patientId: string,
  type: RehabilitationMeasurementType,
): number {
  const db = getDatabase();
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM rehabilitation_measurements
     WHERE patient_id = ? AND type = ?;`,
    patientId,
    type,
  );
  return row?.count ?? 0;
}
