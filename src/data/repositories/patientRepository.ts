/**
 * Repository for patient / caregiver / medication identity data.
 *
 * In v1 this is seeded from the onboarding profile. In later phases it can
 * be populated from FHIR or a PCP care plan import.
 */

import { getDatabase } from '../db';
import type { Caregiver, Medication, Patient, PatientCondition, PatientConditionRole } from '../types';

export function upsertPatient(patient: Patient): void {
  const db = getDatabase();
  db.runSync(
    `INSERT INTO patients
      (patient_id, name, age, conditions, baseline_daily_routine, current_medications,
       spo2_cutoff, baseline_heart_rate, baseline_blood_oxygen,
       baseline_respiratory_rate, baseline_blood_pressure_systolic,
       baseline_blood_pressure_diastolic, baseline_glucose_level,
       baseline_body_temperature, preferred_name, gmfcs, fms, macs, cfcs,
       edacs, location, safety_notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(patient_id) DO UPDATE SET
       name = COALESCE(NULLIF(excluded.name, ''), patients.name),
       age = COALESCE(NULLIF(excluded.age, ''), patients.age),
       conditions = COALESCE(NULLIF(excluded.conditions, ''), patients.conditions),
       baseline_daily_routine = COALESCE(NULLIF(excluded.baseline_daily_routine, ''), patients.baseline_daily_routine),
       current_medications = COALESCE(NULLIF(excluded.current_medications, ''), patients.current_medications),
       spo2_cutoff = COALESCE(NULLIF(excluded.spo2_cutoff, ''), patients.spo2_cutoff),
       baseline_heart_rate = COALESCE(NULLIF(excluded.baseline_heart_rate, ''), patients.baseline_heart_rate),
       baseline_blood_oxygen = COALESCE(NULLIF(excluded.baseline_blood_oxygen, ''), patients.baseline_blood_oxygen),
       baseline_respiratory_rate = COALESCE(NULLIF(excluded.baseline_respiratory_rate, ''), patients.baseline_respiratory_rate),
       baseline_blood_pressure_systolic = COALESCE(NULLIF(excluded.baseline_blood_pressure_systolic, ''), patients.baseline_blood_pressure_systolic),
       baseline_blood_pressure_diastolic = COALESCE(NULLIF(excluded.baseline_blood_pressure_diastolic, ''), patients.baseline_blood_pressure_diastolic),
       baseline_glucose_level = COALESCE(NULLIF(excluded.baseline_glucose_level, ''), patients.baseline_glucose_level),
       baseline_body_temperature = COALESCE(NULLIF(excluded.baseline_body_temperature, ''), patients.baseline_body_temperature),
       preferred_name = COALESCE(NULLIF(excluded.preferred_name, ''), patients.preferred_name),
       gmfcs = COALESCE(NULLIF(excluded.gmfcs, ''), patients.gmfcs),
       fms = COALESCE(NULLIF(excluded.fms, ''), patients.fms),
       macs = COALESCE(NULLIF(excluded.macs, ''), patients.macs),
       cfcs = COALESCE(NULLIF(excluded.cfcs, ''), patients.cfcs),
       edacs = COALESCE(NULLIF(excluded.edacs, ''), patients.edacs),
       location = COALESCE(NULLIF(excluded.location, ''), patients.location),
       safety_notes = COALESCE(NULLIF(patients.safety_notes, ''), NULLIF(excluded.safety_notes, ''), patients.safety_notes),
       updated_at = excluded.updated_at;`,
    patient.patientId,
    patient.name,
    patient.age ?? null,
    patient.conditions ?? null,
    patient.baselineDailyRoutine ?? null,
    patient.currentMedications ?? null,
    patient.spo2Cutoff ?? null,
    patient.baselineHeartRate ?? null,
    patient.baselineBloodOxygen ?? null,
    patient.baselineRespiratoryRate ?? null,
    patient.baselineBloodPressureSystolic ?? null,
    patient.baselineBloodPressureDiastolic ?? null,
    patient.baselineGlucoseLevel ?? null,
    patient.baselineBodyTemperature ?? null,
    patient.preferredName ?? null,
    patient.gmfcs ?? null,
    patient.fms ?? null,
    patient.macs ?? null,
    patient.cfcs ?? null,
    patient.edacs ?? null,
    patient.location ?? null,
    patient.safetyNotes ?? null,
    patient.createdAt,
    patient.updatedAt,
  );
}

