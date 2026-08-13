import type { NormalizedFhirClinicalImportPackage } from '@/data/fhir';
import { getDatabase } from '@/data/db';
import patientProfiles from '@/data/fhir/patient-profiles';
import {
  clearActivePatientId,
  getActivePatientId,
  resetDeveloperTestFlags,
} from '@/data/repositories/appSettingsRepository';
import { ensureDefaultNotificationPreferences } from '@/data/repositories/notificationRepository';
import {
  getPatient,
  upsertCaregiver,
  upsertCondition,
  upsertMedication,
  upsertPatient,
} from '@/data/repositories/patientRepository';
import { upsertMedicationSchedule } from '@/data/repositories/medicationScheduleRepository';
import { upsertSymptom } from '@/data/repositories/symptomRepository';
import { upsertWearableDevice } from '@/data/repositories/wearableDeviceRepository';
import type { Medication, Patient, SymptomCategory } from '@/data/types';
import { seedDatabaseFromProfile, seedDefaultUc3ExerciseAssignments } from '@/data/seed/seedFromProfile';

/**
 * Service layer for first-time caregiver onboarding.
 *
 * Current prototype behavior:
 * - Stores onboarding data in memory so the UI can read a consistent profile.
 * - Preserves older free-text fields used by Dashboard, Profile, SLM, and Care.
 * - Adds structured caregiver/patient address, ICD, comorbidity, symptoms, and
 *   device data so we can reduce SLM guessing and later seed SQLite.
 *
 * Future behavior:
 * - completeOnboardingProfile can seed Ethan's repository / SQLite layer once
 *   the data scaffold is merged into this branch.
 * - EHR/FHIR import can hydrate ICD, medications, care team, and device records.
 */

export type CaregivingExperience =
  | "First time"
  | "Some experience"
  | "Experienced"
  | "Medical background";

export type Availability =
  | "Full time"
  | "Mornings"
  | "Evenings & weekends"
  | "On-call only";

export type NotificationStyle =
  | "Push + sound"
  | "Vibrate only"
  | "Push only"
  | "Text message";

export type LanguagePreference =
  | "English"
  | "Español"
  | "English + Español"
  | "Other";

export type MedicalComfortLevel =
  | "Keep it simple"
  | "Moderate detail"
  | "Full clinical detail";

export type EmergencyComfortLevel =
  | "Would call 911 if needed"
  | "Prefer provider first"
  | "Not sure — guide me";

export type AddressProfile = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type IcdConditionProfile = {
  code: string;
  label: string;
  category?: string;
  isPrimary?: boolean;
};

export type SymptomProfile = {
  id: string;
  label: string;
  category:
    | "respiratory"
    | "cardiac"
    | "neurologic"
    | "mobility"
    | "general"
    | "pain"
    | "behavioral"
    | "other";
};

export type WearableDeviceType =
  | "Apple Watch"
  | "Fitbit"
  | "Garmin"
  | "Samsung Galaxy Watch"
  | "Oura Ring"
  | "Phone only"
  | "No device yet"
  | "Other";

export type WearableBaselineStatus =
  | "not_started"
  | "simulated"
  | "connected"
  | "failed";

export type WearableDeviceProfile = {
  deviceType: WearableDeviceType;
  deviceLabel?: string;
  connected: boolean;
  baselineStatus: WearableBaselineStatus;
  baselineStartedAt?: string;
  baselineCompletedAt?: string;
};

export type CaregiverProfile = {
  name: string;
  relationship: string;
  phone: string;
  address?: AddressProfile;
  experience?: CaregivingExperience;
  availability?: Availability;
  notificationStyle?: NotificationStyle;
  languagePreference?: LanguagePreference;
  medicalComfortLevel?: MedicalComfortLevel;
  emergencyComfortLevel?: EmergencyComfortLevel;
  hobbiesOrRoutines?: string;
  mainConcern?: string;
  stressOrSupportNeeds?: string;
  backupCaregiver?: string;
};

