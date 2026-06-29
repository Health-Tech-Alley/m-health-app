import { getDatabase } from '../db';
import type {
  LongitudinalObservationType,
  PatientLongitudinalObservation,
} from '../types';

type DatabaseLike = ReturnType<typeof getDatabase>;

export function upsertPatientLongitudinalObservation(
  observation: PatientLongitudinalObservation,
  db: DatabaseLike = getDatabase(),
): void {
  db.runSync(
    `INSERT INTO patient_longitudinal_observations
      (patient_id, observation_id, measurement_type, recorded_at, encounter_id,
       numeric_value, text_value, unit, source_system, source_code, source_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(patient_id, observation_id) DO UPDATE SET
       measurement_type = excluded.measurement_type,
       recorded_at = excluded.recorded_at,
       encounter_id = excluded.encounter_id,
       numeric_value = excluded.numeric_value,
       text_value = excluded.text_value,
       unit = excluded.unit,
       source_system = excluded.source_system,
       source_code = excluded.source_code,
       source_type = excluded.source_type;`,
    observation.patientId,
    observation.observationId,
    observation.measurementType,
    observation.recordedAt,
    observation.encounterId ?? null,
    observation.numericValue ?? null,
    observation.textValue ?? null,
    observation.unit ?? null,
    observation.sourceSystem ?? null,
    observation.sourceCode,
    observation.sourceType,
  );
}

export function getPatientLongitudinalObservations(
  patientId: string,
  measurementType?: LongitudinalObservationType,
): PatientLongitudinalObservation[] {
  const db = getDatabase();
  const where = measurementType
    ? 'WHERE patient_id = ? AND measurement_type = ?'
    : 'WHERE patient_id = ?';
  const params = measurementType ? [patientId, measurementType] : [patientId];

  return db.getAllSync<PatientLongitudinalObservation>(
    `SELECT patient_id AS patientId,
            observation_id AS observationId,
            measurement_type AS measurementType,
            recorded_at AS recordedAt,
            encounter_id AS encounterId,
            numeric_value AS numericValue,
            text_value AS textValue,
            unit,
            source_system AS sourceSystem,
            source_code AS sourceCode,
            source_type AS sourceType
     FROM patient_longitudinal_observations
     ${where}
     ORDER BY recorded_at ASC, observation_id ASC;`,
    ...params,
  );
}

export function countPatientLongitudinalObservations(
  patientId: string,
  measurementType?: LongitudinalObservationType,
): number {
  const db = getDatabase();
  const row = measurementType
    ? db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM patient_longitudinal_observations
         WHERE patient_id = ? AND measurement_type = ?;`,
        patientId,
        measurementType,
      )
    : db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM patient_longitudinal_observations
         WHERE patient_id = ?;`,
        patientId,
      );

  return row?.count ?? 0;
}
