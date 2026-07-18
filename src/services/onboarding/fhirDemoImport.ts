import elenaGarciaFhirBundle from '@/data/fhir/fixtures/elena-garcia-fhir-bundle.json';
import {
  mapFhirBundleToOnboardingImport,
  type FhirBundle,
  type FhirOnboardingImport,
  type NormalizedFhirClinicalImportPackage,
} from '@/data/fhir';
import type { IcdConditionProfile, OnboardingProfile } from './onboardingService';
import { completeOnboardingProfile } from './onboardingService';

export type OnboardingFhirImportPatch = Omit<
  FhirOnboardingImport,
  'primaryCondition' | 'comorbidities'
> & {
  primaryCondition?: IcdConditionProfile;
  comorbidities: IcdConditionProfile[];
};

export interface OnboardingFhirImportResult {
  onboardingPatch: OnboardingFhirImportPatch;
  clinicalImport: NormalizedFhirClinicalImportPackage;
}

export function getElenaGarciaFhirOnboardingImport(): OnboardingFhirImportResult {
  return mapToResult(elenaGarciaFhirBundle as FhirBundle);
}

function mapToResult(bundle: FhirBundle): OnboardingFhirImportResult {
  const mapped = mapFhirBundleToOnboardingImport(bundle);

  return {
    onboardingPatch: {
      ...mapped.onboardingPatch,
      primaryCondition: toIcdCondition(mapped.onboardingPatch.primaryCondition, true),
      comorbidities: mapped.onboardingPatch.comorbidities
        .map((condition) => toIcdCondition(condition, false))
        .filter((condition): condition is IcdConditionProfile =>
          Boolean(condition),
        ),
    },
    clinicalImport: mapped.clinicalImport,
  };
}

function toIcdCondition(
  condition: FhirOnboardingImport['primaryCondition'],
  isPrimary: boolean,
): IcdConditionProfile | undefined {
  if (!condition?.code) return undefined;

  return {
    code: condition.code,
    label: condition.label,
    category: condition.category,
    isPrimary,
  };
}

/**
 * Build a full OnboardingProfile from Elena's FHIR bundle + persona defaults
 * and run it through the complete onboarding path (save + seed + condition
 * bundler). Returns the patientId. Used by the dev-settings "Re-run onboarding
 * with Elena Garcia demo" button so the team can restore the demo persona
 * without going through the 6-step wizard.
 */
export async function applyElenaGarciaDemoProfile(): Promise<string> {
  const { onboardingPatch, clinicalImport } = getElenaGarciaFhirOnboardingImport();

  const primary = onboardingPatch.primaryCondition;
  const comorbidities = onboardingPatch.comorbidities ?? [];
  const conditions = [
    primary?.label,
    ...comorbidities.map((c) => c.label),
  ].filter(Boolean).join(', ');

  const profile: OnboardingProfile = {
    caregiver: {
      name: 'Luis Garcia',
      relationship: 'Son',
      phone: '(555) 123-4567',
      experience: 'Some experience',
      availability: 'Evenings & weekends',
      notificationStyle: 'Push + sound',
      languagePreference: 'English + Español',
      medicalComfortLevel: 'Moderate detail',
      emergencyComfortLevel: 'Would call 911 if needed',
      hobbiesOrRoutines: 'Watches baseball together on weekends',
      mainConcern: "Mom's breathing episodes and fall risk",
      stressOrSupportNeeds:
        'Would appreciate clearer guidance on when to call the doctor vs 911',
      backupCaregiver: '',
    },
    patient: {
      name: onboardingPatch.officialDisplayName ?? 'Elena Garcia',
      preferredName: onboardingPatch.officialDisplayName ?? 'Elena',
      officialFirstName: onboardingPatch.officialFirstName ?? 'Elena',
      officialLastName: onboardingPatch.officialLastName ?? 'Garcia',
      officialDisplayName: onboardingPatch.officialDisplayName,
      age: onboardingPatch.patientAge ?? '72',
      conditions,
      primaryIcdCode: primary?.code,
      primaryIcdLabel: primary?.label,
      comorbidities,
      symptoms: [
        'shortness-of-breath',
        'low-oxygen',
        'chest-tightness',
        'confusion',
        'falls-risk',
        'fatigue',
      ],
      otherSymptoms: '',
      baselineDailyRoutine:
        onboardingPatch.baselineDailyRoutine ??
        'Morning: nebulizer + medications. Afternoon: light activity, oxygen as needed. Evening: medications, rest.',
      currentMedications: onboardingPatch.currentMedications ?? '',
      spo2Cutoff: onboardingPatch.spo2Cutoff ?? '88%',
      baselineHeartRate: onboardingPatch.baselineHeartRate ?? '60-100',
      gmfcsLevel: onboardingPatch.gmfcsLevel,
      fmsScore: 'Not assessed',
      macsLevel: onboardingPatch.macsLevel,
      cfcsLevel: onboardingPatch.cfcsLevel,
      edacsLevel: onboardingPatch.edacsLevel,
      location: 'Baltimore, Maryland',
      wearableDevice: {
        deviceType: 'Apple Watch',
        deviceLabel: "Elena's Apple Watch",
        connected: true,
        baselineStatus: 'connected',
        baselineStartedAt: new Date(
          Date.now() - 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        baselineCompletedAt: new Date(
          Date.now() - 1 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
    },
    primaryCareProvider: {
      name: 'Dr. Sarah Reynolds',
      phone: '(555) 987-6543',
      email: 'sreynolds@clinic.org',
    },
    safety: {
      emergencyContact: '911 / Poison Control: 1-800-222-1222',
      safetyNotes:
        'COPD exacerbation red flags: increased breathlessness, blue lips, confusion. TBI: watch for new confusion or one-sided weakness.',
      emergencyDisclaimerAccepted: true,
    },
    clinicalImport,
    completedAt: new Date().toISOString(),
  };

  const result = await completeOnboardingProfile(profile);
  return result.patientId ?? 'default-patient';
}
