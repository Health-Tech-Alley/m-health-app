import type { Caregiver } from '@/data/types';

import type {
  CaregiverProfile,
  OnboardingProfile,
  PatientProfile,
  ProviderProfile,
  SafetyProfile,
} from './onboardingService';

export type DemoOnboardingProfileId =
  | 'elena-gracia'
  | 'james-okafor'
  | 'sofia-reyes'
  | 'mike-ehr-v62';

type DemoCaregiverPreset = Pick<
  CaregiverProfile,
  | 'name'
  | 'relationship'
  | 'phone'
  | 'address'
  | 'experience'
  | 'availability'
  | 'languagePreference'
  | 'medicalComfortLevel'
  | 'hobbiesOrRoutines'
  | 'mainConcern'
  | 'stressOrSupportNeeds'
  | 'backupCaregiver'
>;

type DemoPatientPreset = Pick<
  PatientProfile,
  'name' | 'preferredName' | 'baselineDailyRoutine'
> &
  Partial<Pick<PatientProfile, 'spo2Cutoff' | 'baselineHeartRate'>>;

export type DemoOnboardingPreset = {
  id: DemoOnboardingProfileId;
  label: string;
  patient: DemoPatientPreset;
  caregiver: DemoCaregiverPreset;
  primaryCareProvider: ProviderProfile;
  safety: SafetyProfile;
};

const DEMO_PRIMARY_CARE_PROVIDER: ProviderProfile = {
  name: 'Dr. Avery Patel',
  phone: '(555) 030-1000',
  email: 'demo.provider@example.com',
};

const JAMES_PRIMARY_CARE_PROVIDER: ProviderProfile = {
  name: 'Adam Bricker, MD',
  phone: '(555) 030-1100',
  email: 'adam.bricker@example.com',
};

const SOFIA_PRIMARY_CARE_PROVIDER: ProviderProfile = {
  name: 'Adam Bricker, MD',
  phone: '(555) 030-1100',
  email: 'adam.bricker@example.com',
};

export const DEMO_ONBOARDING_PRESETS: Record<
  DemoOnboardingProfileId,
  DemoOnboardingPreset
