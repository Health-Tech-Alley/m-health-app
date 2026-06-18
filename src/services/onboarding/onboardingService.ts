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
  age: string;

  /**
   * Legacy display string used by current Dashboard/Profile/SLM.
   * Keep this until every screen reads structured ICD/comorbidity data.
   */
  conditions: string;

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
  gmfcsLevel?: string;
  fmsScore?: string;

  /**
   * Device and baseline setup.
   * Track A can simulate baseline. Track B can connect to Apple Health /
   * Health Connect later.
   */
  wearableDevice?: WearableDeviceProfile;
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
  caregiver: CaregiverProfile;
  patient: PatientProfile;
  primaryCareProvider: ProviderProfile;
  safety?: SafetyProfile;
  completedAt?: string;
};

export type OnboardingSeedResult = {
  savedInMemory: boolean;
  seededDatabase: boolean;
  patientId?: string;
  error?: string;
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
  line1: "1200 Cypress Ave",
  city: "Gaithersburg",
  state: "MD",
  postalCode: "20877",
  country: "United States",
};

let savedOnboardingProfile: OnboardingProfile | null = null;

export const defaultOnboardingProfile: OnboardingProfile = {
  caregiver: {
    name: "Luis Garcia",
    relationship: "Son",
    phone: "(555) 010-2030",
    address: defaultCaregiverAddress,
    experience: "Some experience",
    availability: "Evenings & weekends",
    notificationStyle: "Push + sound",
    languagePreference: "English + Español",
    medicalComfortLevel: "Moderate detail",
    emergencyComfortLevel: "Would call 911 if needed",
    hobbiesOrRoutines: "Cooking, evening walks",
    mainConcern: "Breathing episodes",
    stressOrSupportNeeds: "Family check-ins help",
    backupCaregiver: "Maria Garcia · (555) 020-3040",
  },
  patient: {
    name: "Elena Garcia",
    age: "72",
    conditions: "COPD, Traumatic Brain Injury",
    addressSameAsCaregiver: true,
    address: defaultCaregiverAddress,
    primaryIcdCode: "J44.9",
    primaryIcdLabel: "Chronic obstructive pulmonary disease, unspecified",
    comorbidities: [
      {
        code: "S06.9X0S",
        label: "Traumatic brain injury, sequela",
        category: "Neurologic",
      },
    ],
    symptoms: [
      "shortness-of-breath",
      "low-oxygen",
      "fatigue",
      "reduced-mobility",
    ],
    otherSymptoms: "",
    baselineDailyRoutine: "Wakes at 8am, naps at 2pm, quiet evenings",
    currentMedications: "Albuterol PRN, Tiotropium daily, Prednisone",
    spo2Cutoff: "88%",
    baselineHeartRate: "72–88 BPM",
    gmfcsLevel: "",
    fmsScore: "",
    wearableDevice: {
      deviceType: "Apple Watch",
      deviceLabel: "Elena's Apple Watch",
      connected: false,
      baselineStatus: "simulated",
      baselineStartedAt: new Date().toISOString(),
      baselineCompletedAt: new Date().toISOString(),
    },
  },
  primaryCareProvider: {
    name: "Dr. Smith",
    phone: "(555) 800-1234",
    email: "dr.smith@clinic.org",
  },
  safety: {
    emergencyContact: "Maria Garcia · (555) 020-3040",
    safetyNotes: "Allergic to penicillin. Falls risk.",
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

export async function completeOnboardingProfile(
  profile: OnboardingProfile,
): Promise<OnboardingSeedResult> {
  saveOnboardingProfile(profile);

  try {
    const { seedDatabaseFromProfile } = await import("@/data");
    const patientId = seedDatabaseFromProfile(getOnboardingProfile());

    return {
      savedInMemory: true,
      seededDatabase: true,
      patientId,
    };
  } catch (error) {
    return {
      savedInMemory: true,
      seededDatabase: false,
      error:
        error instanceof Error
          ? error.message
          : "SQLite seed failed after onboarding profile was saved in memory.",
    };
  }
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
    conditions: patient.conditions,
  };
}

export function hasCompletedOnboarding(): boolean {
  return savedOnboardingProfile !== null;
}

export function clearOnboardingProfile(): void {
  savedOnboardingProfile = null;
}

export function getPatientConditionSummary(patient: PatientProfile): string {
  const primary = patient.primaryIcdLabel || patient.conditions;
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

  return patient.conditions;
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

  const conditions = buildLegacyConditionSummary({
    existingConditions: profile.patient.conditions,
    primaryIcdLabel,
    comorbidities: profile.patient.comorbidities,
  });

  return {
    ...profile,
    caregiver: {
      ...profile.caregiver,
      address: profile.caregiver.address,
    },
    patient: {
      ...profile.patient,
      addressSameAsCaregiver: useCaregiverAddress,
      address: patientAddress,
      primaryIcdLabel,
      conditions,
      comorbidities: profile.patient.comorbidities ?? [],
      symptoms: profile.patient.symptoms ?? [],
      otherSymptoms: profile.patient.otherSymptoms ?? "",
      gmfcsLevel: profile.patient.gmfcsLevel ?? "",
      fmsScore: profile.patient.fmsScore ?? "",
    },
  };
}

function buildLegacyConditionSummary({
  existingConditions,
  primaryIcdLabel,
  comorbidities,
}: {
  existingConditions: string;
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

  return existingConditions;
}
