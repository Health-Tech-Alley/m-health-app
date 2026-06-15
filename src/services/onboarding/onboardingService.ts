/**
 * Service layer for first-time caregiver onboarding.
 *
 * Keeps onboarding data, profile types, and mock defaults separate from the UI.
 * Currently stores data in memory only. Later this can connect to SQLite,
 * SQLCipher, Rahal's profile layer, mock FHIR/EHR data, or a secure API.
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

export type CaregiverProfile = {
  name: string;
  relationship: string;
  phone: string;
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
  conditions: string;
  baselineDailyRoutine?: string;
  currentMedications?: string;
  spo2Cutoff?: string;
  baselineHeartRate?: string;
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

let savedOnboardingProfile: OnboardingProfile | null = null;

export const defaultOnboardingProfile: OnboardingProfile = {
  caregiver: {
    name: "Luis Garcia",
    relationship: "Son",
    phone: "(555) 010-2030",
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
    baselineDailyRoutine: "Wakes at 8am, naps at 2pm, quiet evenings",
    currentMedications: "Albuterol PRN, Tiotropium daily, Prednisone",
    spo2Cutoff: "88%",
    baselineHeartRate: "72–88 BPM",
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
  savedOnboardingProfile = {
    ...profile,
    completedAt: profile.completedAt ?? new Date().toISOString(),
  };
}

export function getOnboardingProfile(): OnboardingProfile {
  return savedOnboardingProfile ?? defaultOnboardingProfile;
}

export function hasCompletedOnboarding(): boolean {
  return savedOnboardingProfile !== null;
}

export function clearOnboardingProfile(): void {
  savedOnboardingProfile = null;
}