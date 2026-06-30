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