export type PatientProfile = {
  name: string;
  preferredName?: string;
  officialFirstName?: string;
  officialLastName?: string;
  officialDisplayName?: string;
  age?: string;

  /**
   * Legacy display string used by current Dashboard/Profile/SLM.
   * Keep this until every screen reads structured ICD/comorbidity data.
   */
  conditions?: string;

  addressSameAsCaregiver?: boolean;
  address?: AddressProfile;

  /**
   * Structured diagnosis fields.
   * These reduce SLM processing because the app can pass codes + labels instead
   * of asking the model to interpret a free-text diagnosis paragraph.
   */
  primaryIcdCode?: string;
  primaryIcdLabel?: string;
  comorbidities?: IcdConditionProfile[];

  /**
   * Structured symptom selections from our small local catalog.
   * otherSymptoms stays available for anything not in the catalog.
   */
  symptoms?: string[];
  otherSymptoms?: string;

  baselineDailyRoutine?: string;
  currentMedications?: string;
  spo2Cutoff?: string;
  baselineHeartRate?: string;
  baselineBloodOxygen?: string;
  baselineRespiratoryRate?: string;
  baselineBloodPressureSystolic?: string;
  baselineBloodPressureDiastolic?: string;
  baselineGlucoseLevel?: string;
  baselineBodyTemperature?: string;
  gmfcsLevel?: string;
  fmsScore?: string;
  macsLevel?: string;
  cfcsLevel?: string;
  edacsLevel?: string;

  /**
   * Device and baseline setup.
   * Track A can simulate baseline. Track B can connect to Apple Health /
   * Health Connect later.
   */
  wearableDevice?: WearableDeviceProfile;

  /**
   * Free-text location (county / state). Drives the CDC PLACES SDOH bundle
   * and RMPIF rural/urban context. Optional — the app degrades gracefully
   * to a generic fixture record when missing.
   * (planning/32 §10.2 / D5)
   */
  location?: string;
};

export type ProviderProfile = {
  name: string;
  phone: string;
  email: string;
};

export type SafetyProfile = {
  emergencyContact?: string;
  safetyNotes?: string;
  emergencyDisclaimerAccepted?: boolean;
};

export type OnboardingProfile = {
  demoProfileId?: string;
  caregiver: CaregiverProfile;
  patient: PatientProfile;
  primaryCareProvider: ProviderProfile;
  safety?: SafetyProfile;
  clinicalImport?: NormalizedFhirClinicalImportPackage;
  completedAt?: string;
};

export type OnboardingSeedResult = {
  savedInMemory: boolean;
  seededDatabase: boolean;
  patientId?: string;
  error?: string;
};

function getCanonicalPatientIdFromBundleData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const entries = (data as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return null;

  const patientResources = entries
    .map((entry) =>
      entry && typeof entry === 'object'
        ? (entry as { resource?: unknown }).resource
        : null,
    )
    .filter(
      (resource): resource is { resourceType?: unknown; id?: unknown } =>
        !!resource &&
        typeof resource === 'object' &&
        (resource as { resourceType?: unknown }).resourceType === 'Patient',
    );

  if (patientResources.length !== 1) return null;
  const patientId = patientResources[0].id;
  return typeof patientId === 'string' && patientId.trim()
    ? patientId.trim()
    : null;
}

function resolveLocalDemoPatientId(profile: OnboardingProfile): string | undefined {
  const demoProfileId = profile.demoProfileId?.trim();
  if (!demoProfileId) return undefined;
  const bundledProfile = patientProfiles.find((entry) => entry.id === demoProfileId);
  const canonicalPatientId = getCanonicalPatientIdFromBundleData(bundledProfile?.data);
  return canonicalPatientId ? `demo-${canonicalPatientId}` : undefined;
}

export type ImportedPatientManualFields = {
  fullName?: string;
  age?: string;
  conditions?: string;
  currentMedications?: string;
  spo2Cutoff?: string;
  baselineHeartRate?: string;
};

export type MockEhrPatientRecord = Pick<
  PatientProfile,
  "primaryIcdCode" | "primaryIcdLabel" | "comorbidities" | "conditions"
>;

