import { buildCaregiverAssistantContextFromSnapshot } from '@/services/slm/slmService';

import { shouldBundleHedisMeasures } from '@/data/seed/seedFromProfile';
import type { PatientRecordSnapshot } from '@/data/types';
import { normalizeActivePatient } from '@/hooks/useActivePatientView';
import type { OnboardingProfile } from './onboardingService';
import {
  DEMO_ONBOARDING_PRESETS,
  applyDemoOnboardingPreset,
  buildPatientScopedCaregiver,
  getDemoOnboardingPreset,
  prepareDemoOnboardingForImportedProfile,
} from './demoOnboardingPresets';

const elenaBundle = require('@/data/fhir/patient-profiles/elena-garcia.json') as FhirBundle;
const jamesBundle = require('@/data/fhir/fixtures/james_okafor_fhir_bundle.json') as FhirBundle;
const sofiaBundle = require('@/data/fhir/fixtures/sofia_reyes_fhir_bundle.json') as FhirBundle;
const mikeBundle = require('@/data/fhir/fixtures/mike-fhir-bundle-v6.2.json') as FhirBundle;

type FhirResource = {
  resourceType: string;
  id?: string;
  name?: {
    text?: string;
    given?: string[];
    family?: string;
    prefix?: string[];
    suffix?: string[];
  }[];
  birthDate?: string;
  generalPractitioner?: { reference?: string; display?: string }[];
  contact?: {
    relationship?: { text?: string }[];
    name?: { text?: string; given?: string[]; family?: string };
    telecom?: { value?: string }[];
  }[];
  qualification?: { code?: { text?: string } }[];
  telecom?: { system?: string; value?: string }[];
  code?: { text?: string; coding?: { code?: string; display?: string }[] };
};

type FhirBundle = {
  entry?: { resource?: FhirResource }[];
};

jest.mock('@/store', () => ({
  store: { dispatch: jest.fn() },
}));
jest.mock('@/store/reducers/vitalsSlice', () => ({
  clearVitalsForPatient: jest.fn((payload) => ({ type: 'clearVitalsForPatient', payload })),
  hydrationFailed: jest.fn((payload) => ({ type: 'hydrationFailed', payload })),
  hydrationStarted: jest.fn((payload) => ({ type: 'hydrationStarted', payload })),
  hydrationSucceeded: jest.fn((payload) => ({ type: 'hydrationSucceeded', payload })),
}));

function blankProfile(overrides: Partial<OnboardingProfile> = {}): OnboardingProfile {
  return {
    caregiver: {
      name: '',
      relationship: '',
      phone: '',
    },
    patient: {
      name: '',
      preferredName: '',
      officialFirstName: '',
      officialLastName: '',
      officialDisplayName: '',
      age: '',
      conditions: '',
      primaryIcdCode: undefined,
      primaryIcdLabel: undefined,
      comorbidities: [],
      symptoms: [],
      otherSymptoms: '',
      baselineDailyRoutine: '',
      currentMedications: '',
      spo2Cutoff: '',
      baselineHeartRate: '',
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
      name: '',
      phone: '',
      email: '',
    },
    ...overrides,
  };
}

function snapshotWithCaregiver(
  patientId: string,
  caregiver: PatientRecordSnapshot['caregiver'],
): PatientRecordSnapshot {
  return {
    patient: {
      patientId,
      name: 'Demo Patient',
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    },
    caregiver,
    conditions: [],
    pendingReviewConditions: [],
    symptoms: [],
    wearable: null,
    medications: [],
    medicationSchedules: [],
    medicationConfirmationRequirements: {},
    thresholds: [],
    carePlans: [],
    knowledgeStats: { citationCount: 0, lastRetrievedAt: null },
    enrichmentStats: { status: 'idle', pendingCount: 0 },
    bundleStatus: { state: 'idle' },
    lastRefreshedAt: '2026-07-10T00:00:00.000Z',
  } as PatientRecordSnapshot;
}