export function getPatient(patientId: string): Patient | null {
  const db = getDatabase();
  return (
    db.getFirstSync<Patient>(
      `SELECT patient_id AS patientId, name, age, conditions, baseline_daily_routine AS baselineDailyRoutine,
              current_medications AS currentMedications, spo2_cutoff AS spo2Cutoff,
              baseline_heart_rate AS baselineHeartRate, preferred_name AS preferredName,
              baseline_blood_oxygen AS baselineBloodOxygen,
              baseline_respiratory_rate AS baselineRespiratoryRate,
              baseline_blood_pressure_systolic AS baselineBloodPressureSystolic,
              baseline_blood_pressure_diastolic AS baselineBloodPressureDiastolic,
              baseline_glucose_level AS baselineGlucoseLevel,
              baseline_body_temperature AS baselineBodyTemperature,
              gmfcs, fms, macs, cfcs, edacs, location, safety_notes AS safetyNotes,
              created_at AS createdAt, updated_at AS updatedAt
       FROM patients WHERE patient_id = ?;`,
      patientId,
    ) ?? null
  );
}

export function upsertCaregiver(caregiver: Caregiver): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO caregivers
      (caregiver_id, patient_id, name, relationship, experience, availability, language_preference,
       medical_comfort_level, hobbies_or_routines, main_concern, stress_or_support_needs,
       backup_caregiver, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    caregiver.caregiverId,
    caregiver.patientId,
    caregiver.name,
    caregiver.relationship ?? null,
    caregiver.experience ?? null,
    caregiver.availability ?? null,
    caregiver.languagePreference ?? null,
    caregiver.medicalComfortLevel ?? null,
    caregiver.hobbiesOrRoutines ?? null,
    caregiver.mainConcern ?? null,
    caregiver.stressOrSupportNeeds ?? null,
    caregiver.backupCaregiver ?? null,
    caregiver.createdAt,
  );
}

export function getCaregiverForPatient(patientId: string): Caregiver | null {
  const db = getDatabase();
  return (
    db.getFirstSync<Caregiver>(
      `SELECT caregiver_id AS caregiverId, patient_id AS patientId, name, relationship,
              experience, availability, language_preference AS languagePreference,
              medical_comfort_level AS medicalComfortLevel, hobbies_or_routines AS hobbiesOrRoutines,
              main_concern AS mainConcern, stress_or_support_needs AS stressOrSupportNeeds,
              backup_caregiver AS backupCaregiver, created_at AS createdAt
       FROM caregivers WHERE patient_id = ? LIMIT 1;`,
      patientId,
    ) ?? null
  );
}

export function upsertMedication(med: Medication): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO medications
      (medication_id, patient_id, name, dosage, frequency, route, indication, active, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    med.medicationId,
    med.patientId,
    med.name,
    med.dosage ?? null,
    med.frequency ?? null,
    med.route ?? null,
    med.indication ?? null,
    med.active ? 1 : 0,
    med.source ?? 'care_plan',
  );
}

export function getActiveMedications(patientId: string): Medication[] {
  const db = getDatabase();
  return db.getAllSync<Medication>(
    `SELECT medication_id AS medicationId, patient_id AS patientId, name, dosage, frequency,
            route, indication, active, source
     FROM medications
     WHERE patient_id = ? AND active = 1
     ORDER BY (source = 'custom'), name;`,
    patientId,
  );
}

export function getMedicationById(medicationId: string): Medication | null {
  const db = getDatabase();
  return (
    db.getFirstSync<Medication>(
      `SELECT medication_id AS medicationId, patient_id AS patientId, name, dosage, frequency,
              route, indication, active, source
       FROM medications WHERE medication_id = ?;`,
      medicationId,
    ) ?? null
  );
}

/**
 * Active medications across every stored patient record (read-only).
 * Used for device-global knowledge pack inputs so profile switches never
 * re-download shared medication content.
 */
export function getAllActiveMedications(): Medication[] {
  const db = getDatabase();
  return db.getAllSync<Medication>(
    `SELECT medication_id AS medicationId, patient_id AS patientId, name, dosage, frequency,
            route, indication, active, source
     FROM medications
     WHERE active = 1
     ORDER BY name;`,
  );
}

/** Soft-delete (deactivate) a medication. Hard-delete is reserved for custom meds. */
export function deleteMedication(medicationId: string, hard = false): void {
  const db = getDatabase();
  if (hard) {
    db.runSync('DELETE FROM medications WHERE medication_id = ?;', medicationId);
    db.runSync('DELETE FROM medication_schedules WHERE medication_id = ?;', medicationId);
  } else {
    db.runSync('UPDATE medications SET active = 0 WHERE medication_id = ?;', medicationId);
  }
}

/**
 * Hard-delete all care-plan (`source = 'care_plan'`) medications for a patient
 * and their schedules. Used by the seeder to make medication re-seeding
 * idempotent (mirrors `deleteConditionsForPatient`). Caregiver-added custom
 * medications (`source = 'custom'`) are preserved across re-seeds.
 */
export function deleteCarePlanMedicationsForPatient(patientId: string): void {
  const db = getDatabase();
  db.runSync(
    `DELETE FROM medication_schedules
     WHERE medication_id IN (
       SELECT medication_id FROM medications
       WHERE patient_id = ? AND source = 'care_plan'
     );`,
    patientId,
  );
  db.runSync(
    `DELETE FROM medications WHERE patient_id = ? AND source = 'care_plan';`,
    patientId,
  );
}