/**
 * Prototype ICD list.
 *
 * This is not a final clinical code set. It is intentionally small so the
 * caregiver can choose structured options during the prototype, and Rahal/FHIR
 * can replace it later with EHR-backed ICD search.
 */
export const COMMON_ICD_OPTIONS: IcdConditionProfile[] = [
  {
    code: "J44.9",
    label: "Chronic obstructive pulmonary disease, unspecified",
    category: "Respiratory",
  },
  {
    code: "S06.9X0S",
    label: "Traumatic brain injury, sequela",
    category: "Neurologic",
  },
  {
    code: "I10",
    label: "Essential hypertension",
    category: "Cardiac",
  },
  {
    code: "E11.9",
    label: "Type 2 diabetes mellitus without complications",
    category: "Metabolic",
  },
  {
    code: "I63.9",
    label: "Cerebral infarction, unspecified",
    category: "Neurologic",
  },
  {
    code: "G40.909",
    label: "Epilepsy, unspecified, not intractable, without status epilepticus",
    category: "Neurologic",
  },
  {
    code: "G80.9",
    label: "Cerebral palsy, unspecified",
    category: "Neurologic / Mobility",
  },
  {
    code: "F03.90",
    label:
      "Unspecified dementia, unspecified severity, without behavioral disturbance",
    category: "Cognitive",
  },
];

export const COMMON_SYMPTOM_OPTIONS: SymptomProfile[] = [
  {
    id: "shortness-of-breath",
    label: "Shortness of breath",
    category: "respiratory",
  },
  {
    id: "wheezing",
    label: "Wheezing",
    category: "respiratory",
  },
  {
    id: "persistent-cough",
    label: "Persistent cough",
    category: "respiratory",
  },
  {
    id: "low-oxygen",
    label: "Low oxygen readings",
    category: "respiratory",
  },
  {
    id: "chest-tightness",
    label: "Chest tightness",
    category: "cardiac",
  },
  {
    id: "fast-heart-rate",
    label: "Fast heart rate",
    category: "cardiac",
  },
  {
    id: "dizziness",
    label: "Dizziness",
    category: "neurologic",
  },
  {
    id: "confusion",
    label: "New or increased confusion",
    category: "neurologic",
  },
  {
    id: "weakness",
    label: "Weakness",
    category: "mobility",
  },
  {
    id: "reduced-mobility",
    label: "Reduced mobility",
    category: "mobility",
  },
  {
    id: "falls-risk",
    label: "Falls or near-falls",
    category: "mobility",
  },
  {
    id: "fatigue",
    label: "Fatigue",
    category: "general",
  },
  {
    id: "fever",
    label: "Fever",
    category: "general",
  },
  {
    id: "pain",
    label: "Pain",
    category: "pain",
  },
  {
    id: "sleep-change",
    label: "Sleep change",
    category: "behavioral",
  },
  {
    id: "appetite-change",
    label: "Low appetite",
    category: "general",
  },
];

export const WEARABLE_DEVICE_OPTIONS: WearableDeviceType[] = [
  "Apple Watch",
  "Fitbit",
  "Garmin",
  "Samsung Galaxy Watch",
  "Oura Ring",
  "Phone only",
  "No device yet",
  "Other",
];

const defaultCaregiverAddress: AddressProfile = {
  line1: "",
  city: "",
  state: "",
  postalCode: "",
  country: "United States",
};

let savedOnboardingProfile: OnboardingProfile | null = null;

