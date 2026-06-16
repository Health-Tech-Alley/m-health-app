/**
 * Repository for patient / caregiver / medication identity data.
 *
 * In v1 this is seeded from the onboarding profile. In later phases it can
 * be populated from FHIR or a PCP care plan import.
 */

import { getDatabase } from '../db';
import type { Caregiver, Medication, Patient, PatientCondition } from '../types';

export function upsertPatient(patient: Patient): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO patients
      (patient_id, name, age, conditions, baseline_daily_routine, current_medications,
       spo2_cutoff, baseline_heart_rate, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    patient.patientId,
    patient.name,
    patient.age ?? null,
    patient.conditions ?? null,
    patient.baselineDailyRoutine ?? null,
    patient.currentMedications ?? null,
    patient.spo2Cutoff ?? null,
    patient.baselineHeartRate ?? null,
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
              baseline_heart_rate AS baselineHeartRate, created_at AS createdAt, updated_at AS updatedAt
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
      (medication_id, patient_id, name, dosage, frequency, route, indication, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    med.medicationId,
    med.patientId,
    med.name,
    med.dosage ?? null,
    med.frequency ?? null,
    med.route ?? null,
    med.indication ?? null,
    med.active ? 1 : 0,
  );
}

export function getActiveMedications(patientId: string): Medication[] {
  const db = getDatabase();
  return db.getAllSync<Medication>(
    `SELECT medication_id AS medicationId, patient_id AS patientId, name, dosage, frequency,
            route, indication, active
     FROM medications
     WHERE patient_id = ? AND active = 1;`,
    patientId,
  );
}

export function upsertCondition(condition: PatientCondition): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO patient_conditions
      (condition_id, patient_id, name, icd10, onset_date)
     VALUES (?, ?, ?, ?, ?);`,
    condition.conditionId,
    condition.patientId,
    condition.name,
    condition.icd10 ?? null,
    condition.onsetDate ?? null,
  );
}

export function getConditionsForPatient(patientId: string): PatientCondition[] {
  const db = getDatabase();
  return db.getAllSync<PatientCondition>(
    `SELECT condition_id AS conditionId, patient_id AS patientId, name, icd10, onset_date AS onsetDate
     FROM patient_conditions
     WHERE patient_id = ?;`,
    patientId,
  );
}