function allPresetText(): string {
  return Object.values(DEMO_ONBOARDING_PRESETS)
    .flatMap((preset) => [
      preset.patient.name,
      preset.patient.preferredName,
      preset.patient.baselineDailyRoutine,
      preset.caregiver.name,
      preset.caregiver.relationship,
      preset.caregiver.phone,
      preset.caregiver.address?.line1,
      preset.caregiver.address?.city,
      preset.caregiver.address?.state,
      preset.caregiver.address?.postalCode,
      preset.caregiver.address?.country,
      preset.caregiver.experience,
      preset.caregiver.availability,
      preset.caregiver.languagePreference,
      preset.caregiver.medicalComfortLevel,
      preset.caregiver.hobbiesOrRoutines,
      preset.caregiver.mainConcern,
      preset.caregiver.stressOrSupportNeeds,
      preset.caregiver.backupCaregiver,
      preset.primaryCareProvider.name,
      preset.primaryCareProvider.phone,
      preset.primaryCareProvider.email,
      preset.safety.emergencyContact,
      preset.safety.safetyNotes,
    ])
    .filter((value): value is string => Boolean(value))
    .join('\n');
}

function getPatient(bundle: FhirBundle): FhirResource {
  const patient = bundle.entry
    ?.map((entry) => entry.resource)
    .find((resource) => resource?.resourceType === 'Patient');

  if (!patient) throw new Error('Expected Patient resource in fixture');
  return patient;
}

function getGeneralPractitioner(bundle: FhirBundle): FhirResource | null {
  const patient = getPatient(bundle);
  const practitionerId = patient.generalPractitioner?.[0]?.reference?.split('/').pop();
  if (!practitionerId) return null;

  return (
    bundle.entry
      ?.map((entry) => entry.resource)
      .find(
        (resource) =>
          resource?.resourceType === 'Practitioner' && resource.id === practitionerId,
      ) ?? null
  );
}