> = {
  'elena-gracia': {
    id: 'elena-gracia',
    label: 'Elena',
    patient: {
      name: 'Elena',
      preferredName: 'Elena',
      baselineDailyRoutine:
        'I usually help Elena with breakfast, short walks when her energy allows, afternoon rest, and quiet family calls in the evening.',
    },
    caregiver: {
      name: 'Luis Garcia',
      relationship: 'Son',
      phone: '(555) 010-2030',
      address: {
        line1: '1200 Cedar Court',
        city: 'Frederick',
        state: 'MD',
        postalCode: '21701',
        country: 'United States',
      },
      experience: 'Some experience',
      availability: 'Evenings & weekends',
      languagePreference: 'English',
      medicalComfortLevel: 'Moderate detail',
      hobbiesOrRoutines:
        'I usually help Elena with breakfast, short walks when her energy allows, afternoon rest, and quiet family calls in the evening.',
      mainConcern:
        'I am concerned about breathing changes and confusion that may be hard for Elena to explain clearly.',
      stressOrSupportNeeds:
        'I need short explanations, calm next steps, and help knowing when a breathing change should be checked.',
      backupCaregiver: 'Maria Garcia, daughter - (555) 020-3040',
    },
    primaryCareProvider: DEMO_PRIMARY_CARE_PROVIDER,
    safety: {
      emergencyContact: 'Maria Garcia, daughter - (555) 020-3040',
      safetyNotes:
        'I am concerned that Elena may become short of breath or confused before I realize how serious it is. I would check her breathing, inhaler use, and oxygen reading if available, and I would seek urgent help for severe trouble breathing, blue lips, chest pain, fainting, or new one-sided weakness.',
      emergencyDisclaimerAccepted: true,
    },
  },
  'james-okafor': {
    id: 'james-okafor',
    label: 'James',
    patient: {
      name: 'James',
      preferredName: 'James',
      spo2Cutoff: '94%',
      baselineHeartRate: '70-90 BPM',
      baselineDailyRoutine:
        'James does caregiver-supported home rehabilitation each day. I help track his exercise repetitions, range of motion, walking activity, pain, and fatigue, and I keep notes for the rehabilitation team.',
    },
    caregiver: {
      name: 'Diane',
      relationship: 'Wife',
      phone: '555-0102',
      address: {
        line1: '1808 Willow Bend Lane',
        city: 'Frederick',
        state: 'MD',
        postalCode: '21702',
        country: 'United States',
      },
      experience: 'Some experience',
      availability: 'Full time',
      languagePreference: 'English',
      medicalComfortLevel: 'Moderate detail',
      hobbiesOrRoutines:
        'James does caregiver-supported home rehabilitation each day. I help track his exercise repetitions, range of motion, walking activity, pain, and fatigue, and I keep notes for the rehabilitation team.',
      mainConcern:
        'I want to keep James on track with his daily rehabilitation exercises, repetitions, range of motion, and walking activity, and I need to understand when pain, fatigue, or stalled progress means I should contact the rehabilitation team.',
      stressOrSupportNeeds:
        'I need clear guidance for tracking home exercises safely, noticing changes in walking or range of motion, and knowing when to ask the rehabilitation team for help.',
      backupCaregiver: 'Tunde Okafor, brother - (555) 016-4488',
    },
    primaryCareProvider: JAMES_PRIMARY_CARE_PROVIDER,
    safety: {
      emergencyContact: 'Tunde Okafor, brother - (555) 016-4488',
      safetyNotes:
        'I watch for new weakness, severe sudden pain, falls with injury, chest pain, or shortness of breath during James\'s home rehabilitation. I would stop activity and contact his care team for concerning changes, and seek urgent help for chest pain, shortness of breath, a fall with injury, new one-sided weakness, or speech trouble.',
      emergencyDisclaimerAccepted: true,
    },
  },
  'sofia-reyes': {
    id: 'sofia-reyes',
    label: 'Sofia',
    patient: {
      name: 'Sofia',
      preferredName: 'Sofi',
      spo2Cutoff: '95%',
      baselineHeartRate: '75-100 BPM',
      baselineDailyRoutine:
        'Sofi follows a regular medication, bladder, and bowel routine. She usually eats on a consistent schedule and stays as active as she comfortably can. She wears a watch that tracks her heart rate and movement. I check in with her during the day and help her keep up with medications and daily routines.',
    },
    caregiver: {
      name: 'Marco',
      relationship: 'Family member',
      phone: '555-0202',
      address: {
        line1: '2440 Maple Hollow Drive',
        city: 'Frederick',
        state: 'MD',
        postalCode: '21703',
        country: 'United States',
      },
      experience: 'Some experience',
      availability: 'Full time',
      languagePreference: 'English',
      medicalComfortLevel: 'Keep it simple',
      hobbiesOrRoutines:
        'Sofi follows a regular medication, bladder, and bowel routine. She usually eats on a consistent schedule and stays as active as she comfortably can. She wears a watch that tracks her heart rate and movement. I check in with her during the day and help her keep up with medications and daily routines.',
      mainConcern:
        'I worry that I may not notice when something is changing because Sofi does not always show obvious symptoms. I want help recognizing unusual changes in her activity, heart rate, energy, eating, bladder routine, or bowel routine.',
      stressOrSupportNeeds:
        'I need help recognizing changes that may be connected to missed medication, constipation, bladder problems, reduced movement, or low energy.',
      backupCaregiver: 'Rafael Reyes, uncle - (555) 018-2199',
    },
    primaryCareProvider: SOFIA_PRIMARY_CARE_PROVIDER,
    safety: {
      emergencyContact: 'Rafael Reyes, uncle - (555) 018-2199',
      safetyNotes:
        'I am concerned about sudden changes such as unusual heart rate, very little movement, vomiting, low energy, not eating, or changes in Sofi\'s bladder or bowel routine. I want clear guidance about warning signs that mean I should check on her or contact her care team.',
      emergencyDisclaimerAccepted: true,
    },
  },
  'mike-ehr-v62': {
    id: 'mike-ehr-v62',
    label: 'Mike',
    patient: {
      name: 'Mike',
      preferredName: 'Mike',
      spo2Cutoff: '92%',
      baselineHeartRate: '60-100 BPM',
      baselineDailyRoutine:
        'Mike follows a regular schedule for medications, meals, personal care, stretching, positioning, and rest. I help him with transfers and daily activities, check his skin and any braces or splints, and keep track of changes in his breathing, swallowing, comfort, and energy.',
    },
    caregiver: {
      name: 'Denise Thompson',
      relationship: 'Mother',
      phone: '(555) 014-6620',
      address: {
        line1: '318 Harbor View Place',
        city: 'Baltimore',
        state: 'MD',
        postalCode: '21224',
        country: 'United States',
      },
      experience: 'Experienced',
      availability: 'On-call only',
      languagePreference: 'English',
      medicalComfortLevel: 'Full clinical detail',
      hobbiesOrRoutines:
        'Mike follows a regular schedule for medications, meals, personal care, stretching, positioning, and rest. I help him with transfers and daily activities, check his skin and any braces or splints, and keep track of changes in his breathing, swallowing, comfort, and energy.',
      mainConcern:
        'I want to make sure Mike stays comfortable and that I notice changes early, especially with his breathing, swallowing, seizures, positioning, or recovery after procedures.',
      stressOrSupportNeeds:
        'I want help keeping information organized, recognizing meaningful changes, and knowing when something should be discussed with Mike\'s care team.',
      backupCaregiver: 'Marcus Thompson, Brother - (555) 014-6630',
    },
    primaryCareProvider: DEMO_PRIMARY_CARE_PROVIDER,
    safety: {
      emergencyContact: 'Marcus Thompson, Brother - (555) 014-6630',
      safetyNotes:
        'I watch for coughing or choking during meals, changes in breathing, unusual seizure activity, skin irritation from braces or splints, and redness, swelling, drainage, or fever after a procedure. I would contact his care team if I notice a concerning change or seek urgent help for severe breathing difficulty, prolonged seizure activity, or sudden unresponsiveness.',
      emergencyDisclaimerAccepted: true,
    },
  },
};

