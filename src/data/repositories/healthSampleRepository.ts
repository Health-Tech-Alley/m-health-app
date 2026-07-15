import { getDatabase } from '../db';
import type { HealthSample, HealthSampleType } from '../types';

export function insertHealthSample(sample: HealthSample): void {
  const db = getDatabase();

  let value = sample.value;
  let unit = sample.unit;
  if (sample.type === 'spo2' && value <= 1.0) {
    value = value * 100;
    unit = '%';
  }

  db.runSync(
    `INSERT OR REPLACE INTO health_samples
      (sample_id, patient_id, source, type, value, value_json, unit, recorded_at, received_at, metadata_json, source_doc_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    sample.sampleId,
    sample.patientId,
    sample.source,
    sample.type,
    value,
    sample.valueJson ?? null,
    unit,
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

export function getSyncCursor(source: string, type: HealthSampleType): string | null {
  const db = getDatabase();
  const row = db.getFirstSync<{ last_cursor: string }>(
    `SELECT last_cursor FROM health_sync_state WHERE type = ?;`,
    `${source}:${type}`,
  );
  return row?.last_cursor ?? null;
}

export function setSyncCursor(source: string, type: HealthSampleType, cursor: string): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO health_sync_state (type, last_cursor) VALUES (?, ?);`,
    `${source}:${type}`,
    cursor,
  );
}

export function clearSyncCursor(source: string, type: HealthSampleType): void {
  const db = getDatabase();
  db.runSync(
    `DELETE FROM health_sync_state WHERE type = ?;`,
    `${source}:${type}`,
  );
}

// healthSampleRepository.ts — add this alongside insertHealthSample
export function insertHealthSamplesBatched(samples: HealthSample[]): void {
  if (samples.length === 0) return;
  const db = getDatabase();
  db.withTransactionSync(() => {
    for (const sample of samples) {
      let value = sample.value;
      let unit = sample.unit;
      if (sample.type === 'spo2' && value <= 1.0) {
        value = value * 100;
        unit = '%';
      }
      db.runSync(
        `INSERT OR REPLACE INTO health_samples
          (sample_id, patient_id, source, type, value, value_json, unit, recorded_at, received_at, metadata_json, source_doc_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        sample.sampleId,
        sample.patientId,
        sample.source,
        sample.type,
        value,
        sample.valueJson ?? null,
        unit,
        sample.recordedAt,
        sample.receivedAt,
        sample.metadataJson ?? null,
        sample.sourceDocId ?? null,
      );
    }
  });
}
