/**
 * Seed the local database from the onboarding profile (v2).
 *
 * v2 writes the full structured onboarding profile:
 *   • patient (with structured fields)
 *   • caregiver (with comfort levels, availability, etc.)
 *   • conditions — primary + comorbidities, each with ICD-10 code, category,
 *     is_primary, source='onboarding'
 *   • symptoms — structured catalog selections
 *   • wearable device
 *   • medications + best-effort schedules
 *   • thresholds (SpO2, heart-rate band)
 *   • default notification preferences
 *
 * After seeding, fires the clinical condition-bundler (Phase 3) in the
 * background and sets the `bundlePending` flag so the app can retry on next
 * launch if the bundle fails (see planning/22_clinical-data-gathering.md §13.7).
 */

import type { OnboardingProfile } from '@/services/onboarding/onboardingService';

import {
  upsertCaregiver,
  upsertCondition,
  upsertMedication,
  upsertPatient,
  deleteConditionsForPatient,
  deleteCarePlanMedicationsForPatient,
} from '../repositories/patientRepository';
import { replaceThresholdsForVital } from '../repositories/thresholdRepository';
import type { SymptomCategory, Threshold } from '../types';
import { upsertMedicationSchedule } from '../repositories/medicationScheduleRepository';
import { insertAppointment, deleteDemoAppointmentsForPatient } from '../repositories/appointmentRepository';
import { ensureDefaultNotificationPreferences } from '../repositories/notificationRepository';
import { upsertSymptom, deleteSymptomsForPatient } from '../repositories/symptomRepository';
import { upsertWearableDevice } from '../repositories/wearableDeviceRepository';
import { setBundlePending, setBundleStatus, getPatientRecordSnapshot } from '../repositories/patientRecordRepository';
import { seedAdcpV1FromSnapshot } from '../repositories/adcpRepository';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

const DEFAULT_PATIENT_ID = 'default-patient';
const DEFAULT_CAREGIVER_ID = 'default-caregiver';

type SeedConditionInput = {
  code?: string;
  label: string;
  category?: string;
  isPrimary: boolean;
};

/**
 * Map onboarding symptom IDs to their structured categories.
 * Mirrors COMMON_SYMPTOM_OPTIONS in onboardingService.ts.
 */
const SYMPTOM_CATEGORY_MAP: Record<string, SymptomCategory> = {
  'shortness-of-breath': 'respiratory',
  wheezing: 'respiratory',
  'persistent-cough': 'respiratory',
  'low-oxygen': 'respiratory',
  'chest-tightness': 'cardiac',
  'fast-heart-rate': 'cardiac',
  dizziness: 'neurologic',
  confusion: 'neurologic',
  weakness: 'mobility',
  'reduced-mobility': 'mobility',
  'falls-risk': 'mobility',
  fatigue: 'general',
  fever: 'general',
  pain: 'pain',
  'sleep-change': 'behavioral',
  'appetite-change': 'general',
};

const SYMPTOM_LABEL_MAP: Record<string, string> = {
  'shortness-of-breath': 'Shortness of breath',
  wheezing: 'Wheezing',
  'persistent-cough': 'Persistent cough',
  'low-oxygen': 'Low oxygen readings',
  'chest-tightness': 'Chest tightness',
  'fast-heart-rate': 'Fast heart rate',
  dizziness: 'Dizziness',
  confusion: 'New or increased confusion',
  weakness: 'Weakness',
  'reduced-mobility': 'Reduced mobility',
  'falls-risk': 'Falls or near-falls',
  fatigue: 'Fatigue',
  fever: 'Fever',
  pain: 'Pain',
  'sleep-change': 'Sleep change',
  'appetite-change': 'Low appetite',
};