export function getDemoOnboardingPreset(
  profileId: string | null | undefined,
): DemoOnboardingPreset | null {
  if (!profileId) return null;
  return DEMO_ONBOARDING_PRESETS[profileId as DemoOnboardingProfileId] ?? null;
}

export function getDemoOnboardingOptions(): DemoOnboardingPreset[] {
  return Object.values(DEMO_ONBOARDING_PRESETS);
}

export function applyDemoOnboardingPreset(
  profile: OnboardingProfile,
  profileId: string,
): OnboardingProfile {
  const preset = getDemoOnboardingPreset(profileId);
  if (!preset) return profile;

  return {
    ...profile,
    demoProfileId: preset.id,
    caregiver: {
      ...profile.caregiver,
      ...preset.caregiver,
    },
    patient: {
      ...profile.patient,
      ...preset.patient,
      symptoms: [],
      otherSymptoms: '',
      baselineDailyRoutine: preset.patient.baselineDailyRoutine,
      spo2Cutoff: preset.patient.spo2Cutoff ?? '',
      baselineHeartRate: preset.patient.baselineHeartRate ?? '',
      baselineBloodOxygen: '',
      baselineRespiratoryRate: '',
      baselineBloodPressureSystolic: '',
      baselineBloodPressureDiastolic: '',
      baselineGlucoseLevel: '',
      baselineBodyTemperature: '',
      gmfcsLevel: '',
      fmsScore: '',
      macsLevel: '',
      cfcsLevel: '',
      edacsLevel: '',
    },
    primaryCareProvider: {
      ...profile.primaryCareProvider,
      ...preset.primaryCareProvider,
    },
    safety: {
      ...profile.safety,
      ...preset.safety,
    },
    clinicalImport: undefined,
  };
}

export function prepareExplicitDemoOnboardingForImportedProfile({
  currentProfile,
  importedProfileId,
  patientId,
  now = new Date().toISOString(),
}: {
  currentProfile: OnboardingProfile;
  importedProfileId: string;
  patientId: string;
  now?: string;
}): {
  profile: OnboardingProfile;
  caregiver: Caregiver | null;
  preset: DemoOnboardingPreset | null;
  preservedExistingOnboarding: boolean;
} {
  const preset = getDemoOnboardingPreset(importedProfileId);
  if (!preset) {
    return {
      profile: currentProfile,
      caregiver: null,
      preset: null,
      preservedExistingOnboarding: false,
    };
  }

  const preservedExistingOnboarding = currentProfile.demoProfileId === preset.id;
  const profile = preservedExistingOnboarding
    ? currentProfile
    : applyDemoOnboardingPreset(currentProfile, preset.id);

  return {
    profile,
    caregiver: buildPatientScopedCaregiver(profile, patientId, now),
    preset,
    preservedExistingOnboarding,
  };
}

export const prepareDemoOnboardingForImportedProfile =
  prepareExplicitDemoOnboardingForImportedProfile;

export function buildPatientScopedCaregiver(
  profile: OnboardingProfile,
  patientId: string,
  now = new Date().toISOString(),
): Caregiver {
  const caregiver = profile.caregiver;

  return {
    caregiverId: `caregiver-${patientId}`,
    patientId,
    name: caregiver.name,
    relationship: caregiver.relationship,
    experience: caregiver.experience,
    availability: caregiver.availability,
    languagePreference: caregiver.languagePreference,
    medicalComfortLevel: caregiver.medicalComfortLevel,
    hobbiesOrRoutines: caregiver.hobbiesOrRoutines,
    mainConcern: caregiver.mainConcern,
    stressOrSupportNeeds: caregiver.stressOrSupportNeeds,
    backupCaregiver: caregiver.backupCaregiver,
    createdAt: now,
  };
}
