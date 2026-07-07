/**
 * Repository for health samples (continuous sensor data).
 */

import { getDatabase } from '../db';
import type { HealthSample, HealthSampleType } from '../types';

export function insertHealthSample(sample: HealthSample): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO health_samples
      (sample_id, patient_id, source, type, value, value_json, unit, recorded_at, received_at, metadata_json, source_doc_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    sample.sampleId,
    sample.patientId,
    sample.source,
    sample.type,
    sample.value,
    sample.valueJson ?? null,
    sample.unit,
    sample.recordedAt,
    sample.receivedAt,
    sample.metadataJson ?? null,
    sample.sourceDocId ?? null,
  );
}

export function getRecentHealthSamples(
  patientId: string,
  type: HealthSampleType,
  since: string,
  limit = 100,
): HealthSample[] {
  const db = getDatabase();
  return db.getAllSync<HealthSample>(
    `SELECT sample_id AS sampleId, patient_id AS patientId, source, type, value,
            value_json AS valueJson, unit, recorded_at AS recordedAt, received_at AS receivedAt,
            metadata_json AS metadataJson, source_doc_id AS sourceDocId
     FROM health_samples
     WHERE patient_id = ? AND type = ? AND recorded_at >= ?
     ORDER BY recorded_at DESC
     LIMIT ?;`,
    patientId,
    type,
    since,
    limit,
  );
}

export function getLatestHealthSample(
  patientId: string,
  type: HealthSampleType,
): HealthSample | null {
  const db = getDatabase();
  return (
    db.getFirstSync<HealthSample>(
      `SELECT sample_id AS sampleId, patient_id AS patientId, source, type, value,
              value_json AS valueJson, unit, recorded_at AS recordedAt, received_at AS receivedAt,
              metadata_json AS metadataJson, source_doc_id AS sourceDocId
       FROM health_samples
       WHERE patient_id = ? AND type = ?
       ORDER BY recorded_at DESC
       LIMIT 1;`,
      patientId,
      type,
    ) ?? null
  );
}

export function deleteHealthSamplesOlderThan(cutoff: string): void {
  const db = getDatabase();
  db.runSync('DELETE FROM health_samples WHERE recorded_at < ?;', cutoff);
}


export function getHealthSampleForPatientAndCurrentMonth(patientId: string, type: HealthSampleType): HealthSample[] {
  const db = getDatabase();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const startOfMonthISO = startOfMonth.toISOString();

  return db.getAllSync<HealthSample>(
    `SELECT sample_id AS sampleId, patient_id AS patientId, source, type, value,
            value_json AS valueJson, unit, recorded_at AS recordedAt, received_at AS receivedAt,
            metadata_json AS metadataJson
     FROM health_samples
     WHERE patient_id = ? AND type = ? AND recorded_at >= ?
     ORDER BY recorded_at DESC;`,
    patientId,
    type,
    startOfMonthISO,
  );
}