export function upsertCondition(condition: PatientCondition): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO patient_conditions
      (condition_id, patient_id, name, icd10, snomed_code, onset_date,
       category, is_primary, source, source_doc_id, retrieved_at, needs_review,
       condition_role, source_references_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    condition.conditionId,
    condition.patientId,
    condition.name,
    condition.icd10 ?? null,
    condition.snomedCode ?? null,
    condition.onsetDate ?? null,
    condition.category ?? null,
    condition.isPrimary ? 1 : 0,
    condition.source ?? 'onboarding',
    condition.sourceDocId ?? null,
    condition.retrievedAt ?? null,
    condition.needsReview ? 1 : 0,
    condition.conditionRole ?? null,
    condition.sourceReferences ? JSON.stringify(condition.sourceReferences) : null,
  );
}

type PatientConditionRow = PatientCondition & {
  isPrimary?: number | boolean;
  needsReview?: number | boolean;
  sourceReferencesJson?: string | null;
};

export function getConditionsForPatient(patientId: string): PatientCondition[] {
  const db = getDatabase();
  const rows = db.getAllSync<PatientConditionRow>(
    `SELECT condition_id AS conditionId, patient_id AS patientId, name, icd10,
            snomed_code AS snomedCode,
            onset_date AS onsetDate, category, is_primary AS isPrimary,
            source, source_doc_id AS sourceDocId, retrieved_at AS retrievedAt,
            needs_review AS needsReview, condition_role AS conditionRole,
            source_references_json AS sourceReferencesJson
     FROM patient_conditions
     WHERE patient_id = ?
     ORDER BY is_primary DESC,
              CASE WHEN lower(name) LIKE '%cerebral palsy%' THEN 0 ELSE 1 END,
              needs_review ASC,
              name;`,
    patientId,
  );
  return rows.map((row) => {
    const { sourceReferencesJson, ...condition } = row;
    return {
      ...condition,
      isPrimary: Boolean(row.isPrimary),
      needsReview: Boolean(row.needsReview),
      sourceReferences: parseConditionSourceReferences(sourceReferencesJson),
    };
  });
}

/**
 * Conditions across every stored patient record (read-only).
 * Used for device-global knowledge pack inputs (union with global seeds).
 */
export function getAllConditions(): PatientCondition[] {
  const db = getDatabase();
  const rows = db.getAllSync<PatientConditionRow>(
    `SELECT condition_id AS conditionId, patient_id AS patientId, name, icd10,
            snomed_code AS snomedCode,
            onset_date AS onsetDate, category, is_primary AS isPrimary,
            source, source_doc_id AS sourceDocId, retrieved_at AS retrievedAt,
            needs_review AS needsReview, condition_role AS conditionRole,
            source_references_json AS sourceReferencesJson
     FROM patient_conditions
     ORDER BY name;`,
  );
  return rows.map((row) => {
    const { sourceReferencesJson, ...condition } = row;
    return {
      ...condition,
      isPrimary: Boolean(row.isPrimary),
      needsReview: Boolean(row.needsReview),
      sourceReferences: parseConditionSourceReferences(sourceReferencesJson),
    };
  });
}

export function updatePatientConditionRoles(
  patientId: string,
  rolesByConditionId: Record<string, PatientConditionRole>,
): void {
  const db = getDatabase();
  db.withTransactionSync(() => {
    const conditions = getConditionsForPatient(patientId);
    for (const condition of conditions) {
      db.runSync(
        `UPDATE patient_conditions
         SET condition_role = ?,
             is_primary = ?
         WHERE patient_id = ? AND condition_id = ?;`,
        rolesByConditionId[condition.conditionId] ?? 'history_context',
        rolesByConditionId[condition.conditionId] === 'primary_diagnosis' ? 1 : 0,
        patientId,
        condition.conditionId,
      );
    }
  });
}

function parseConditionSourceReferences(
  value?: string | null,
): PatientCondition['sourceReferences'] {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Mark a MedlinePlus-suggested comorbidity as confirmed by the caregiver. */
export function confirmPendingCondition(conditionId: string): void {
  const db = getDatabase();
  db.runSync(
    'UPDATE patient_conditions SET needs_review = 0 WHERE condition_id = ?;',
    conditionId,
  );
}

/** Remove a MedlinePlus-suggested comorbidity the caregiver dismissed. */
export function deleteCondition(conditionId: string): void {
  const db = getDatabase();
  db.runSync('DELETE FROM patient_conditions WHERE condition_id = ?;', conditionId);
}

/** Remove onboarding-seeded conditions for a patient while preserving imported review rows. */
export function deleteConditionsForPatient(patientId: string): void {
  const db = getDatabase();
  db.runSync(
    `DELETE FROM patient_conditions
     WHERE patient_id = ? AND COALESCE(source, 'onboarding') = 'onboarding';`,
    patientId,
  );
}
