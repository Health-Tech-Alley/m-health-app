/**
 * Denormalized read view over the patient record.
 *
 * The single source of truth consumed by PatientRecordStore
 * (src/contexts/patient-record-context.tsx). Joins patient, caregiver,
 * structured conditions (with ICD codes + comorbidity flags), symptoms,
 * wearable devices, medications, thresholds, care plan goals, and
 * knowledge-cache stats into one typed snapshot.
 *
 * Writes do NOT go through this file — use the individual repositories
 * (patientRepository, symptomRepository, etc.) and then call
 * `getPatientRecordSnapshot` to refresh the store.
 */

import { getDatabase } from '../db';
import type {
  Caregiver,
  CarePlan,
  Medication,
  MedicationConfirmationRequirement,
  Patient,
  PatientCondition,
  Symptom,
  Threshold,
  WearableDevice,
} from '../types';
import { getActiveCarePlanForPatient } from './carePlanRepository';
import { getKnowledgeCacheStats } from './knowledgeCacheRepository';
import { getMedicationConfirmationRequirementsForPatient } from './medicationConfirmationRequirementRepository';
import { getEnrichmentStats } from './patientEnrichmentLogRepository';
import {
  getActiveMedications,
  getCaregiverForPatient,
  getConditionsForPatient,
  getPatient,
} from './patientRepository';
import { getSymptomsForPatient } from './symptomRepository';
import { getActiveThresholds } from './thresholdRepository';
import { getPrimaryWearableForPatient } from './wearableDeviceRepository';

export interface CarePlanGoalSummary {
  goalId: string;
  description: string;
  targetDate?: string;
  status: string;
}

export interface BundleStatus {
  /** 'in_flight' while the bundle is running, 'complete' after a successful run, 'failed' if it errored. */
  state: 'in_flight' | 'complete' | 'failed';
  /** Number of knowledge chunks added by the last bundle run. */
  chunksAdded: number;
  /** Last error message (when state === 'failed'). */
  error?: string;
  /** ISO timestamp of the last status update. */
  updatedAt?: string;
}

export interface PatientRecordSnapshot {
  patient: Patient | null;
  caregiver: Caregiver | null;
  conditions: PatientCondition[]; // structured, with icd10/category/isPrimary/source/needsReview
  comorbidities: PatientCondition[]; // subset where isPrimary === false (or source !== 'onboarding' for primary)
  primaryCondition: PatientCondition | null;
  pendingReviewConditions: PatientCondition[]; // needsReview === true (MedlinePlus suggestions)
  symptoms: Symptom[];
  wearable: WearableDevice | null;
  medications: Medication[];
  medicationConfirmationRequirements: Record<string, MedicationConfirmationRequirement>;
  thresholds: Threshold[];
  carePlan: CarePlan | null;
  carePlanGoals: CarePlanGoalSummary[];
  knowledgeStats: { total: number; bySource: Record<string, number> };
  enrichmentStats: {
    total: number;
    bySource: Record<string, number>;
    lastRunAt?: string;
  };
  bundlePending: boolean;
  bundleStatus: BundleStatus;
  lastRefreshedAt: string;
}

function getCarePlanGoals(patientId: string): CarePlanGoalSummary[] {
  try {
    const db = getDatabase();
    return db.getAllSync<CarePlanGoalSummary>(
      `SELECT g.goal_id AS goalId, g.description, g.target_date AS targetDate, g.status
       FROM care_plan_goals g
       JOIN care_plans p ON g.plan_id = p.plan_id
       WHERE p.patient_id = ? AND g.status = 'active'
       ORDER BY g.target_date;`,
      patientId,
    );
  } catch {
    return [];
  }
}

export function setBundlePending(patientId: string, pending: boolean): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?);`,
    `bundle_pending:${patientId}`,
    JSON.stringify(pending),
    now,
  );
}

const DEFAULT_BUNDLE_STATUS: BundleStatus = { state: 'complete', chunksAdded: 0 };

export function getBundleStatus(patientId: string): BundleStatus {
  try {
    const db = getDatabase();
    const row = db.getFirstSync<{ value_json: string }>(
      `SELECT value_json FROM app_settings WHERE key = ?;`,
      `bundle_status:${patientId}`,
    );
    if (!row?.value_json) return DEFAULT_BUNDLE_STATUS;
    const parsed = JSON.parse(row.value_json) as BundleStatus;
    if (!parsed || typeof parsed.state !== 'string') return DEFAULT_BUNDLE_STATUS;
    return parsed;
  } catch {
    return DEFAULT_BUNDLE_STATUS;
  }
}

export function setBundleStatus(patientId: string, status: BundleStatus): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?);`,
    `bundle_status:${patientId}`,
    JSON.stringify({ ...status, updatedAt: now }),
    now,
  );
}

/**
 * Read the full patient record in one shot. Individual repository calls are
 * sequential against the same SQLite handle; for the prototype's data volume
 * this is fast enough and keeps the snapshot consistent.
 */
export function getPatientRecordSnapshot(patientId: string): PatientRecordSnapshot {
  console.log(`[DB] Loading patient record snapshot for patientId=${patientId}...`);
  const patient = getPatient(patientId);
  const caregiver = getCaregiverForPatient(patientId);
  const conditions = getConditionsForPatient(patientId);
  const symptoms = getSymptomsForPatient(patientId);
  const wearable = getPrimaryWearableForPatient(patientId);
  const medications = getActiveMedications(patientId);
  const medicationConfirmationRequirements =
    getMedicationConfirmationRequirementsForPatient(patientId);
  const thresholds = getActiveThresholds(patientId);
  const carePlan = getActiveCarePlanForPatient(patientId);
  const carePlanGoals = getCarePlanGoals(patientId);
  const knowledgeStats = getKnowledgeCacheStats();
  const enrichmentStats = getEnrichmentStats(patientId);
  const bundleStatus = getBundleStatus(patientId);
  const bundlePending = bundleStatus.state === 'in_flight';

  const primaryCondition = conditions.find((c) => c.isPrimary) ?? conditions[0] ?? null;
  const comorbidities = conditions.filter((c) => c !== primaryCondition);
  const pendingReviewConditions = conditions.filter((c) => c.needsReview);

  return {
    patient,
    caregiver,
    conditions,
    comorbidities,
    primaryCondition,
    pendingReviewConditions,
    symptoms,
    wearable,
    medications,
    medicationConfirmationRequirements,
    thresholds,
    carePlan,
    carePlanGoals,
    knowledgeStats,
    enrichmentStats,
    bundlePending,
    bundleStatus,
    lastRefreshedAt: new Date().toISOString(),
  };
}