export const defaultOnboardingProfile: OnboardingProfile = {
  caregiver: {
    name: "",
    relationship: "",
    phone: "",
    address: defaultCaregiverAddress,
    experience: "Some experience",
    availability: "Evenings & weekends",
    notificationStyle: "Push + sound",
    languagePreference: "English",
    medicalComfortLevel: "Moderate detail",
    emergencyComfortLevel: "Would call 911 if needed",
    hobbiesOrRoutines: "",
    mainConcern: "",
    stressOrSupportNeeds: "",
    backupCaregiver: "",
  },
  patient: {
    name: "",
    preferredName: "",
    officialFirstName: "",
    officialLastName: "",
    officialDisplayName: "",
    age: "",
    conditions: "",
    addressSameAsCaregiver: true,
    address: defaultCaregiverAddress,
    primaryIcdCode: undefined,
    primaryIcdLabel: undefined,
    comorbidities: [],
    symptoms: [],
    otherSymptoms: "",
    baselineDailyRoutine: "",
    currentMedications: "",
    spo2Cutoff: "",
    baselineHeartRate: "",
    baselineBloodOxygen: "",
    baselineRespiratoryRate: "",
    baselineBloodPressureSystolic: "",
    baselineBloodPressureDiastolic: "",
    baselineGlucoseLevel: "",
    baselineBodyTemperature: "",
    gmfcsLevel: "",
    fmsScore: "",
    macsLevel: "",
    cfcsLevel: "",
    edacsLevel: "",
    wearableDevice: {
      deviceType: "Apple Watch",
      deviceLabel: "",
      connected: false,
      baselineStatus: "simulated",
      baselineStartedAt: new Date().toISOString(),
      baselineCompletedAt: new Date().toISOString(),
    },
  },
  primaryCareProvider: {
    name: "",
    phone: "",
    email: "",
  },
  safety: {
    emergencyContact: "",
    safetyNotes: "",
    emergencyDisclaimerAccepted: true,
  },
  completedAt: new Date().toISOString(),
};

export function saveOnboardingProfile(profile: OnboardingProfile): void {
  const normalizedProfile = normalizeOnboardingProfile(profile);

  savedOnboardingProfile = {
    ...normalizedProfile,
    completedAt: normalizedProfile.completedAt ?? new Date().toISOString(),
  };
}

/**
 * Final onboarding completion path.
 *
 * Saves the reviewed profile in memory, then seeds the local repository layer
 * from the same normalized profile.
 */
export async function completeOnboardingProfile(
  profile: OnboardingProfile,
): Promise<OnboardingSeedResult> {
  saveOnboardingProfile(profile);
  const savedProfile = getOnboardingProfile();
  const patientId = seedDatabaseFromProfile(
    savedProfile,
    resolveLocalDemoPatientId(savedProfile),
  );

  // First-run guard: a stale "Simulate missing Concierge / knowledge" flag
  // from a previous dev session must not survive onboarding — it would hide
  // the SLM from the caregiver even though a model is installed.
  resetDeveloperTestFlags();

  return {
    savedInMemory: true,
    seededDatabase: true,
    patientId,
  };
}

export async function completeOnboardingProfileForImportedPatient(
  profile: OnboardingProfile,
  importedPatientId: string,
  manualFields: ImportedPatientManualFields = {},
): Promise<OnboardingSeedResult> {
  const patientId = importedPatientId.trim();
  if (!patientId) {
    throw new Error('Imported patient ID is required to complete onboarding.');
  }

  const existingPatient = getPatient(patientId);
  if (!existingPatient) {
    throw new Error(`Cannot complete onboarding for missing imported patient: ${patientId}`);
  }

  const profileForSave = buildImportedPatientProfileForSave(profile, manualFields);
  const now = new Date().toISOString();

  getDatabase().withTransactionSync(() => {
    clearPreviousImportedOnboardingRows(patientId);
    persistImportedPatientManualValues({
      profile: profileForSave,
      existingPatient,
      patientId,
      manualFields,
      now,
    });
  });
  saveOnboardingProfile(profileForSave);

  // First-run guard: clear any stale developer "Simulate missing" flag so a
  // freshly onboarded user never sees the SLM hidden by a dev-testing state.
  resetDeveloperTestFlags();

  // App-owned UC3 default exercises (source 'developer_uc3_v2') for
  // UC3-eligible imported patients (e.g. post-stroke demo presets). This is an
  // onboarding-time action, NOT part of the FHIR import itself — the imported
  // EHR record stays accurate.
  try {
    seedDefaultUc3ExerciseAssignments(patientId);
  } catch (err) {
    console.error('[onboarding] UC3 exercise assignment seed failed:', err);
  }

  return {
    savedInMemory: true,
    seededDatabase: false,
    patientId,
  };
}