export function seedDatabaseFromProfile(
  profile: OnboardingProfile,
  patientId = DEFAULT_PATIENT_ID,
): string {
  const now = new Date().toISOString();
  const caregiverId = DEFAULT_CAREGIVER_ID;

  // -- Patient --------------------------------------------------------------
  upsertPatient({
    patientId,
    name: profile.patient.name,
    preferredName: profile.patient.preferredName,
    age: profile.patient.age,
    conditions: profile.patient.conditions,
    baselineDailyRoutine: profile.patient.baselineDailyRoutine,
    currentMedications: profile.patient.currentMedications,
    spo2Cutoff: profile.patient.spo2Cutoff,
    baselineHeartRate: profile.patient.baselineHeartRate,
    baselineBloodOxygen: profile.patient.baselineBloodOxygen,
    baselineRespiratoryRate: profile.patient.baselineRespiratoryRate,
    baselineBloodPressureSystolic: profile.patient.baselineBloodPressureSystolic,
    baselineBloodPressureDiastolic: profile.patient.baselineBloodPressureDiastolic,
    baselineGlucoseLevel: profile.patient.baselineGlucoseLevel,
    baselineBodyTemperature: profile.patient.baselineBodyTemperature,
    gmfcs: profile.patient.gmfcsLevel || 'Not assessed',
    fms: profile.patient.fmsScore || 'Not assessed',
    macs: profile.patient.macsLevel || 'Not assessed',
    cfcs: profile.patient.cfcsLevel || 'Not assessed',
    edacs: profile.patient.edacsLevel || 'Not assessed',
    location: profile.patient.location,
    safetyNotes: profile.safety?.safetyNotes,
    createdAt: profile.completedAt ?? now,
    updatedAt: now,
  });

  // -- Caregiver ------------------------------------------------------------
  upsertCaregiver({
    caregiverId,
    patientId,
    name: profile.caregiver.name,
    relationship: profile.caregiver.relationship,
    experience: profile.caregiver.experience,
    availability: profile.caregiver.availability,
    languagePreference: profile.caregiver.languagePreference,
    medicalComfortLevel: profile.caregiver.medicalComfortLevel,
    hobbiesOrRoutines: profile.caregiver.hobbiesOrRoutines,
    mainConcern: profile.caregiver.mainConcern,
    stressOrSupportNeeds: profile.caregiver.stressOrSupportNeeds,
    backupCaregiver: profile.caregiver.backupCaregiver,
    createdAt: now,
  });

  // -- Conditions (structured: primary ICD + comorbidities) -----------------
  // Clear any existing conditions so re-seed is idempotent.
  deleteConditionsForPatient(patientId);

  const structuredConditions = dedupeSeedConditions([
    ...(profile.patient.primaryIcdLabel
      ? [
          {
            code: profile.patient.primaryIcdCode,
            label: profile.patient.primaryIcdLabel,
            category: profile.patient.primaryIcdCode
              ? deriveConditionCategory(profile.patient.primaryIcdCode)
              : undefined,
            isPrimary: true,
          },
        ]
      : []),
    ...(profile.patient.comorbidities ?? []).map((condition) => ({
      code: condition.code,
      label: condition.label,
      category: condition.category ?? (condition.code ? deriveConditionCategory(condition.code) : undefined),
      isPrimary: false,
    })),
  ]);

  if (structuredConditions.length > 0) {
    for (const condition of structuredConditions) {
      upsertCondition({
        conditionId: makeId('condition'),
        patientId,
        name: condition.label,
        icd10: condition.code,
        category: condition.category,
        isPrimary: condition.isPrimary,
        source: 'onboarding',
        needsReview: false,
      });
    }
  } else {
    // Fallback: derive from the legacy comma-separated conditions string.
    const fallbackNames = (profile.patient.conditions ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    for (let i = 0; i < fallbackNames.length; i++) {
      upsertCondition({
        conditionId: makeId('condition'),
        patientId,
        name: fallbackNames[i],
        isPrimary: i === 0,
        source: 'onboarding',
        needsReview: false,
      });
    }
  }

  // -- Symptoms (structured catalog selections) -----------------------------
  // Clear existing symptoms so re-seed is idempotent and duplicates don't
  // accumulate across cold starts (mirrors conditions + medications above).
  deleteSymptomsForPatient(patientId);

  const symptomIds = profile.patient.symptoms ?? [];
  for (const symptomId of symptomIds) {
    const category = SYMPTOM_CATEGORY_MAP[symptomId] ?? 'other';
    const label = SYMPTOM_LABEL_MAP[symptomId] ?? symptomId;
    upsertSymptom({
      symptomId: makeId('symptom'),
      patientId,
      label,
      category,
      source: 'onboarding',
      createdAt: now,
    });
  }
  // Free-text "other symptoms" → single 'other' symptom row.
  const otherSymptoms = profile.patient.otherSymptoms?.trim();
  if (otherSymptoms) {
    upsertSymptom({
      symptomId: makeId('symptom'),
      patientId,
      label: otherSymptoms,
      category: 'other',
      source: 'onboarding',
      createdAt: now,
    });
  }

  // -- Wearable device ------------------------------------------------------
  const wearable = profile.patient.wearableDevice;
  if (wearable) {
    upsertWearableDevice({
      deviceId: makeId('device'),
      patientId,
      deviceType: wearable.deviceType,
      deviceLabel: wearable.deviceLabel,
      connected: wearable.connected,
      baselineStatus: wearable.baselineStatus,
      baselineStartedAt: wearable.baselineStartedAt,
      baselineCompletedAt: wearable.baselineCompletedAt,
      createdAt: now,
      updatedAt: now,
    });
  }

  // -- Medications + schedules ---------------------------------------------
  // Clear existing care-plan meds (+ their schedules) so re-seed is idempotent
  // and duplicates don't accumulate across cold starts. Custom caregiver-added
  // meds (source='custom') are preserved.
  deleteCarePlanMedicationsForPatient(patientId);

  const medNames = (profile.patient.currentMedications ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const freqLower = (profile.patient.currentMedications ?? '').toLowerCase();
  for (const name of medNames) {
    const medId = makeId('med');
    upsertMedication({
      medicationId: medId,
      patientId,
      name,
      active: true,
    });
    const times: string[] =
      freqLower.includes('twice') || freqLower.includes('q12') || freqLower.includes('bid')
        ? ['08:00', '20:00']
        : ['08:00'];
    for (const time of times) {
      upsertMedicationSchedule({
        scheduleId: makeId('sched'),
        medicationId: medId,
        patientId,
        timeOfDay: time,
        active: true,
        createdAt: now,
      });
    }
  }

  // -- Thresholds (SpO2 cutoff, heart-rate band) ---------------------------
  const thresholds: Threshold[] = [];
  const spo2Cutoff = parseThresholdValue(profile.patient.spo2Cutoff);
  if (spo2Cutoff !== null) {
    thresholds.push({
      thresholdId: makeId('threshold'),
      patientId,
      vitalType: 'spo2',
      value: spo2Cutoff,
      direction: 'below',
      severity: 3,
      source: 'pcp_careplan',
      createdAt: now,
    });
  }

  const hrBaseline = parseHeartRateBaseline(profile.patient.baselineHeartRate);
  if (hrBaseline !== null) {
    thresholds.push(
      {
        thresholdId: makeId('threshold'),
        patientId,
        vitalType: 'heart_rate',
        value: hrBaseline.upper + 30,
        direction: 'above',
        severity: 2,
        source: 'ml_baseline',
        createdAt: now,
      },
      {
        thresholdId: makeId('threshold'),
        patientId,
        vitalType: 'heart_rate',
        value: hrBaseline.lower - 20,
        direction: 'below',
        severity: 2,
        source: 'ml_baseline',
        createdAt: now,
      },
    );
  }

  if (thresholds.length > 0) {
    const byVital: Record<string, Threshold[]> = {};
    for (const t of thresholds) {
      byVital[t.vitalType] = byVital[t.vitalType] ?? [];
      byVital[t.vitalType].push(t);
    }
    for (const vitalType of Object.keys(byVital)) {
      replaceThresholdsForVital(patientId, vitalType, byVital[vitalType]);
    }
  }

  // -- Notification preferences -------------------------------------------
  ensureDefaultNotificationPreferences();

  // -- ADCP v1 (planning/39 §3.5) -----------------------------------------
  // Seed the AccessDP Care Plan v1 from the snapshot just built, so the Care
  // and Dashboard surfaces have a non-empty plan to display on first launch.
  // Idempotent — `seedAdcpV1FromSnapshot` returns the existing v1 if present.
  try {
    seedAdcpV1FromSnapshot({
      patientId,
      snapshot: getPatientRecordSnapshot(patientId),
      source: 'seed:onboarding',
    });
  } catch (err) {
    // ADCP seeding is best-effort — never block onboarding completion.
    console.error('[seedFromProfile] ADCP v1 seed failed:', err);
  }

  // -- Seed a demo appointment so the Schedule screen isn't empty -----------
  // Use a stable appointmentId derived from the patient so re-seeding on the
  // next cold start replaces this row instead of adding a duplicate
  // (insertAppointment uses INSERT OR REPLACE). Also clean up any previously
  // seeded demo duplicates (from before the stable-ID fix).
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);
  try {
    deleteDemoAppointmentsForPatient(patientId);
    insertAppointment({
      appointmentId: `appt-demo-${patientId}`,
      patientId,
      type: 'Medication review',
      provider: profile.primaryCareProvider.name,
      date: tomorrowIso,
      time: '8:00 PM',
      location: 'Main clinic',
      reason: 'Quarterly medication review',
      reminder: '1 day before',
      status: 'scheduled',
    });
  } catch {
    // appointment seeding is best-effort
  }

  if (!profile.clinicalImport) {
    return patientId;
  }

  // -- Mark bundle as pending so the clinical-evidence bundler can run -----
  setBundlePending(patientId, true);
  setBundleStatus(patientId, { state: 'in_flight', chunksAdded: 0 });

  // Fire-and-forget the condition + medication bundles. The UI doesn't block
  // on this; the retriever uses synthetic fixtures until the cache is populated,
  // then picks up the cached chunks on the next index rebuild.
  // (See planning/22_clinical-data-gathering.md §9a)
  void import('@/clinical-evidence/condition-bundler').then(({ bundleConditionPack, bundleMedicationPack, bundleSdohPack }) => {
    void bundleConditionPack(patientId).catch((err) => {
      console.error('[seedFromProfile] condition bundle failed:', err);
    });
    void bundleMedicationPack(patientId).catch((err) => {
      console.error('[seedFromProfile] medication bundle failed:', err);
    });
    void bundleSdohPack(patientId, profile.patient.location).catch((err) => {
      console.error('[seedFromProfile] SDOH bundle failed:', err);
    });
  }).catch((err) => {
    console.error('[seedFromProfile] Failed to load condition-bundler:', err);
  });

  return patientId;
}

/** @deprecated HEDIS auto-goals disabled — always false. */
export function shouldBundleHedisMeasures(_profile: OnboardingProfile): boolean {
  return false;
}

/**
 * Best-effort ICD-10 → category derivation. Kept simple for the prototype;
 * MedlinePlus enrichment (Phase 3) will refine categories from authoritative
 * sources.
 */
function deriveConditionCategory(icdCode: string): string {
  const root = icdCode.toUpperCase();
  if (root.startsWith('J')) return 'Respiratory';
  if (root.startsWith('I')) return 'Cardiac';
  if (root.startsWith('E')) return 'Metabolic';
  if (root.startsWith('G') || root.startsWith('S06') || root.startsWith('F')) return 'Neurologic';
  if (root.startsWith('G80')) return 'Neurologic / Mobility';
  return 'General';
}

function dedupeSeedConditions(
  conditions: SeedConditionInput[],
): SeedConditionInput[] {
  const seenCodes = new Set<string>();
  const seenLabels = new Set<string>();

  return conditions.filter((condition) => {
    const codeKey = normalizeIcdCodeForComparison(condition.code);
    const labelKey = normalizeConditionLabelForComparison(condition.label);
    const duplicate =
      (codeKey && seenCodes.has(codeKey)) ||
      (!codeKey && labelKey && seenLabels.has(labelKey));

    if (duplicate) return false;
    if (codeKey) seenCodes.add(codeKey);
    if (labelKey) seenLabels.add(labelKey);
    return true;
  });
}

function normalizeIcdCodeForComparison(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  return trimmed.match(/[A-Z][0-9][A-Z0-9.]*/i)?.[0].toUpperCase() ?? '';
}

function normalizeConditionLabelForComparison(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
}

function parseThresholdValue(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : null;
}

function parseHeartRateBaseline(value: string | undefined): { lower: number; upper: number } | null {
  if (!value) return null;
  const match = value.match(/(\d+)[^\d]+(\d+)/);
  if (!match) return null;
  return { lower: parseInt(match[1], 10), upper: parseInt(match[2], 10) };
}