describe('demo onboarding presets', () => {
  it('prepopulates intended onboarding fields for each demo case', () => {
    for (const preset of Object.values(DEMO_ONBOARDING_PRESETS)) {
      const next = applyDemoOnboardingPreset(blankProfile(), preset.id);

      expect(next.demoProfileId).toBe(preset.id);
      expect(next.patient.preferredName).toBe(preset.patient.preferredName);
      expect(next.patient.baselineDailyRoutine).toBe(preset.patient.baselineDailyRoutine);
      expect(next.caregiver.name).toBe(preset.caregiver.name);
      expect(next.caregiver.relationship).toBe(preset.caregiver.relationship);
      expect(next.caregiver.phone).toBe(preset.caregiver.phone);
      expect(next.caregiver.address).toEqual(preset.caregiver.address);
      expect(next.caregiver.mainConcern).toBe(preset.caregiver.mainConcern);
      expect(next.caregiver.backupCaregiver).toBe(preset.caregiver.backupCaregiver);
      expect(next.primaryCareProvider.name).toBe(preset.primaryCareProvider.name);
      expect(next.primaryCareProvider.phone).toBe(preset.primaryCareProvider.phone);
      expect(next.primaryCareProvider.email).toBe(preset.primaryCareProvider.email);
      expect(next.safety?.safetyNotes).toBe(preset.safety.safetyNotes);
    }
  });

  it('prepopulates caregiver, provider, and safety fields only for onboarding selection', () => {
    const profile = blankProfile();
    const next = applyDemoOnboardingPreset(profile, 'elena-gracia');

    expect(next.demoProfileId).toBe('elena-gracia');
    expect(next.patient.preferredName).toBe('Elena');
    expect(next.caregiver.name).toBe('Luis Garcia');
    expect(next.caregiver.mainConcern).toContain('breathing');
    expect(next.patient.baselineDailyRoutine).toContain('breakfast');
    expect(next.primaryCareProvider.name).toBe('Dr. Avery Patel');
    expect(next.primaryCareProvider.email).toBe('demo.provider@example.com');
    expect(next.caregiver.address?.line1).toBe('1200 Cedar Court');
    expect(next.caregiver.backupCaregiver).toContain('daughter');
    expect(next.safety?.safetyNotes).toContain('I am concerned');
  });

  it('does not populate clinical patient screens during onboarding selection', () => {
    for (const preset of Object.values(DEMO_ONBOARDING_PRESETS)) {
      const next = applyDemoOnboardingPreset(blankProfile(), preset.id);

      expect(next.patient.age).toBe(preset.patient.age);
      expect(next.patient.conditions).toBe('');
      expect(next.patient.currentMedications).toBe('');
      expect(next.patient.spo2Cutoff).toBe('');
      expect(next.patient.baselineHeartRate).toBe('');
      expect(next.patient.comorbidities).toEqual([]);
      expect(next.patient.symptoms).toEqual([]);
      expect(next.clinicalImport).toBeUndefined();
    }
  });

  it('does not request a generated HEDIS care plan before EHR import', () => {
    const next = applyDemoOnboardingPreset(blankProfile(), 'sofia-reyes');

    expect(shouldBundleHedisMeasures(next)).toBe(false);
  });

  it('allows HEDIS bundling only after clinical import data exists', () => {
    const imported = {
      ...blankProfile(),
      clinicalImport: {
        source: {
          bundleType: 'collection',
        },
        conditions: [],
        activeMedicationRequests: [],
        observations: [],
      },
    } as OnboardingProfile;

    expect(shouldBundleHedisMeasures(imported)).toBe(true);
  });

  it('keeps safety notes distinct by demo case', () => {
    const notes = Object.values(DEMO_ONBOARDING_PRESETS).map(
      (preset) => preset.safety.safetyNotes,
    );

    expect(new Set(notes).size).toBe(notes.length);
  });

  it('populates distinct caregiver addresses and backup caregivers for all presets', () => {
    const presets = Object.values(DEMO_ONBOARDING_PRESETS);
    const addressLines = presets.map((preset) => preset.caregiver.address?.line1);
    const backups = presets.map((preset) => preset.caregiver.backupCaregiver);

    expect(addressLines.every(Boolean)).toBe(true);
    expect(new Set(addressLines).size).toBe(presets.length);
    expect(backups.every((backup) => Boolean(backup?.match(/555/)))).toBe(true);
    expect(new Set(backups).size).toBe(presets.length);
  });

  it('uses first-person caregiver wording in free-text onboarding fields', () => {
    for (const preset of Object.values(DEMO_ONBOARDING_PRESETS)) {
      expect(preset.patient.baselineDailyRoutine).toMatch(/\bI\b/);
      expect(preset.caregiver.hobbiesOrRoutines).toMatch(/\bI\b/);
      expect(preset.caregiver.mainConcern).toMatch(/\bI\b/);
      expect(preset.caregiver.stressOrSupportNeeds).toMatch(/\bI\b/);
      expect(preset.safety.safetyNotes).toMatch(/\bI\b/);
      expect(preset.safety.safetyNotes).not.toMatch(
        /reports synthetic testing context|is concerned/i,
      );
    }
  });

  it('uses the approved first-person caregiver language for James', () => {
    const preset = getDemoOnboardingPreset('james-okafor');

    expect(preset?.patient.preferredName).toBe('James');
    expect(preset?.caregiver.name).toBe('Diane');
    expect(preset?.caregiver.relationship).toBe('Wife');
    expect(preset?.caregiver.mainConcern).toBe(
      'James has been doing his exercises every day, but I am worried that the numbers may look better than his actual recovery. I want to know whether he is truly improving or compensating with his shoulder.',
    );
    expect(preset?.patient.baselineDailyRoutine).toBe(
      'James does his prescribed shoulder range-of-motion and grip exercises at home every day. I help him stay on schedule, record his progress, and watch for pain, fatigue, balance problems, or changes in how he moves.',
    );
    expect(preset?.caregiver.stressOrSupportNeeds).toBe(
      'I need help recognizing meaningful progress, making sure he exercises safely, and knowing when he may need to be reassessed.',
    );
    expect(preset?.safety.safetyNotes).toBe(
      'I am concerned that James may compensate with his shoulder or lose his balance during home exercises. I would stop the exercise and contact his care team if he develops new pain, marked weakness, dizziness, or worsening balance. I would seek urgent help for new facial droop, speech difficulty, or one-sided weakness.',
    );
  });

  it('uses the approved first-person caregiver language for Sofia', () => {
    const preset = getDemoOnboardingPreset('sofia-reyes');

    expect(preset?.patient.preferredName).toBe('Sofi');
    expect(preset?.caregiver.name).toBe('Marco');
    expect(preset?.caregiver.relationship).toBe('Family member');
    expect(preset?.caregiver.mainConcern).toBe(
      'I worry that I may not notice when something is changing because Sofi does not always show obvious symptoms. I want help recognizing unusual changes in her activity, heart rate, energy, eating, bladder routine, or bowel routine.',
    );
    expect(preset?.patient.baselineDailyRoutine).toBe(
      'Sofi follows a regular medication, bladder, and bowel routine. She usually eats on a consistent schedule and stays as active as she comfortably can. She wears a watch that tracks her heart rate and movement. I check in with her during the day and help her keep up with medications and daily routines.',
    );
    expect(preset?.caregiver.stressOrSupportNeeds).toBe(
      'I need help recognizing changes that may be connected to missed medication, constipation, bladder problems, reduced movement, or low energy.',
    );
    expect(preset?.safety.safetyNotes).toBe(
      'I am concerned about sudden changes such as unusual heart rate, very little movement, vomiting, low energy, not eating, or changes in Sofi\'s bladder or bowel routine. I want clear guidance about warning signs that mean I should check on her or contact her care team.',
    );
  });

  it('uses the approved Mike caregiver persona without adding clinical facts', () => {
    const preset = getDemoOnboardingPreset('mike-ehr-v62');
    const next = applyDemoOnboardingPreset(blankProfile(), 'mike-ehr-v62');

    expect(preset?.patient.preferredName).toBe('Mike');
    expect(preset?.patient.age).toBe('32');
    expect(next.patient.age).toBe('32');
    expect(preset?.caregiver.name).toBe('Denise Thompson');
    expect(preset?.caregiver.relationship).toBe('Mother');
    expect(preset?.caregiver.experience).toBe('Experienced');
    expect(preset?.caregiver.medicalComfortLevel).toBe('Full clinical detail');
    expect(preset?.caregiver.backupCaregiver).toBe(
      'Marcus Thompson, Brother - (555) 014-6630',
    );
    expect(preset?.caregiver.backupCaregiver).not.toMatch(/\bson\b/i);
    expect(preset?.caregiver.mainConcern).toBe(
      'I want to make sure Mike stays comfortable and that I notice changes early, especially with his breathing, swallowing, seizures, positioning, or recovery after procedures.',
    );
    expect(preset?.patient.baselineDailyRoutine).toBe(
      'Mike follows a regular schedule for medications, meals, personal care, stretching, positioning, and rest. I help him with transfers and daily activities, check his skin and any braces or splints, and keep track of changes in his breathing, swallowing, comfort, and energy.',
    );
    expect(preset?.caregiver.stressOrSupportNeeds).toBe(
      'I want help keeping information organized, recognizing meaningful changes, and knowing when something should be discussed with Mike\'s care team.',
    );
    expect(preset?.safety.safetyNotes).toBe(
      'I watch for coughing or choking during meals, changes in breathing, unusual seizure activity, skin irritation from braces or splints, and redness, swelling, drainage, or fever after a procedure. I would contact his care team if I notice a concerning change or seek urgent help for severe breathing difficulty, prolonged seizure activity, or sudden unresponsiveness.',
    );
    expect(next.patient.conditions).toBe('');
    expect(next.patient.currentMedications).toBe('');
    expect(next.patient.comorbidities).toEqual([]);
    expect(next.patient.symptoms).toEqual([]);
  });

  it('formats valid provider credentials naturally in onboarding presets', () => {
    expect(getGeneralPractitioner(jamesBundle)?.name?.[0]?.suffix).toContain('MD');
    expect(getGeneralPractitioner(sofiaBundle)?.name?.[0]?.suffix).toContain('MD');
    expect(getGeneralPractitioner(jamesBundle)?.name?.[0]?.family).toBe('Bricker');
    expect(getGeneralPractitioner(jamesBundle)?.name?.[0]?.given).toEqual(['Adam']);

    expect(getDemoOnboardingPreset('james-okafor')?.primaryCareProvider.name).toBe(
      'Adam Bricker, MD',
    );
    expect(getDemoOnboardingPreset('sofia-reyes')?.primaryCareProvider.name).toBe(
      'Adam Bricker, MD',
    );
    expect(allPresetText()).not.toContain('Adam Bricker MD');
  });

  it('uses synthetic provider contact only when EHR provider contact is absent', () => {
    const jamesProvider = getGeneralPractitioner(jamesBundle);
    const sofiaProvider = getGeneralPractitioner(sofiaBundle);

    expect(jamesProvider?.telecom ?? []).toEqual([]);
    expect(sofiaProvider?.telecom ?? []).toEqual([]);
    expect(getGeneralPractitioner(elenaBundle)).toBeNull();
    expect(getGeneralPractitioner(mikeBundle)).toBeNull();

    expect(getDemoOnboardingPreset('james-okafor')?.primaryCareProvider).toEqual({
      name: 'Adam Bricker, MD',
      phone: '(555) 030-1100',
      email: 'james.provider@example.com',
    });
    expect(getDemoOnboardingPreset('sofia-reyes')?.primaryCareProvider).toEqual({
      name: 'Adam Bricker, MD',
      phone: '(555) 030-1200',
      email: 'sofia.provider@example.com',
    });
    expect(getDemoOnboardingPreset('elena-gracia')?.primaryCareProvider).toEqual({
      name: 'Dr. Avery Patel',
      phone: '(555) 030-1000',
      email: 'demo.provider@example.com',
    });
    expect(getDemoOnboardingPreset('mike-ehr-v62')?.primaryCareProvider).toEqual({
      name: 'Dr. Avery Patel',
      phone: '(555) 030-1000',
      email: 'demo.provider@example.com',
    });
  });

  it('does not include developer terminology in demo preset copy', () => {
    expect(allPresetText()).not.toMatch(
      /\b(ML|SLM|MCP|RAG|SQLite|payload|inference|threshold|anomaly score|event bus|cache|trajectory failure)\b/i,
    );
    expect(getDemoOnboardingPreset('mike-ehr-v62')?.caregiver.experience).not.toMatch(
      /\b(nurse|clinic)\b/i,
    );
    expect(getDemoOnboardingPreset('mike-ehr-v62')?.caregiver.medicalComfortLevel).not.toMatch(
      /\b(nurse|clinic)\b/i,
    );
    expect(getDemoOnboardingPreset('mike-ehr-v62')?.safety.safetyNotes).not.toMatch(
      /\b(nurse|clinic)\b/i,
    );
  });

  it('does not preload current runtime event outcomes in demo preset copy', () => {
    expect(allPresetText()).not.toMatch(
      /no bowel movement for 36 hours|currently vomiting|current low energy|movement cessation|heart-rate anomaly|autonomic dysreflexia|provider escalation|recovery plateau/i,
    );
  });

  it('keeps all four presets consistent with explicitly checked EHR fields', () => {
    const elenaPatient = getPatient(elenaBundle);
    const jamesPatient = getPatient(jamesBundle);
    const sofiaPatient = getPatient(sofiaBundle);
    const mikePatient = getPatient(mikeBundle);
    const elenaPreset = getDemoOnboardingPreset('elena-gracia');
    const jamesPreset = getDemoOnboardingPreset('james-okafor');
    const sofiaPreset = getDemoOnboardingPreset('sofia-reyes');
    const mikePreset = getDemoOnboardingPreset('mike-ehr-v62');

    expect(elenaPatient.name?.[0]?.given).toContain('Elena');
    expect(elenaPatient.name?.[0]?.family).toBe('Garcia');
    expect(elenaPatient.birthDate).toBe('1994-06-01');
    expect(elenaPreset?.patient.preferredName).toBe('Elena');
    expect(elenaPreset?.safety.safetyNotes).not.toMatch(/penicillin|allerg/i);

    expect(jamesPatient.name?.[0]?.text).toBe('James Okafor');
    expect(jamesPatient.birthDate).toBe('1958-04-12');
    expect(jamesPatient.generalPractitioner?.[0]?.display).toBe('Adam Bricker MD');
    expect(jamesPatient.contact?.[0]?.name?.given).toContain('Diane');
    expect(jamesPatient.contact?.[0]?.relationship?.[0]?.text).toBe('Wife / caregiver');
    expect(jamesPreset?.caregiver.name).toBe('Diane');
    expect(jamesPreset?.caregiver.relationship).toBe('Wife');
    expect(jamesPreset?.primaryCareProvider.name).toBe('Adam Bricker, MD');
    expect(jamesPreset?.safety.safetyNotes).not.toMatch(/allerg/i);

    expect(sofiaPatient.name?.[0]?.text).toBe('Sofia Reyes');
    expect(sofiaPatient.birthDate).toBe('2003-09-18');
    expect(sofiaPatient.generalPractitioner?.[0]?.display).toBe('Adam Bricker MD');
    expect(sofiaPatient.contact?.[0]?.name?.given).toContain('Marco');
    expect(sofiaPatient.contact?.[0]?.relationship?.[0]?.text).toBe('Family caregiver');
    expect(sofiaPreset?.caregiver.name).toBe('Marco');
    expect(sofiaPreset?.caregiver.relationship).toBe('Family member');
    expect(sofiaPreset?.primaryCareProvider.name).toBe('Adam Bricker, MD');
    expect(sofiaPreset?.safety.safetyNotes).not.toMatch(/allerg/i);

    expect(mikePatient.name?.[0]?.given).toContain('Mike');
    expect(mikePatient.birthDate).toBeUndefined();
    expect(mikePreset?.patient.preferredName).toBe('Mike');
    expect(mikePreset?.patient.age).toBe('32');
    expect(mikePreset?.safety.safetyNotes).toContain('choking');
    expect(mikePreset?.safety.safetyNotes).not.toMatch(/allerg/i);
  });

  it('keeps Mike fixture age and curated context source data unchanged', () => {
    const resources = mikeBundle.entry?.map((entry) => entry.resource).filter(Boolean) ?? [];
    const basicCodes = resources
      .filter((resource) => resource?.resourceType === 'Basic')
      .map((resource) => resource?.code?.text)
      .filter(Boolean);

    expect(getPatient(mikeBundle).birthDate).toBeUndefined();
    expect(resources.filter((resource) => resource?.resourceType === 'Basic')).toHaveLength(90);
    expect(basicCodes).toContain('Functional/developmental support: feeding/nutrition');
    expect(basicCodes).toContain('Care-team history: Occupational therapy');
    expect(
      resources
        .filter((resource) => resource?.resourceType === 'CarePlan')
        .map((resource) => resource?.id),
    ).toEqual([
      'careplan-care-v55-01',
      'careplan-care-v55-02',
      'careplan-care-v55-03',
      'careplan-care-v55-04',
      'careplan-care-v55-05',
    ]);
  });

  it('preserves edited onboarding values when importing the same profile', () => {
    const current = applyDemoOnboardingPreset(blankProfile(), 'james-okafor');
    const edited: OnboardingProfile = {
      ...current,
      caregiver: {
        ...current.caregiver,
        name: 'Edited Caregiver',
        address: {
          line1: '999 Edited Lane',
          city: 'Frederick',
          state: 'MD',
          postalCode: '21709',
          country: 'United States',
        },
        mainConcern: 'Edited concern',
        backupCaregiver: 'Edited Backup - (555) 999-0000',
      },
      primaryCareProvider: {
        name: 'Edited Provider',
        phone: '(555) 999-0001',
        email: 'edited.provider@example.com',
      },
    };

    const prepared = prepareDemoOnboardingForImportedProfile({
      currentProfile: edited,
      importedProfileId: 'james-okafor',
      patientId: 'james-patient',
      now: '2026-07-10T00:00:00.000Z',
    });

    expect(prepared.preservedExistingOnboarding).toBe(true);
    expect(prepared.profile.caregiver.name).toBe('Edited Caregiver');
    expect(prepared.profile.caregiver.address?.line1).toBe('999 Edited Lane');
    expect(prepared.profile.caregiver.backupCaregiver).toBe(
      'Edited Backup - (555) 999-0000',
    );
    expect(prepared.profile.primaryCareProvider.name).toBe('Edited Provider');
    expect(prepared.caregiver?.patientId).toBe('james-patient');
    expect(prepared.caregiver?.mainConcern).toBe('Edited concern');
  });

  it('preserves Mike age on same-profile import when the EHR has no birthDate', () => {
    const current = applyDemoOnboardingPreset(blankProfile(), 'mike-ehr-v62');

    const prepared = prepareDemoOnboardingForImportedProfile({
      currentProfile: current,
      importedProfileId: 'mike-ehr-v62',
      patientId: 'mike-patient',
      now: '2026-07-10T00:00:00.000Z',
    });

    expect(getPatient(mikeBundle).birthDate).toBeUndefined();
    expect(prepared.preservedExistingOnboarding).toBe(true);
    expect(prepared.profile.patient.age).toBe('32');
  });

  it('applies another bundled profile persona when importing a different profile', () => {
    const current = applyDemoOnboardingPreset(blankProfile(), 'james-okafor');

    const prepared = prepareDemoOnboardingForImportedProfile({
      currentProfile: current,
      importedProfileId: 'sofia-reyes',
      patientId: 'sofia-patient',
      now: '2026-07-10T00:00:00.000Z',
    });

    expect(prepared.preservedExistingOnboarding).toBe(false);
    expect(prepared.profile.demoProfileId).toBe('sofia-reyes');
    expect(prepared.profile.caregiver.name).toBe(
      getDemoOnboardingPreset('sofia-reyes')?.caregiver.name,
    );
    expect(prepared.profile.caregiver.address).toEqual(
      getDemoOnboardingPreset('sofia-reyes')?.caregiver.address,
    );
    expect(prepared.profile.caregiver.backupCaregiver).toBe(
      getDemoOnboardingPreset('sofia-reyes')?.caregiver.backupCaregiver,
    );
    expect(prepared.profile.primaryCareProvider).toEqual(
      getDemoOnboardingPreset('sofia-reyes')?.primaryCareProvider,
    );
    expect(prepared.profile.patient.preferredName).toBe('Sofi');
    expect(prepared.profile.patient.baselineDailyRoutine).toContain('bladder');
    expect(prepared.profile.safety?.safetyNotes).toContain('warning signs');
    expect(prepared.caregiver?.patientId).toBe('sofia-patient');
  });

  it('does not apply a preset for generic or manual FHIR imports', () => {
    const current = applyDemoOnboardingPreset(blankProfile(), 'elena-gracia');

    const prepared = prepareDemoOnboardingForImportedProfile({
      currentProfile: current,
      importedProfileId: 'manual-fhir-import',
      patientId: 'manual-patient',
    });

    expect(prepared.preset).toBeNull();
    expect(prepared.profile).toBe(current);
    expect(prepared.caregiver).toBeNull();
  });

  it('builds patient-scoped caregivers for each imported patient', () => {
    const elena = buildPatientScopedCaregiver(
      applyDemoOnboardingPreset(blankProfile(), 'elena-gracia'),
      'elena-patient',
      '2026-07-10T00:00:00.000Z',
    );
    const sofia = buildPatientScopedCaregiver(
      applyDemoOnboardingPreset(blankProfile(), 'sofia-reyes'),
      'sofia-patient',
      '2026-07-10T00:00:00.000Z',
    );

    expect(elena.patientId).toBe('elena-patient');
    expect(elena.caregiverId).toBe('caregiver-elena-patient');
    expect(sofia.patientId).toBe('sofia-patient');
    expect(sofia.name).not.toBe(elena.name);
  });

  it('keeps Profile and More summary data patient-scoped after different-profile selection', () => {
    const current = applyDemoOnboardingPreset(blankProfile(), 'elena-gracia');
    const prepared = prepareDemoOnboardingForImportedProfile({
      currentProfile: current,
      importedProfileId: 'mike-ehr-v62',
      patientId: 'mike-patient',
      now: '2026-07-10T00:00:00.000Z',
    });

    const activeSnapshot = snapshotWithCaregiver('mike-patient', prepared.caregiver);

    expect(prepared.profile.caregiver.name).toBe('Denise Thompson');
    expect(prepared.profile.caregiver.relationship).toBe('Mother');
    expect(prepared.profile.patient.age).toBe('32');
    expect(prepared.profile.caregiver.address?.line1).toBe('318 Harbor View Place');
    expect(prepared.profile.caregiver.backupCaregiver).toBe(
      'Marcus Thompson, Brother - (555) 014-6630',
    );
    expect(prepared.profile.primaryCareProvider.name).toBe('Dr. Avery Patel');
    expect(activeSnapshot.caregiver?.patientId).toBe('mike-patient');
    expect(activeSnapshot.caregiver?.name).toBe('Denise Thompson');
    expect(activeSnapshot.caregiver?.name).not.toBe('Luis Garcia');
  });

  it('feeds the SLM context from the active patient-scoped caregiver', () => {
    const prepared = prepareDemoOnboardingForImportedProfile({
      currentProfile: applyDemoOnboardingPreset(blankProfile(), 'elena-gracia'),
      importedProfileId: 'james-okafor',
      patientId: 'james-patient',
      now: '2026-07-10T00:00:00.000Z',
    });

    const context = buildCaregiverAssistantContextFromSnapshot(
      snapshotWithCaregiver('james-patient', prepared.caregiver),
    );

    expect(context.caregiverName).toBe('Diane');
    expect(context.caregiverMainConcern).toContain('actual recovery');
    expect(context.caregiverName).not.toBe('Luis Garcia');
  });

  it('feeds selected primary and active diagnoses to the SLM context', () => {
    const snapshot = {
      ...snapshotWithCaregiver('diagnosis-patient', null),
      primaryCondition: {
        conditionId: 'condition-fallback',
        patientId: 'diagnosis-patient',
        name: 'Cerebral Palsy',
        isPrimary: true,
        needsReview: false,
        conditionRole: 'history_context',
      },
      conditions: [
        {
          conditionId: 'condition-fallback',
          patientId: 'diagnosis-patient',
          name: 'Cerebral Palsy',
          isPrimary: true,
          needsReview: false,
          conditionRole: 'history_context',
        },
        {
          conditionId: 'condition-primary',
          patientId: 'diagnosis-patient',
          name: 'Selected Primary',
          icd10: 'A00',
          isPrimary: true,
          needsReview: false,
          conditionRole: 'primary_diagnosis',
        },
        {
          conditionId: 'condition-active',
          patientId: 'diagnosis-patient',
          name: 'Selected Active',
          isPrimary: false,
          needsReview: false,
          conditionRole: 'active_comorbidity',
        },
        {
          conditionId: 'condition-history',
          patientId: 'diagnosis-patient',
          name: 'History Only',
          isPrimary: false,
          needsReview: false,
          conditionRole: 'history_context',
        },
      ],
    } as PatientRecordSnapshot;
    const activePatient = normalizeActivePatient(snapshot, 'diagnosis-patient');
    const context = buildCaregiverAssistantContextFromSnapshot(snapshot);

    expect(activePatient.primaryDiagnosis?.name).toBe('Selected Primary');
    expect(activePatient.comorbidities).toEqual([
      expect.objectContaining({ name: 'Selected Active' }),
    ]);
    expect(context.primaryCondition?.name).toBe('Selected Primary');
    expect(context.comorbidities).toEqual([
      expect.objectContaining({ name: 'Selected Active' }),
    ]);
  });
});