function buildImportedPatientProfileForSave(
  profile: OnboardingProfile,
  manualFields: ImportedPatientManualFields,
): OnboardingProfile {
  const fullName = cleanManualText(manualFields.fullName);
  const age = cleanManualText(manualFields.age);
  const conditions = cleanManualText(manualFields.conditions);
  const currentMedications = cleanManualText(manualFields.currentMedications);
  const spo2Cutoff = cleanManualText(manualFields.spo2Cutoff);
  const baselineHeartRate = cleanManualText(manualFields.baselineHeartRate);

  return {
    ...profile,
    patient: {
      ...profile.patient,
      name: fullName ?? profile.patient.preferredName ?? '',
      officialDisplayName: fullName ?? '',
      age: age ?? '',
      conditions: conditions ?? '',
      primaryIcdCode: undefined,
      primaryIcdLabel: undefined,
      comorbidities: [],
      currentMedications: currentMedications ?? '',
      spo2Cutoff: spo2Cutoff ?? '',
      baselineHeartRate: baselineHeartRate ?? '',
    },
  };
}

function persistImportedPatientManualValues({
  profile,
  existingPatient,
  patientId,
  manualFields,
  now,
}: {
  profile: OnboardingProfile;
  existingPatient: Patient;
  patientId: string;
  manualFields: ImportedPatientManualFields;
  now: string;
}): void {
  const patient = profile.patient;
  const manualFullName = cleanManualText(manualFields.fullName);
  const manualAge = cleanManualText(manualFields.age);
  const manualConditions = cleanManualText(manualFields.conditions);
  const manualCurrentMedications = cleanManualText(manualFields.currentMedications);
  const manualSpo2Cutoff = cleanManualText(manualFields.spo2Cutoff);
  const manualBaselineHeartRate = cleanManualText(manualFields.baselineHeartRate);

  upsertPatient({
    ...existingPatient,
    patientId,
    name: manualFullName ?? existingPatient.name,
    preferredName: cleanOptionalText(patient.preferredName) || existingPatient.preferredName,
    age: manualAge ?? existingPatient.age,
    conditions: manualConditions ?? existingPatient.conditions,
    baselineDailyRoutine:
      cleanOptionalText(patient.baselineDailyRoutine) || existingPatient.baselineDailyRoutine,
    currentMedications: manualCurrentMedications ?? existingPatient.currentMedications,
    spo2Cutoff: manualSpo2Cutoff ?? existingPatient.spo2Cutoff,
    baselineHeartRate: manualBaselineHeartRate ?? existingPatient.baselineHeartRate,
    baselineBloodOxygen:
      cleanOptionalText(patient.baselineBloodOxygen) || existingPatient.baselineBloodOxygen,
    baselineRespiratoryRate:
      cleanOptionalText(patient.baselineRespiratoryRate) ||
      existingPatient.baselineRespiratoryRate,
    baselineBloodPressureSystolic:
      cleanOptionalText(patient.baselineBloodPressureSystolic) ||
      existingPatient.baselineBloodPressureSystolic,
    baselineBloodPressureDiastolic:
      cleanOptionalText(patient.baselineBloodPressureDiastolic) ||
      existingPatient.baselineBloodPressureDiastolic,
    baselineGlucoseLevel:
      cleanOptionalText(patient.baselineGlucoseLevel) || existingPatient.baselineGlucoseLevel,
    baselineBodyTemperature:
      cleanOptionalText(patient.baselineBodyTemperature) ||
      existingPatient.baselineBodyTemperature,
    gmfcs: cleanOptionalText(patient.gmfcsLevel) || existingPatient.gmfcs,
    fms: cleanOptionalText(patient.fmsScore) || existingPatient.fms,
    macs: cleanOptionalText(patient.macsLevel) || existingPatient.macs,
    cfcs: cleanOptionalText(patient.cfcsLevel) || existingPatient.cfcs,
    edacs: cleanOptionalText(patient.edacsLevel) || existingPatient.edacs,
    location: cleanOptionalText(patient.location) || existingPatient.location,
    safetyNotes: cleanOptionalText(profile.safety?.safetyNotes) || existingPatient.safetyNotes,
    createdAt: existingPatient.createdAt,
    updatedAt: now,
  });

  upsertCaregiver({
    caregiverId: `caregiver-${patientId}`,
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

  persistManualSymptoms(patientId, patient, now);
  persistManualWearable(patientId, patient.wearableDevice, now);
  if (manualConditions) persistManualConditions(patientId, manualConditions);
  if (manualCurrentMedications) {
    persistManualMedications(patientId, manualCurrentMedications, now);
  }
  ensureDefaultNotificationPreferences();
}

function clearPreviousImportedOnboardingRows(patientId: string): void {
  const db = getDatabase();
  db.runSync(
    `DELETE FROM symptoms
     WHERE patient_id = ?
       AND COALESCE(source, 'onboarding') = 'onboarding'
       AND symptom_id LIKE 'symptom-onboarding-%';`,
    patientId,
  );
  db.runSync(
    `DELETE FROM patient_conditions
     WHERE patient_id = ?
       AND COALESCE(source, 'onboarding') = 'onboarding'
       AND condition_id LIKE 'condition-onboarding-%';`,
    patientId,
  );
  db.runSync(
    `DELETE FROM medication_schedules
     WHERE patient_id = ?
       AND schedule_id LIKE 'sched-onboarding-%';`,
    patientId,
  );
  db.runSync(
    `DELETE FROM medications
     WHERE patient_id = ?
       AND COALESCE(source, 'care_plan') = 'care_plan'
       AND medication_id LIKE 'med-onboarding-%';`,
    patientId,
  );
  db.runSync(
    `DELETE FROM thresholds
     WHERE patient_id = ?
       AND threshold_id LIKE 'threshold-%-onboarding-%';`,
    patientId,
  );
}

function persistManualSymptoms(
  patientId: string,
  patient: PatientProfile,
  now: string,
): void {
  for (const symptomId of patient.symptoms ?? []) {
    const option = COMMON_SYMPTOM_OPTIONS.find((item) => item.id === symptomId);
    const label = option?.label ?? symptomId;
    const category = (option?.category ?? 'other') as SymptomCategory;
    upsertSymptom({
      symptomId: makeStableOnboardingId('symptom', patientId, label),
      patientId,
      label,
      category,
      source: 'onboarding',
      createdAt: now,
    });
  }

  const otherSymptoms = cleanManualText(patient.otherSymptoms);
  if (otherSymptoms) {
    upsertSymptom({
      symptomId: makeStableOnboardingId('symptom', patientId, otherSymptoms),
      patientId,
      label: otherSymptoms,
      category: 'other',
      source: 'onboarding',
      createdAt: now,
    });
  }
}

function persistManualWearable(
  patientId: string,
  wearable: WearableDeviceProfile | undefined,
  now: string,
): void {
  if (!wearable) return;
  upsertWearableDevice({
    deviceId: `device-onboarding-${stableHash(patientId)}`,
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

function persistManualConditions(patientId: string, conditionsText: string): void {
  const names = splitManualList(conditionsText);
  names.forEach((name, index) => {
    upsertCondition({
      conditionId: makeStableOnboardingId('condition', patientId, `${index}:${name}`),
      patientId,
      name,
      isPrimary: index === 0,
      source: 'onboarding',
      needsReview: false,
    });
  });
}

function persistManualMedications(
  patientId: string,
  medicationsText: string,
  now: string,
): void {
  const medicationNames = splitManualList(medicationsText);
  for (const name of medicationNames) {
    const medicationId = makeStableOnboardingId('med', patientId, name);
    const medication: Medication = {
      medicationId,
      patientId,
      name,
      active: true,
      source: 'care_plan',
    };
    upsertMedication(medication);
    upsertMedicationSchedule({
      scheduleId: makeStableOnboardingId('sched', patientId, name),
      medicationId,
      patientId,
      timeOfDay: '08:00',
      active: true,
      createdAt: now,
    });
  }
}

function splitManualList(value: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value.split(/[,\n]/)) {
    const text = item.trim();
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    if (!text || seen.has(key)) continue;
    seen.add(key);
    items.push(text);
  }
  return items;
}

function makeStableOnboardingId(prefix: string, patientId: string, value: string | undefined): string {
  return `${prefix}-onboarding-${stableHash(`${patientId}:${value ?? ''}`)}`;
}

function stableHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function cleanManualText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

export function getOnboardingProfile(): OnboardingProfile {
  return savedOnboardingProfile ?? defaultOnboardingProfile;
}

export function getMockEhrPatientRecord(): MockEhrPatientRecord {
  const patient = defaultOnboardingProfile.patient;

  return {
    primaryIcdCode: patient.primaryIcdCode,
    primaryIcdLabel: patient.primaryIcdLabel,
    comorbidities: patient.comorbidities?.map((condition) => ({
      ...condition,
    })) ?? [],
    conditions: patient.conditions ?? "",
  };
}

export function hasCompletedOnboarding(): boolean {
  // In-memory draft (no completedAt) must not skip the wizard — used by
  // developer "Re-run onboarding" which clears completion then opens /onboarding.
  if (savedOnboardingProfile?.completedAt) return true;
  try {
    return getActivePatientId() !== null;
  } catch {
    return false;
  }
}

export function clearOnboardingProfile(): void {
  savedOnboardingProfile = null;
}

/**
 * Pending demo preset selected when developer tools restart the wizard.
 * Consumed once by the onboarding screen on mount.
 */
let pendingOnboardingDemoProfileId: string | null = null;

/**
 * Clear completion gates and optionally queue a demo preset so `/onboarding`
 * shows again (developer re-run). Does not seed the DB — user finishes wizard.
 */
export function beginOnboardingRerun(options?: {
  demoProfileId?: string | null;
}): void {
  clearOnboardingProfile();
  try {
    clearActivePatientId();
  } catch {
    /* DB may be unavailable in tests */
  }
  pendingOnboardingDemoProfileId = options?.demoProfileId?.trim() || null;
}

export function consumePendingOnboardingDemoProfileId(): string | null {
  const id = pendingOnboardingDemoProfileId;
  pendingOnboardingDemoProfileId = null;
  return id;
}

export function peekPendingOnboardingDemoProfileId(): string | null {
  return pendingOnboardingDemoProfileId;
}

export function getPatientConditionSummary(patient: PatientProfile): string {
  const primary = patient.primaryIcdLabel || patient.conditions || "";
  const comorbidities = patient.comorbidities ?? [];

  if (comorbidities.length === 0) {
    return primary;
  }

  return `${primary} · ${comorbidities.length} comorbidit${
    comorbidities.length === 1 ? "y" : "ies"
  }`;
}

export function getSelectedSymptomLabels(patient: PatientProfile): string[] {
  const symptomIds = patient.symptoms ?? [];

  const catalogLabels = symptomIds
    .map((symptomId) =>
      COMMON_SYMPTOM_OPTIONS.find((option) => option.id === symptomId),
    )
    .filter((option): option is SymptomProfile => Boolean(option))
    .map((option) => option.label);

  const otherSymptoms = patient.otherSymptoms?.trim();

  if (otherSymptoms) {
    return [...catalogLabels, otherSymptoms];
  }

  return catalogLabels;
}

export function getPrimaryIcdDisplay(patient: PatientProfile): string {
  if (patient.primaryIcdCode && patient.primaryIcdLabel) {
    return `${patient.primaryIcdCode} · ${patient.primaryIcdLabel}`;
  }

  if (patient.primaryIcdCode) {
    return patient.primaryIcdCode;
  }

  if (patient.primaryIcdLabel) {
    return patient.primaryIcdLabel;
  }

  return patient.conditions ?? "";
}

export function getWearableDeviceDisplay(patient: PatientProfile): string {
  const device = patient.wearableDevice;

  if (!device) {
    return "No device selected";
  }

  if (device.deviceType === "Other" && device.deviceLabel) {
    return device.deviceLabel;
  }

  return device.deviceLabel
    ? `${device.deviceType} · ${device.deviceLabel}`
    : device.deviceType;
}

function normalizeOnboardingProfile(
  profile: OnboardingProfile,
): OnboardingProfile {
  const useCaregiverAddress = profile.patient.addressSameAsCaregiver ?? true;

  const patientAddress = useCaregiverAddress
    ? profile.caregiver.address
    : profile.patient.address;

  const primaryIcdOption = COMMON_ICD_OPTIONS.find(
    (option) => option.code === profile.patient.primaryIcdCode,
  );

  const primaryIcdLabel =
    profile.patient.primaryIcdLabel ?? primaryIcdOption?.label;
  const comorbidities = dedupeIcdConditions(
    profile.patient.comorbidities ?? [],
    profile.patient.primaryIcdCode,
    primaryIcdLabel,
  );

  const conditions = buildLegacyConditionSummary({
    primaryIcdLabel,
    comorbidities,
  });

  return {
    ...profile,
    caregiver: {
      ...profile.caregiver,
      address: profile.caregiver.address,
    },
    patient: {
      ...profile.patient,
      preferredName: profile.patient.preferredName ?? profile.patient.name,
      name:
        profile.patient.preferredName?.trim() ||
        profile.patient.name.trim() ||
        profile.patient.officialDisplayName?.trim() ||
        "",
      addressSameAsCaregiver: useCaregiverAddress,
      address: patientAddress,
      primaryIcdLabel,
      conditions,
      comorbidities,
      symptoms: profile.patient.symptoms ?? [],
      otherSymptoms: profile.patient.otherSymptoms ?? "",
      baselineBloodOxygen: cleanOptionalText(profile.patient.baselineBloodOxygen),
      baselineRespiratoryRate: cleanOptionalText(
        profile.patient.baselineRespiratoryRate,
      ),
      baselineBloodPressureSystolic:
        cleanOptionalText(profile.patient.baselineBloodPressureSystolic),
      baselineBloodPressureDiastolic:
        cleanOptionalText(profile.patient.baselineBloodPressureDiastolic),
      baselineGlucoseLevel: cleanOptionalText(profile.patient.baselineGlucoseLevel),
      baselineBodyTemperature: cleanOptionalText(
        profile.patient.baselineBodyTemperature,
      ),
      gmfcsLevel: profile.patient.gmfcsLevel ?? "",
      fmsScore: profile.patient.fmsScore ?? "",
      macsLevel: profile.patient.macsLevel ?? "",
      cfcsLevel: profile.patient.cfcsLevel ?? "",
      edacsLevel: profile.patient.edacsLevel ?? "",
    },
  };
}

function buildLegacyConditionSummary({
  primaryIcdLabel,
  comorbidities,
}: {
  primaryIcdLabel?: string;
  comorbidities?: IcdConditionProfile[];
}): string {
  const labels = [
    primaryIcdLabel,
    ...(comorbidities ?? []).map((condition) => condition.label),
  ]
    .filter((label): label is string => Boolean(label?.trim()))
    .map((label) => label.trim());

  if (labels.length > 0) {
    return labels.join(", ");
  }

  return "";
}

function dedupeIcdConditions(
  conditions: IcdConditionProfile[],
  primaryCode?: string,
  primaryLabel?: string,
): IcdConditionProfile[] {
  const seenCodes = new Set<string>();
  const seenLabels = new Set<string>();
  const primaryCodeKey = normalizeIcdCodeForComparison(primaryCode);
  const primaryLabelKey = normalizeConditionLabelForComparison(primaryLabel);

  if (primaryCodeKey) seenCodes.add(primaryCodeKey);
  if (primaryLabelKey) seenLabels.add(primaryLabelKey);

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
  if (!trimmed) return "";
  return trimmed.match(/[A-Z][0-9][A-Z0-9.]*/i)?.[0].toUpperCase() ?? "";
}

function normalizeConditionLabelForComparison(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function cleanOptionalText(value: string | undefined): string {
  return value?.trim() ?? "";
}
