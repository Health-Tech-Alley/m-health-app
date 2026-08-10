import { useRouter } from "expo-router";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { DeviceSetupStep } from "@/components/models/DeviceSetupStep";
import { AppTheme } from "@/constants/theme";
import { useSettings } from "@/contexts/settings-context";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/hooks/use-translation";
import {
  SUPPORTED_APP_LANGUAGE_PREFERENCES,
  languagePreferenceLabel,
  normalizeSupportedLanguagePreference,
  type SupportedAppLanguagePreference,
  type TranslateFn,
  type TranslationKey,
} from "@/localization/i18n";
import {
  refreshPatientRecord,
  selectPatientRecord,
  usePatientRecord,
} from "@/contexts/patient-record-context";
import patientProfiles from "@/data/fhir/patient-profiles";
import { AppleHealthSource } from "@/data/sensors/apple-health-source";
import { ALL_HEALTHKIT_READ_TYPES } from "@/data/sensors/healthkit-type-map";
import { useBundledEhrImport } from "@/hooks/useBundledEhrImport";
import {
  applyDemoOnboardingPreset,
  getDemoOnboardingOptions,
  type DemoOnboardingProfileId,
} from "@/services/onboarding/demoOnboardingPresets";
import {
  COMMON_SYMPTOM_OPTIONS,
  WEARABLE_DEVICE_OPTIONS,
  completeOnboardingProfileForImportedPatient,
  completeOnboardingProfile,
  consumePendingOnboardingDemoProfileId,
  getOnboardingProfile,
  type AddressProfile,
  type Availability,
  type CaregivingExperience,
  type EmergencyComfortLevel,
  type MedicalComfortLevel,
  type NotificationStyle,
  type ImportedPatientManualFields,
  type OnboardingProfile,
  type SymptomProfile,
  type WearableBaselineStatus,
  type WearableDeviceType,
} from "@/services/onboarding/onboardingService";

const totalScreens = 7;
const formStepCount = 6;

const experienceOptions: CaregivingExperience[] = [
  "First time",
  "Some experience",
  "Experienced",
  "Medical background",
];

const availabilityOptions: Availability[] = [
  "Full time",
  "Mornings",
  "Evenings & weekends",
  "On-call only",
];

const notificationOptions: NotificationStyle[] = [
  "Push + sound",
  "Vibrate only",
  "Push only",
  "Text message",
];

const languageOptions = SUPPORTED_APP_LANGUAGE_PREFERENCES;

const appearanceOptions = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
] as const;

const medicalComfortOptions: MedicalComfortLevel[] = [
  "Keep it simple",
  "Moderate detail",
  "Full clinical detail",
];

const emergencyComfortOptions: EmergencyComfortLevel[] = [
  "Would call 911 if needed",
  "Prefer provider first",
  "Not sure — guide me",
];

const experienceOptionKeys: Record<CaregivingExperience, TranslationKey> = {
  "First time": "onboarding.caregiving.experience.firstTime",
  "Some experience": "onboarding.caregiving.experience.someExperience",
  Experienced: "onboarding.caregiving.experience.experienced",
  "Medical background": "onboarding.caregiving.experience.medicalBackground",
};

const availabilityOptionKeys: Record<Availability, TranslationKey> = {
  "Full time": "onboarding.caregiving.availability.fullTime",
  Mornings: "onboarding.caregiving.availability.mornings",
  "Evenings & weekends": "onboarding.caregiving.availability.eveningsWeekends",
  "On-call only": "onboarding.caregiving.availability.onCallOnly",
};

const notificationOptionKeys: Record<NotificationStyle, TranslationKey> = {
  "Push + sound": "onboarding.notifications.pushSound",
  "Vibrate only": "onboarding.notifications.vibrateOnly",
  "Push only": "onboarding.notifications.pushOnly",
  "Text message": "onboarding.notifications.textMessage",
};

const medicalComfortOptionKeys: Record<MedicalComfortLevel, TranslationKey> = {
  "Keep it simple": "onboarding.medicalComfort.simple",
  "Moderate detail": "onboarding.medicalComfort.moderate",
  "Full clinical detail": "onboarding.medicalComfort.full",
};

const emergencyComfortOptionKeys: Record<EmergencyComfortLevel, TranslationKey> = {
  "Would call 911 if needed": "onboarding.emergencyComfort.call911",
  "Prefer provider first": "onboarding.emergencyComfort.providerFirst",
  "Not sure — guide me": "onboarding.emergencyComfort.notSure",
};

const symptomOptionKeys: Record<string, TranslationKey> = {
  "shortness-of-breath": "onboarding.patient.symptoms.shortnessOfBreath",
  wheezing: "onboarding.patient.symptoms.wheezing",
  "persistent-cough": "onboarding.patient.symptoms.persistentCough",
  "low-oxygen": "onboarding.patient.symptoms.lowOxygen",
  "chest-tightness": "onboarding.patient.symptoms.chestTightness",
  "fast-heart-rate": "onboarding.patient.symptoms.fastHeartRate",
  dizziness: "onboarding.patient.symptoms.dizziness",
  confusion: "onboarding.patient.symptoms.confusion",
  weakness: "onboarding.patient.symptoms.weakness",
  "reduced-mobility": "onboarding.patient.symptoms.reducedMobility",
  "falls-risk": "onboarding.patient.symptoms.fallsRisk",
  fatigue: "onboarding.patient.symptoms.fatigue",
  fever: "onboarding.patient.symptoms.fever",
  pain: "onboarding.patient.symptoms.pain",
  "sleep-change": "onboarding.patient.symptoms.sleepChange",
  "appetite-change": "onboarding.patient.symptoms.appetiteChange",
};

const wearableDeviceOptionKeys: Record<WearableDeviceType, TranslationKey> = {
  "Apple Watch": "onboarding.device.type.appleWatch",
  Fitbit: "onboarding.device.type.fitbit",
  Garmin: "onboarding.device.type.garmin",
  "Samsung Galaxy Watch": "onboarding.device.type.samsung",
  "Oura Ring": "onboarding.device.type.oura",
  "Phone only": "onboarding.device.type.phoneOnly",
  "No device yet": "onboarding.device.type.noDevice",
  Other: "onboarding.device.type.other",
};

type ExpandedSelect =
  | "symptoms"
  | "gmfcs"
  | "fms"
  | "macs"
  | "cfcs"
  | "edacs"
  | null;

type EhrImportRequest = {
  patientId: string;
  profileId: string;
};

type ImportedEhrFieldLocks = Partial<
  Record<
    | "fullName"
    | "age"
    | "conditions"
    | "medications"
    | "spo2Cutoff"
    | "baselineHeartRate",
    boolean
  >
>;

type MobilityOption = {
  value: string;
  label: string;
  description: string;
  detail?: string;
  icon: AppIconName;
};

const gmfcsOptions: MobilityOption[] = [
  {
    value: "Not assessed",
    label: "Not assessed",
    description: "No assessment result in the health record",
    icon: "mobility",
  },
  {
    value: "I",
    label: "Level I",
    description: "Walks without major limits",
    detail: "Score 1",
    icon: "walk-independent",
  },
  {
    value: "II",
    label: "Level II",
    description: "Walks with some limits",
    detail: "Score 2",
    icon: "walk-limited",
  },
  {
    value: "III",
    label: "Level III",
    description: "Uses a hand-held mobility aid",
    detail: "Score 3",
    icon: "assisted-walking",
  },
  {
    value: "IV",
    label: "Level IV",
    description: "Uses assisted or powered mobility",
    detail: "Score 4",
    icon: "wheelchair-powered",
  },
  {
    value: "V",
    label: "Level V",
    description: "Transported in a wheelchair, needs significant support",
    detail: "Score 5",
    icon: "transport-wheelchair",
  },
];

const fmsOptions: MobilityOption[] = [
  {
    value: "Not assessed",
    label: "Not assessed",
    description: "No assessment result in the health record",
    icon: "mobility",
  },
  {
    value: "1",
    label: "1",
    description: "Uses wheelchair",
    icon: "wheelchair-manual",
  },
  {
    value: "2",
    label: "2",
    description: "Uses walker/frame",
    icon: "walker",
  },
  {
    value: "3",
    label: "3",
    description: "Uses crutches",
    icon: "crutches",
  },
  {
    value: "4",
    label: "4",
    description: "Uses sticks/canes",
    icon: "cane",
  },
  {
    value: "5",
    label: "5",
    description: "Independent on level surfaces",
    icon: "walk-independent",
  },
  {
    value: "6",
    label: "6",
    description: "Independent on all surfaces",
    icon: "all-surfaces",
  },
];

const macsOptions: MobilityOption[] = [
  {
    value: "Not assessed",
    label: "Not assessed",
    description: "No assessment result in the health record",
    icon: "mobility",
  },
  {
    value: "I",
    label: "Level I",
    description: "Handles objects easily",
    icon: "check",
  },
  {
    value: "II",
    label: "Level II",
    description: "Handles most objects more slowly",
    icon: "note",
  },
  {
    value: "III",
    label: "Level III",
    description: "Needs help preparing or adapting tasks",
    icon: "mobilityAid",
  },
  {
    value: "IV",
    label: "Level IV",
    description: "Handles a limited selection with support",
    icon: "assisted-walking",
  },
  {
    value: "V",
    label: "Level V",
    description: "Needs full assistance",
    icon: "care",
  },
];

const cfcsOptions: MobilityOption[] = [
  {
    value: "Not assessed",
    label: "Not assessed",
    description: "No assessment result in the health record",
    icon: "mobility",
  },
  {
    value: "I",
    label: "Level I",
    description: "Communicates effectively with most people",
    icon: "messages",
  },
  {
    value: "II",
    label: "Level II",
    description: "Communicates effectively, but more slowly",
    icon: "note",
  },
  {
    value: "III",
    label: "Level III",
    description: "Communicates best with familiar people",
    icon: "care",
  },
  {
    value: "IV",
    label: "Level IV",
    description: "Communication is inconsistent with familiar people",
    icon: "alert",
  },
  {
    value: "V",
    label: "Level V",
    description: "Communication is rarely effective",
    icon: "provider",
  },
];

const edacsOptions: MobilityOption[] = [
  {
    value: "Not assessed",
    label: "Not assessed",
    description: "No assessment result in the health record",
    icon: "mobility",
  },
  {
    value: "I",
    label: "Level I",
    description: "Eats and drinks safely and efficiently",
    icon: "check",
  },
  {
    value: "II",
    label: "Level II",
    description: "Safe, with some limits to efficiency",
    icon: "note",
  },
  {
    value: "III",
    label: "Level III",
    description: "Some safety limits and may need support",
    icon: "mobilityAid",
  },
  {
    value: "IV",
    label: "Level IV",
    description: "Significant safety limits",
    icon: "alert",
  },
  {
    value: "V",
    label: "Level V",
    description: "Unable to eat or drink safely by mouth",
    icon: "care",
  },
];

function normalizeClassificationValue(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (trimmed === "Not assessed") return trimmed;

  const levelMatch = trimmed.match(/^Level\s+([IVX]+)$/i);
  if (levelMatch) {
    return levelMatch[1].toUpperCase();
  }

  return trimmed;
}

function formatClassificationValue(
  value: string,
  options: MobilityOption[],
  t: TranslateFn,
  prefix?: string,
): string {
  if (!value) return t("onboarding.classification.notSelected");
  const option = options.find((item) => item.value === value);
  if (!option) return value;
  if (option.value === "Not assessed") return option.label;
  return prefix ? `${prefix} ${option.value}` : option.detail ?? option.label;
}

function translateOption<T extends string>(
  option: T,
  keys: Record<T, TranslationKey>,
  t: TranslateFn,
): string {
  return t(keys[option]);
}

function getSymptomLabel(option: SymptomProfile, t: TranslateFn): string {
  const key = symptomOptionKeys[option.id];
  return key ? t(key) : option.label;
}

type MobilityKind = "gmfcs" | "fms" | "macs" | "cfcs" | "edacs";

function translateMobilityOptions(
  kind: MobilityKind,
  options: MobilityOption[],
  t: TranslateFn,
): MobilityOption[] {
  return options.map((option) => ({
    ...option,
    label: getMobilityLabel(option.value, t),
    description: getMobilityDescription(kind, option.value, option.description, t),
    detail: option.detail
      ? getMobilityDetail(option.value, option.detail, t)
      : undefined,
  }));
}

function getMobilityLabel(value: string, t: TranslateFn): string {
  if (value === "Not assessed") {
    return t("onboarding.classification.notAssessed.label");
  }
  if (value === "I") return t("onboarding.classification.levelI");
  if (value === "II") return t("onboarding.classification.levelII");
  if (value === "III") return t("onboarding.classification.levelIII");
  if (value === "IV") return t("onboarding.classification.levelIV");
  if (value === "V") return t("onboarding.classification.levelV");
  return value;
}

function getMobilityDetail(
  value: string,
  fallback: string,
  t: TranslateFn,
): string {
  if (value === "I") return t("onboarding.classification.score1");
  if (value === "II") return t("onboarding.classification.score2");
  if (value === "III") return t("onboarding.classification.score3");
  if (value === "IV") return t("onboarding.classification.score4");
  if (value === "V") return t("onboarding.classification.score5");
  return fallback;
}

function getMobilityDescription(
  kind: MobilityKind,
  value: string,
  fallback: string,
  t: TranslateFn,
): string {
  if (value === "Not assessed") {
    return t("onboarding.classification.notAssessed.description");
  }

  const key = getMobilityDescriptionKey(kind, value);
  return key ? t(key) : fallback;
}

function getMobilityDescriptionKey(
  kind: MobilityKind,
  value: string,
): TranslationKey | null {
  if (kind === "gmfcs") {
    if (value === "I") return "onboarding.classification.gmfcs.i";
    if (value === "II") return "onboarding.classification.gmfcs.ii";
    if (value === "III") return "onboarding.classification.gmfcs.iii";
    if (value === "IV") return "onboarding.classification.gmfcs.iv";
    if (value === "V") return "onboarding.classification.gmfcs.v";
  }
  if (kind === "fms") {
    if (value === "1") return "onboarding.classification.fms.1";
    if (value === "2") return "onboarding.classification.fms.2";
    if (value === "3") return "onboarding.classification.fms.3";
    if (value === "4") return "onboarding.classification.fms.4";
    if (value === "5") return "onboarding.classification.fms.5";
    if (value === "6") return "onboarding.classification.fms.6";
  }
  if (kind === "macs") {
    if (value === "I") return "onboarding.classification.macs.i";
    if (value === "II") return "onboarding.classification.macs.ii";
    if (value === "III") return "onboarding.classification.macs.iii";
    if (value === "IV") return "onboarding.classification.macs.iv";
    if (value === "V") return "onboarding.classification.macs.v";
  }
  if (kind === "cfcs") {
    if (value === "I") return "onboarding.classification.cfcs.i";
    if (value === "II") return "onboarding.classification.cfcs.ii";
    if (value === "III") return "onboarding.classification.cfcs.iii";
    if (value === "IV") return "onboarding.classification.cfcs.iv";
    if (value === "V") return "onboarding.classification.cfcs.v";
  }
  if (kind === "edacs") {
    if (value === "I") return "onboarding.classification.edacs.i";
    if (value === "II") return "onboarding.classification.edacs.ii";
    if (value === "III") return "onboarding.classification.edacs.iii";
    if (value === "IV") return "onboarding.classification.edacs.iv";
    if (value === "V") return "onboarding.classification.edacs.v";
  }
  return null;
}

function cleanImportedText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function formatImportedMedication(medication: {
  name: string;
  dosage?: string;
  frequency?: string;
  route?: string;
}): string {
  const name = cleanImportedText(medication.name);
  if (!name) return "";

  const details = [
    medication.dosage,
    medication.frequency,
    medication.route,
  ]
    .map(cleanImportedText)
    .filter(Boolean);

  return [name, ...details].join(" - ");
}

function getImportedEhrStatusText(bundleStatus: {
  state: "in_flight" | "complete" | "failed";
  chunksAdded: number;
  error?: string;
} | undefined, t: TranslateFn): string {
  if (bundleStatus?.state === "in_flight") {
    return t("onboarding.patient.ehr.status.inFlight");
  }
  if (bundleStatus?.state === "failed") {
    return t("onboarding.patient.ehr.status.failed");
  }

  return t("onboarding.patient.ehr.status.ready");
}

export default function OnboardingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useMemo(() => createThemedStyles(theme), [theme]);
  const { t, setTemporaryLanguagePreference, clearTemporaryLanguagePreference } = useTranslation();
  const existingProfile = getOnboardingProfile();
  const { snapshot, ready } = usePatientRecord();
  const {
    settings,
    setTheme,
    setLanguagePreference: persistLanguagePreference,
    setSimulateMissingOptionalFeatures,
  } = useSettings();
  const { importBundledEhrProfile } = useBundledEhrImport();

  const [stepIndex, setStepIndex] = useState(0);
  const [expandedSelect, setExpandedSelect] = useState<ExpandedSelect>(null);
  const [ehrImportRequest, setEhrImportRequest] =
    useState<EhrImportRequest | null>(null);
  const [ehrImporting, setEhrImporting] = useState(false);
  const [ehrImportError, setEhrImportError] = useState<string | null>(null);
  const [importedEhrFields, setImportedEhrFields] =
    useState<ImportedEhrFieldLocks>({});
  const [
    appliedImportedEhrRequestKey,
    setAppliedImportedEhrRequestKey,
  ] = useState<string | null>(null);
  const [selectedDemoProfileId, setSelectedDemoProfileId] = useState<
    DemoOnboardingProfileId | null
  >((existingProfile.demoProfileId as DemoOnboardingProfileId | undefined) ?? null);

  const [caregiverName, setCaregiverName] = useState(
    existingProfile.caregiver.name,
  );
  const [relationship, setRelationship] = useState(
    existingProfile.caregiver.relationship,
  );
  const [caregiverPhone, setCaregiverPhone] = useState(
    existingProfile.caregiver.phone,
  );

  const [caregiverAddress, setCaregiverAddress] = useState<AddressProfile>({
    line1: existingProfile.caregiver.address?.line1 ?? "",
    line2: existingProfile.caregiver.address?.line2 ?? "",
    city: existingProfile.caregiver.address?.city ?? "",
    state: existingProfile.caregiver.address?.state ?? "",
    postalCode: existingProfile.caregiver.address?.postalCode ?? "",
    country: existingProfile.caregiver.address?.country ?? "United States",
  });

  const [experience, setExperience] = useState<CaregivingExperience>(
    existingProfile.caregiver.experience ?? "Some experience",
  );
  const [availability, setAvailability] = useState<Availability>(
    existingProfile.caregiver.availability ?? "Evenings & weekends",
  );
  const [notificationStyle, setNotificationStyle] =
    useState<NotificationStyle>(
      existingProfile.caregiver.notificationStyle ?? "Push + sound",
    );
  const [languagePreference, setLanguagePreference] =
    useState<SupportedAppLanguagePreference>(
      normalizeSupportedLanguagePreference(settings.languagePreference),
    );
  useEffect(() => {
    setTemporaryLanguagePreference(languagePreference);
    return clearTemporaryLanguagePreference;
  }, [
    clearTemporaryLanguagePreference,
    languagePreference,
    setTemporaryLanguagePreference,
  ]);

  const [medicalComfortLevel, setMedicalComfortLevel] =
    useState<MedicalComfortLevel>(
      existingProfile.caregiver.medicalComfortLevel ?? "Moderate detail",
    );
  const [emergencyComfortLevel, setEmergencyComfortLevel] =
    useState<EmergencyComfortLevel>(
      existingProfile.caregiver.emergencyComfortLevel ??
        "Would call 911 if needed",
    );

  const [mainConcern, setMainConcern] = useState(
    existingProfile.caregiver.mainConcern ?? "",
  );
  const [hobbiesOrRoutines, setHobbiesOrRoutines] = useState(
    existingProfile.caregiver.hobbiesOrRoutines ?? "",
  );
  const [stressOrSupportNeeds, setStressOrSupportNeeds] = useState(
    existingProfile.caregiver.stressOrSupportNeeds ?? "",
  );
  const [backupCaregiver, setBackupCaregiver] = useState(
    existingProfile.caregiver.backupCaregiver ?? "",
  );

  const [patientPreferredName, setPatientPreferredName] = useState(
    existingProfile.patient.preferredName ?? existingProfile.patient.name,
  );
  const [patientFullName, setPatientFullName] = useState(
    existingProfile.patient.officialDisplayName ??
      existingProfile.patient.name ??
      "",
  );
  const [patientAge, setPatientAge] = useState(
    existingProfile.patient.age ?? "",
  );
  const [patientConditions, setPatientConditions] = useState(
    existingProfile.patient.conditions ?? "",
  );
  const [patientCurrentMedications, setPatientCurrentMedications] = useState(
    existingProfile.patient.currentMedications ?? "",
  );

  const [patientAddressSameAsCaregiver, setPatientAddressSameAsCaregiver] =
    useState(existingProfile.patient.addressSameAsCaregiver ?? true);

  const [patientAddress, setPatientAddress] = useState<AddressProfile>({
    line1: existingProfile.patient.address?.line1 ?? "",
    line2: existingProfile.patient.address?.line2 ?? "",
    city: existingProfile.patient.address?.city ?? "",
    state: existingProfile.patient.address?.state ?? "",
    postalCode: existingProfile.patient.address?.postalCode ?? "",
    country: existingProfile.patient.address?.country ?? "United States",
  });

  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>(
    existingProfile.patient.symptoms ?? [],
  );
  const [symptomSearch, setSymptomSearch] = useState("");
  const [otherSymptoms, setOtherSymptoms] = useState(
    existingProfile.patient.otherSymptoms ?? "",
  );

  const [baselineDailyRoutine, setBaselineDailyRoutine] = useState(
    existingProfile.patient.baselineDailyRoutine ?? "",
  );
  const [spo2Cutoff, setSpo2Cutoff] = useState(
    existingProfile.patient.spo2Cutoff ?? "",
  );
  const [baselineHeartRate, setBaselineHeartRate] = useState(
    existingProfile.patient.baselineHeartRate ?? "",
  );
  const [baselineBloodOxygen, setBaselineBloodOxygen] = useState(
    existingProfile.patient.baselineBloodOxygen ?? "",
  );
  const [baselineRespiratoryRate, setBaselineRespiratoryRate] = useState(
    existingProfile.patient.baselineRespiratoryRate ?? "",
  );
  const [baselineBloodPressureSystolic, setBaselineBloodPressureSystolic] =
    useState(existingProfile.patient.baselineBloodPressureSystolic ?? "");
  const [baselineBloodPressureDiastolic, setBaselineBloodPressureDiastolic] =
    useState(existingProfile.patient.baselineBloodPressureDiastolic ?? "");
  const [baselineGlucoseLevel, setBaselineGlucoseLevel] = useState(
    existingProfile.patient.baselineGlucoseLevel ?? "",
  );
  const [baselineBodyTemperature, setBaselineBodyTemperature] = useState(
    existingProfile.patient.baselineBodyTemperature ?? "",
  );

  const [gmfcsLevel, setGmfcsLevel] = useState(
    normalizeClassificationValue(existingProfile.patient.gmfcsLevel),
  );
  const [fmsScore, setFmsScore] = useState(
    normalizeClassificationValue(existingProfile.patient.fmsScore),
  );
  const [macsLevel, setMacsLevel] = useState(
    normalizeClassificationValue(existingProfile.patient.macsLevel),
  );
  const [cfcsLevel, setCfcsLevel] = useState(
    normalizeClassificationValue(existingProfile.patient.cfcsLevel),
  );
  const [edacsLevel, setEdacsLevel] = useState(
    normalizeClassificationValue(existingProfile.patient.edacsLevel),
  );

  function handleSelectDemoProfile(profileId: DemoOnboardingProfileId) {
    const base = getOnboardingProfile();
    const nextProfile = applyDemoOnboardingPreset(base, profileId);
    const caregiver = nextProfile.caregiver;

    setSelectedDemoProfileId(profileId);
    setEhrImportRequest(null);
    setEhrImportError(null);
    setImportedEhrFields({});
    setAppliedImportedEhrRequestKey(null);
    setCaregiverName(caregiver.name);
    setRelationship(caregiver.relationship);
    setCaregiverPhone(caregiver.phone);
    if (caregiver.experience) setExperience(caregiver.experience);
    if (caregiver.availability) setAvailability(caregiver.availability);
    if (caregiver.medicalComfortLevel) {
      setMedicalComfortLevel(caregiver.medicalComfortLevel);
    }
    setHobbiesOrRoutines(caregiver.hobbiesOrRoutines ?? "");
    setMainConcern(caregiver.mainConcern ?? "");
    setStressOrSupportNeeds(caregiver.stressOrSupportNeeds ?? "");
    setBackupCaregiver(caregiver.backupCaregiver ?? "");
    setPatientPreferredName(nextProfile.patient.preferredName ?? nextProfile.patient.name);
    setPatientFullName(nextProfile.patient.officialDisplayName ?? "");
    setPatientAge(nextProfile.patient.age ?? "");
    setPatientConditions(nextProfile.patient.conditions ?? "");
    setPatientCurrentMedications(nextProfile.patient.currentMedications ?? "");
    setSelectedSymptoms([]);
    setOtherSymptoms("");
    setBaselineDailyRoutine(nextProfile.patient.baselineDailyRoutine ?? "");
    setSpo2Cutoff(nextProfile.patient.spo2Cutoff ?? "");
    setBaselineHeartRate(nextProfile.patient.baselineHeartRate ?? "");
    setBaselineBloodOxygen("");
    setBaselineRespiratoryRate("");
    setBaselineBloodPressureSystolic("");
    setBaselineBloodPressureDiastolic("");
    setBaselineGlucoseLevel("");
    setBaselineBodyTemperature("");
    setGmfcsLevel("");
    setFmsScore("");
    setMacsLevel("");
    setCfcsLevel("");
    setEdacsLevel("");
    setProviderName(nextProfile.primaryCareProvider.name);
    setProviderPhone(nextProfile.primaryCareProvider.phone);
    setProviderEmail(nextProfile.primaryCareProvider.email);
    setEmergencyContact(nextProfile.safety?.emergencyContact ?? "");
    setSafetyNotes(nextProfile.safety?.safetyNotes ?? "");
    setEmergencyDisclaimerAccepted(
      nextProfile.safety?.emergencyDisclaimerAccepted ?? true,
    );
  }

  const [providerName, setProviderName] = useState(
    existingProfile.primaryCareProvider.name,
  );
  const [providerPhone, setProviderPhone] = useState(
    existingProfile.primaryCareProvider.phone,
  );
  const [providerEmail, setProviderEmail] = useState(
    existingProfile.primaryCareProvider.email,
  );

  const [emergencyContact, setEmergencyContact] = useState(
    existingProfile.safety?.emergencyContact ?? "",
  );
  const [safetyNotes, setSafetyNotes] = useState(
    existingProfile.safety?.safetyNotes ?? "",
  );
  const [emergencyDisclaimerAccepted, setEmergencyDisclaimerAccepted] =
    useState(existingProfile.safety?.emergencyDisclaimerAccepted ?? true);

  const [deviceType, setDeviceType] = useState<WearableDeviceType>(
    existingProfile.patient.wearableDevice?.deviceType ?? "Apple Watch",
  );
  const [deviceLabel, setDeviceLabel] = useState(
    existingProfile.patient.wearableDevice?.deviceLabel ?? "",
  );
  const [deviceConnected, setDeviceConnected] = useState(
    existingProfile.patient.wearableDevice?.connected ?? false,
  );
  const [baselineStatus, setBaselineStatus] =
    useState<WearableBaselineStatus>(
      existingProfile.patient.wearableDevice?.baselineStatus ?? "not_started",
    );
  const [baselineStartedAt, setBaselineStartedAt] = useState<
    string | undefined
  >(existingProfile.patient.wearableDevice?.baselineStartedAt);
  const [baselineCompletedAt, setBaselineCompletedAt] = useState<
    string | undefined
  >(existingProfile.patient.wearableDevice?.baselineCompletedAt);

  const translatedGmfcsOptions = useMemo(
    () => translateMobilityOptions("gmfcs", gmfcsOptions, t),
    [t],
  );
  const translatedFmsOptions = useMemo(
    () => translateMobilityOptions("fms", fmsOptions, t),
    [t],
  );
  const translatedMacsOptions = useMemo(
    () => translateMobilityOptions("macs", macsOptions, t),
    [t],
  );
  const translatedCfcsOptions = useMemo(
    () => translateMobilityOptions("cfcs", cfcsOptions, t),
    [t],
  );
  const translatedEdacsOptions = useMemo(
    () => translateMobilityOptions("edacs", edacsOptions, t),
    [t],
  );

  const selectedSymptomLabels = useMemo(
    () =>
      selectedSymptoms
        .map((symptomId) =>
          COMMON_SYMPTOM_OPTIONS.find((option) => option.id === symptomId),
        )
        .filter((option): option is SymptomProfile => Boolean(option))
        .map((option) => getSymptomLabel(option, t)),
    [selectedSymptoms, t],
  );

  const visibleSymptoms = useMemo(() => {
    const query = symptomSearch.trim().toLowerCase();

    return COMMON_SYMPTOM_OPTIONS.map((symptom) => ({
      ...symptom,
      label: getSymptomLabel(symptom, t),
    })).filter((symptom) => {
      if (!query) return true;
      return symptom.label.toLowerCase().includes(query);
    }).sort((a, b) => a.label.localeCompare(b.label));
  }, [symptomSearch, t]);

  const selectedEhrProfile = useMemo(
    () =>
      patientProfiles.find((profile) => profile.id === selectedDemoProfileId) ??
      null,
    [selectedDemoProfileId],
  );
  const canImportSelectedEhrProfile = Boolean(selectedEhrProfile) && !ehrImporting;
  const ehrImportSucceeded = Boolean(
    ehrImportRequest &&
      ready &&
      snapshot?.patient?.patientId === ehrImportRequest.patientId,
  );

  const importedEhrSummary = useMemo(() => {
    if (!ehrImportSucceeded || !snapshot?.patient) return null;

    const fullName = cleanImportedText(snapshot.patient.name);
    const age = cleanImportedText(snapshot.patient.age);
    const conditions = snapshot.conditions
      .map((condition) => cleanImportedText(condition.name))
      .filter(Boolean);
    const medications = snapshot.medications
      .map(formatImportedMedication)
      .map(cleanImportedText)
      .filter(Boolean);
    const spo2Cutoff = cleanImportedText(snapshot.patient.spo2Cutoff);
    const baselineHeartRate = cleanImportedText(
      snapshot.patient.baselineHeartRate,
    );

    return {
      fullName,
      age,
      conditions,
      medications,
      spo2Cutoff,
      baselineHeartRate,
      statusText: getImportedEhrStatusText(snapshot.bundleStatus, t),
    };
  }, [ehrImportSucceeded, snapshot, t]);

  useEffect(() => {
    if (!importedEhrSummary || !ehrImportRequest) return;

    const requestKey = `${ehrImportRequest.profileId}:${ehrImportRequest.patientId}`;
    if (appliedImportedEhrRequestKey === requestKey) return;

    const nextImportedFields: ImportedEhrFieldLocks = {};
    const conditionsText = importedEhrSummary.conditions.join(", ");
    const medicationsText = importedEhrSummary.medications.join(", ");
    const nextFullName = importedEhrSummary.fullName;
    const nextAge = importedEhrSummary.age;
    const nextSpo2Cutoff = importedEhrSummary.spo2Cutoff;
    const nextBaselineHeartRate = importedEhrSummary.baselineHeartRate;

    if (nextFullName) nextImportedFields.fullName = true;
    if (nextAge) nextImportedFields.age = true;
    if (conditionsText) nextImportedFields.conditions = true;
    if (medicationsText) nextImportedFields.medications = true;
    if (nextSpo2Cutoff) nextImportedFields.spo2Cutoff = true;
    if (nextBaselineHeartRate) nextImportedFields.baselineHeartRate = true;

    // Defer setState out of the effect body (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      if (nextFullName) setPatientFullName(nextFullName);
      if (nextAge) setPatientAge(nextAge);
      if (conditionsText) setPatientConditions(conditionsText);
      if (medicationsText) setPatientCurrentMedications(medicationsText);
      if (nextSpo2Cutoff) setSpo2Cutoff(nextSpo2Cutoff);
      if (nextBaselineHeartRate) setBaselineHeartRate(nextBaselineHeartRate);
      setImportedEhrFields(nextImportedFields);
      setAppliedImportedEhrRequestKey(requestKey);
    }, 0);

    return () => clearTimeout(timer);
  }, [
    appliedImportedEhrRequestKey,
    ehrImportRequest,
    importedEhrSummary,
  ]);

  // Developer "Re-run onboarding" clears completion and queues a demo preset.
  useEffect(() => {
    const pending = consumePendingOnboardingDemoProfileId();
    if (!pending) return;
    const known = getDemoOnboardingOptions().some((o) => o.id === pending);
    if (!known) return;
    const handle = setTimeout(() => {
      handleSelectDemoProfile(pending as DemoOnboardingProfileId);
    }, 0);
    return () => clearTimeout(handle);
    // Mount-only: apply queued demo once when the wizard opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isIntroScreen = stepIndex === 0;
  const canGoBack = stepIndex > 0;
  const isWearableStep = stepIndex === 5;
  const isDeviceSetupStep = stepIndex === 6;
  const isFinalStep = isDeviceSetupStep;
  const formStepNumber = Math.max(stepIndex, 1);
  const progressLabels = useMemo(
    () => [
      t("onboarding.progress.caregiver"),
      t("onboarding.progress.caregiving"),
      t("onboarding.progress.patient"),
      t("onboarding.progress.safety"),
      t("onboarding.progress.device"),
      t("onboarding.progress.setup"),
    ],
    [t],
  );
  const primaryButtonLabel = isIntroScreen
    ? t("onboarding.action.start")
    : isFinalStep
      ? t("onboarding.action.continueHome")
      : t("common.continue");

  const deviceSetupRunnerOptions = useMemo(() => {
    const conditions = patientConditions
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const medications = patientCurrentMedications
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      conditions,
      medications,
      location: patientAddress.city || caregiverAddress.city || undefined,
    };
  }, [
    patientConditions,
    patientCurrentMedications,
    patientAddress.city,
    caregiverAddress.city,
  ]);

  function goBack() {
    if (canGoBack) {
      setExpandedSelect(null);
      // Do not go back from Device setup into a re-seed loop casually — allow once.
      setStepIndex((current) => current - 1);
    }
  }

  function goNext() {
    setExpandedSelect(null);

    if (isWearableStep) {
      void saveProfileThenDeviceSetup();
      return;
    }

    if (isFinalStep) {
      void finishOnboardingFromDeviceSetup();
      return;
    }

    setStepIndex((current) => Math.min(current + 1, totalScreens - 1));
  }

  async function finishOnboardingFromDeviceSetup() {
    persistLanguagePreference(languagePreference);
    // First-run guard: never leave the developer "Simulate missing Concierge /
    // knowledge" flag on after onboarding — it would hide the SLM from a
    // caregiver even when a model is installed.
    setSimulateMissingOptionalFeatures(false);
    router.replace("/dashboard");
  }

  async function saveProfileThenDeviceSetup() {
    await saveProfileAndContinue({ advanceToDeviceSetup: true });
  }

  async function handleImportSelectedEhrProfile() {
    if (ehrImporting || !selectedEhrProfile) return;

    setEhrImportError(null);
    setImportedEhrFields({});
    setAppliedImportedEhrRequestKey(null);
    setEhrImporting(true);

    try {
      const result = await importBundledEhrProfile(selectedEhrProfile);
      if (!result.patientId) {
        setEhrImportRequest(null);
        setEhrImportError(t("onboarding.patient.ehr.error.importUnavailable"));
        return;
      }

      setEhrImportRequest({
        patientId: result.patientId,
        profileId: selectedEhrProfile.id,
      });
    } catch (error) {
      console.error("Failed to import onboarding EHR profile", error);
      setEhrImportRequest(null);
      setEhrImportError(t("onboarding.patient.ehr.error.importFailed"));
    } finally {
      setEhrImporting(false);
    }
  }

  async function saveProfileAndContinue(opts?: { advanceToDeviceSetup?: boolean }) {
    const finalPatientAddress = patientAddressSameAsCaregiver
      ? caregiverAddress
      : patientAddress;
    const finalPatientFullName =
      patientFullName.trim() || patientPreferredName.trim();

    const profile: OnboardingProfile = {
      demoProfileId: selectedDemoProfileId ?? undefined,
      caregiver: {
        name: caregiverName,
        relationship,
        phone: caregiverPhone,
        address: caregiverAddress,
        experience,
        availability,
        notificationStyle,
        languagePreference,
        medicalComfortLevel,
        emergencyComfortLevel,
        hobbiesOrRoutines,
        mainConcern,
        stressOrSupportNeeds,
        backupCaregiver,
      },
      patient: {
        name: finalPatientFullName,
        preferredName: patientPreferredName,
        officialDisplayName: patientFullName,
        age: patientAge,
        conditions: patientConditions,
        addressSameAsCaregiver: patientAddressSameAsCaregiver,
        address: finalPatientAddress,
        symptoms: selectedSymptoms,
        otherSymptoms,
        baselineDailyRoutine,
        currentMedications: patientCurrentMedications,
        spo2Cutoff,
        baselineHeartRate,
        baselineBloodOxygen,
        baselineRespiratoryRate,
        baselineBloodPressureSystolic,
        baselineBloodPressureDiastolic,
        baselineGlucoseLevel,
        baselineBodyTemperature,
        gmfcsLevel,
        fmsScore,
        macsLevel,
        cfcsLevel,
        edacsLevel,
        wearableDevice: {
          deviceType,
          deviceLabel,
          connected: deviceConnected,
          baselineStatus,
          baselineStartedAt,
          baselineCompletedAt,
        },
      },
      primaryCareProvider: {
        name: providerName,
        phone: providerPhone,
        email: providerEmail,
      },
      safety: {
        emergencyContact,
        safetyNotes,
        emergencyDisclaimerAccepted,
      },
      clinicalImport: existingProfile.clinicalImport,
      completedAt: new Date().toISOString(),
    };
    persistLanguagePreference(languagePreference);

    if (ehrImportRequest) {
      const importedPatientId = ehrImportRequest.patientId;
      if (!ready || snapshot?.patient?.patientId !== importedPatientId) {
        setEhrImportError(
          t("onboarding.patient.ehr.error.patientInactive"),
        );
        setStepIndex(3);
        return;
      }

      const manualFields: ImportedPatientManualFields = {};
      const manualFullName = importedEhrFields.fullName
        ? ""
        : finalPatientFullName.trim();
      const manualAge = importedEhrFields.age ? "" : patientAge.trim();
      const manualConditions = importedEhrFields.conditions
        ? ""
        : patientConditions.trim();
      const manualCurrentMedications = importedEhrFields.medications
        ? ""
        : patientCurrentMedications.trim();
      const manualSpo2Cutoff = importedEhrFields.spo2Cutoff
        ? ""
        : spo2Cutoff.trim();
      const manualBaselineHeartRate = importedEhrFields.baselineHeartRate
        ? ""
        : baselineHeartRate.trim();

      if (manualFullName) manualFields.fullName = manualFullName;
      if (manualAge) manualFields.age = manualAge;
      if (manualConditions) manualFields.conditions = manualConditions;
      if (manualCurrentMedications) {
        manualFields.currentMedications = manualCurrentMedications;
      }
      if (manualSpo2Cutoff) manualFields.spo2Cutoff = manualSpo2Cutoff;
      if (manualBaselineHeartRate) {
        manualFields.baselineHeartRate = manualBaselineHeartRate;
      }

      try {
        const result = await completeOnboardingProfileForImportedPatient(
          profile,
          importedPatientId,
          manualFields,
        );
        if (result.patientId !== importedPatientId) {
          throw new Error("Imported patient completion returned a different patient.");
        }
        selectPatientRecord(importedPatientId);
        refreshPatientRecord(importedPatientId);
        if (opts?.advanceToDeviceSetup) {
          setStepIndex(6);
          return;
        }
        // First-run guard: clear the developer "Simulate missing" flag so the
        // SLM is never hidden from a freshly onboarded caregiver.
        setSimulateMissingOptionalFeatures(false);
        router.replace("/dashboard");
      } catch (error) {
        console.error("Failed to complete onboarding for imported patient", error);
        setEhrImportError(
          t("onboarding.patient.ehr.error.completionFailed"),
        );
        setStepIndex(3);
      }
      return;
    }

    const result = await completeOnboardingProfile(profile);
    if (result.patientId) {
      selectPatientRecord(result.patientId);
    }
    if (opts?.advanceToDeviceSetup) {
      setStepIndex(6);
      return;
    }
    // First-run guard: clear the developer "Simulate missing" flag so the SLM
    // is never hidden from a freshly onboarded caregiver.
    setSimulateMissingOptionalFeatures(false);
    router.replace("/dashboard");
  }

  function updateCaregiverAddress(field: keyof AddressProfile, value: string) {
    setCaregiverAddress((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updatePatientAddress(field: keyof AddressProfile, value: string) {
    setPatientAddress((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function toggleSymptom(symptomId: string) {
    setSelectedSymptoms((current) => {
      if (current.includes(symptomId)) {
        return current.filter((id) => id !== symptomId);
      }

      return [...current, symptomId];
    });
  }

  async function connectAppleWatch() {
    const startedAt = new Date().toISOString();
    setBaselineStartedAt(startedAt);
    setBaselineStatus("not_started");
    setDeviceConnected(false);

    try {
      const source = new AppleHealthSource({
        patientId: 'onboarding-temp',
        types: ALL_HEALTHKIT_READ_TYPES,
      });

      const available = await source.isHealthDataAvailable();
      if (!available) {
        const completedAt = new Date().toISOString();
        setDeviceConnected(true);
        setBaselineStatus("simulated");
        setBaselineCompletedAt(completedAt);
        return;
      }

      const result = await source.requestPermissions(ALL_HEALTHKIT_READ_TYPES);

      if (result.granted) {
        const completedAt = new Date().toISOString();
        setDeviceConnected(true);
        setBaselineStatus("connected");
        setBaselineCompletedAt(completedAt);
      } else {
        setBaselineStatus("failed");
        if (result.deniedTypes?.length) {
          console.warn(
            '[onboarding] HealthKit denied for types:',
            result.deniedTypes,
          );
        }
      }
    } catch (err) {
      console.error('[onboarding] Apple Watch connection failed:', err);
      setBaselineStatus("failed");
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.keyboardRoot}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.root}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.content,
              isIntroScreen && styles.introContent,
            ]}
            keyboardShouldPersistTaps="handled"
          >
            {!isIntroScreen ? (
              <>
                <View style={styles.topBar}>
                  <Pressable
                    style={styles.backButton}
                    onPress={goBack}
                    disabled={!canGoBack}
                    accessibilityRole="button"
                    accessibilityLabel={t("onboarding.action.back")}
                    accessibilityState={{ disabled: !canGoBack }}
                  >
                    <Text style={styles.backIcon}>‹</Text>
                  </Pressable>

                  <View style={styles.headerCenter}>
                    <Text style={styles.kicker}>{t("common.appName")}</Text>
                    <Text style={styles.stepCount}>
                      {t("onboarding.stepCount", {
                        current: formStepNumber,
                        total: formStepCount,
                      })}
                    </Text>
                  </View>

                  <View style={styles.topSpacer} />
                </View>

                <ProgressTracker activeIndex={formStepNumber - 1} labels={progressLabels} />
              </>
            ) : null}

            {stepIndex === 0 ? (
              <WelcomeStep
                selectedDemoProfileId={selectedDemoProfileId}
                onSelectDemoProfile={handleSelectDemoProfile}
              />
            ) : null}

            {stepIndex === 1 ? (
              <StepShell
                title={t("onboarding.about.title")}
                subtitle={t("onboarding.about.subtitle")}
              >
                <Field
                  label={t("onboarding.about.caregiverName.label")}
                  value={caregiverName}
                  onChangeText={setCaregiverName}
                  placeholder={t("onboarding.about.caregiverName.placeholder")}
                />

                <Field
                  label={t("onboarding.about.relationship.label")}
                  value={relationship}
                  onChangeText={setRelationship}
                  placeholder={t("onboarding.about.relationship.placeholder")}
                />

                <Field
                  label={t("onboarding.about.phone.label")}
                  value={caregiverPhone}
                  onChangeText={setCaregiverPhone}
                  placeholder={t("onboarding.about.phone.placeholder")}
                  keyboardType="phone-pad"
                />

                <SectionLabel title={t("onboarding.about.address")} />

                <AddressFields
                  address={caregiverAddress}
                  onChange={updateCaregiverAddress}
                />
              </StepShell>
            ) : null}

            {stepIndex === 2 ? (
              <StepShell
                title={t("onboarding.caregiving.title")}
                subtitle={t("onboarding.caregiving.subtitle")}
              >
                <ChipGroup
                  label={t("onboarding.caregiving.experience")}
                  options={experienceOptions}
                  selectedValue={experience}
                  onSelect={setExperience}
                  getOptionLabel={(option) =>
                    translateOption(option, experienceOptionKeys, t)
                  }
                />

                <ChipGroup
                  label={t("onboarding.caregiving.availability")}
                  options={availabilityOptions}
                  selectedValue={availability}
                  onSelect={setAvailability}
                  getOptionLabel={(option) =>
                    translateOption(option, availabilityOptionKeys, t)
                  }
                />

                <SectionLabel title={t("onboarding.preferences")} />

                <ChipGroup
                  label={t("onboarding.notifications")}
                  options={notificationOptions}
                  selectedValue={notificationStyle}
                  onSelect={setNotificationStyle}
                  getOptionLabel={(option) =>
                    translateOption(option, notificationOptionKeys, t)
                  }
                />

                <ChipGroup
                  label={t("onboarding.language.label")}
                  options={languageOptions}
                  selectedValue={languagePreference}
                  onSelect={setLanguagePreference}
                  getOptionLabel={(option) => languagePreferenceLabel(option, t)}
                />

                <View style={styles.chipBlock}>
                  <Text style={styles.fieldLabel}>{t("onboarding.appearance.label")}</Text>

                  <View style={styles.chipRow}>
                    {appearanceOptions.map(({ value }) => {
                      const selected = settings.theme === value;
                      const displayLabel =
                        value === "system"
                          ? t("onboarding.appearance.system")
                          : value === "light"
                            ? t("onboarding.appearance.light")
                            : t("onboarding.appearance.dark");

                      return (
                        <Pressable
                          key={value}
                          style={[
                            styles.chip,
                            selected && styles.chipSelected,
                          ]}
                          onPress={() => setTheme(value)}
                          accessibilityRole="button"
                          accessibilityLabel={t("onboarding.appearance.accessibility", {
                            label: displayLabel,
                          })}
                          accessibilityState={{ selected }}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              selected && styles.chipTextSelected,
                            ]}
                          >
                            {displayLabel}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <ChipGroup
                  label={t("onboarding.medicalComfort")}
                  options={medicalComfortOptions}
                  selectedValue={medicalComfortLevel}
                  onSelect={setMedicalComfortLevel}
                  getOptionLabel={(option) =>
                    translateOption(option, medicalComfortOptionKeys, t)
                  }
                />

                <ChipGroup
                  label={t("onboarding.emergencyComfort")}
                  options={emergencyComfortOptions}
                  selectedValue={emergencyComfortLevel}
                  onSelect={setEmergencyComfortLevel}
                  getOptionLabel={(option) =>
                    translateOption(option, emergencyComfortOptionKeys, t)
                  }
                />

                <LargeField
                  label={t("onboarding.caregiving.mainConcern.label")}
                  value={mainConcern}
                  onChangeText={setMainConcern}
                  placeholder={t("onboarding.caregiving.mainConcern.placeholder")}
                />

                <LargeField
                  label={t("onboarding.caregiving.routines.label")}
                  value={hobbiesOrRoutines}
                  onChangeText={setHobbiesOrRoutines}
                  placeholder={t("onboarding.caregiving.routines.placeholder")}
                />

                <LargeField
                  label={t("onboarding.caregiving.support.label")}
                  value={stressOrSupportNeeds}
                  onChangeText={setStressOrSupportNeeds}
                  placeholder={t("onboarding.caregiving.support.placeholder")}
                />

                <Field
                  label={t("onboarding.caregiving.backup.label")}
                  value={backupCaregiver}
                  onChangeText={setBackupCaregiver}
                  placeholder={t("onboarding.caregiving.backup.placeholder")}
                />
              </StepShell>
            ) : null}

            {stepIndex === 3 ? (
              <StepShell
                title={t("onboarding.patient.title")}
                subtitle={t("onboarding.patient.subtitle")}
              >
                <SectionLabel title={t("onboarding.patient.preferredName.section")} />

                <Field
                  label={t("onboarding.patient.preferredName.label")}
                  value={patientPreferredName}
                  onChangeText={setPatientPreferredName}
                  placeholder={t("onboarding.patient.preferredName.placeholder")}
                />

                <Text style={styles.diagnosisHelper}>
                  {t("onboarding.patient.preferredName.helper")}
                </Text>

                <Pressable
                  style={[
                    styles.ehrPlaceholderButton,
                    importedEhrSummary && styles.ehrAppliedButton,
                    !canImportSelectedEhrProfile && styles.ehrDisabledButton,
                  ]}
                  onPress={handleImportSelectedEhrProfile}
                  disabled={!canImportSelectedEhrProfile}
                  accessibilityRole="button"
                  accessibilityLabel={t("onboarding.patient.ehr.import")}
                  accessibilityHint={t("onboarding.patient.ehr.importHint")}
                  accessibilityState={{ disabled: !canImportSelectedEhrProfile }}
                >
                  <View style={styles.ehrIconCircle}>
                    <AppIcon
                      name="plus"
                      size={18}
                      color={AppTheme.colors.brand}
                    />
                  </View>

                  <View style={styles.ehrTextBlock}>
                    <Text style={styles.ehrTitle}>
                      {ehrImporting
                        ? t("onboarding.patient.ehr.importing")
                        : importedEhrSummary
                        ? t("onboarding.patient.ehr.imported")
                        : t("onboarding.patient.ehr.import")}
                    </Text>
                    <Text style={styles.ehrSubtitle}>
                      {ehrImporting
                        ? t("onboarding.patient.ehr.importingDetails")
                        : ehrImportError
                        ? ehrImportError
                        : importedEhrSummary
                        ? importedEhrSummary.statusText
                        : selectedEhrProfile
                        ? t("onboarding.patient.ehr.infoAvailable")
                        : selectedDemoProfileId
                        ? t("onboarding.patient.ehr.noMatchingProfile")
                        : t("onboarding.patient.ehr.selectCaseFirst")}
                    </Text>
                    {selectedEhrProfile ? (
                      <Text style={styles.ehrSelectedPatient}>
                        {t("onboarding.patient.ehr.selectedPatient", {
                          patient: selectedEhrProfile.label,
                        })}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>

                <SectionLabel title={t("onboarding.patient.info.section")} />

                <View style={styles.twoColumnFields}>
                  <Field
                    label={t("onboarding.patient.fullName.label")}
                    value={patientFullName}
                    onChangeText={setPatientFullName}
                    placeholder={t("onboarding.patient.fullName.placeholder")}
                    autoCapitalize="words"
                    imported={Boolean(importedEhrFields.fullName)}
                    editable={!importedEhrFields.fullName}
                  />

                  <Field
                    label={t("onboarding.patient.age.label")}
                    value={patientAge}
                    onChangeText={setPatientAge}
                    placeholder={t("onboarding.patient.age.placeholder")}
                    keyboardType="number-pad"
                    imported={Boolean(importedEhrFields.age)}
                    editable={!importedEhrFields.age}
                  />
                </View>

                <SectionLabel title={t("onboarding.patient.address.section")} />

                <ChoiceCard
                  title={t("onboarding.patient.address.same.title")}
                  body={t("onboarding.patient.address.same.body")}
                  selected={patientAddressSameAsCaregiver}
                  onPress={() => setPatientAddressSameAsCaregiver(true)}
                />

                <ChoiceCard
                  title={t("onboarding.patient.address.different.title")}
                  body={t("onboarding.patient.address.different.body")}
                  selected={!patientAddressSameAsCaregiver}
                  onPress={() => setPatientAddressSameAsCaregiver(false)}
                />

                {!patientAddressSameAsCaregiver ? (
                  <AddressFields
                    address={patientAddress}
                    onChange={updatePatientAddress}
                  />
                ) : null}

                <LargeField
                  label={t("onboarding.patient.conditions.label")}
                  value={patientConditions}
                  onChangeText={setPatientConditions}
                  placeholder={t("onboarding.patient.conditions.placeholder")}
                  imported={Boolean(importedEhrFields.conditions)}
                  editable={!importedEhrFields.conditions}
                />

                <SectionLabel title={t("onboarding.patient.symptoms.section")} />

                <SelectPanel
                  title={t("onboarding.patient.symptoms.title")}
                  value={
                    selectedSymptomLabels.length > 0
                      ? t("onboarding.patient.symptoms.selectedCount", {
                          count: selectedSymptomLabels.length,
                        })
                      : t("onboarding.patient.symptoms.select")
                  }
                  expanded={expandedSelect === "symptoms"}
                  onToggle={() =>
                    setExpandedSelect((current) =>
                      current === "symptoms" ? null : "symptoms",
                    )
                  }
                >
                  <TextInput
                    style={styles.symptomSearchInput}
                    value={symptomSearch}
                    onChangeText={setSymptomSearch}
                    placeholder={t("onboarding.patient.symptoms.search")}
                    placeholderTextColor={theme.appTextMuted}
                  />

                  <View style={styles.symptomGrid}>
                    {visibleSymptoms.map((symptom) => {
                      const selected = selectedSymptoms.includes(symptom.id);

                      return (
                        <Pressable
                          key={symptom.id}
                          style={[
                            styles.symptomChip,
                            selected && styles.symptomChipSelected,
                          ]}
                          onPress={() => toggleSymptom(symptom.id)}
                        >
                          <Text
                            style={[
                              styles.symptomChipText,
                              selected && styles.symptomChipTextSelected,
                            ]}
                          >
                            {symptom.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {visibleSymptoms.length === 0 ? (
                    <Text style={styles.emptySelectText}>
                      {t("onboarding.patient.symptoms.none")}
                    </Text>
                  ) : null}
                </SelectPanel>

                <LargeField
                  label={t("onboarding.patient.otherSymptoms.label")}
                  value={otherSymptoms}
                  onChangeText={setOtherSymptoms}
                  placeholder={t("onboarding.patient.otherSymptoms.placeholder")}
                />

                <LargeField
                  label={t("onboarding.patient.medications.label")}
                  value={patientCurrentMedications}
                  onChangeText={setPatientCurrentMedications}
                  placeholder={t("onboarding.patient.medications.placeholder")}
                  imported={Boolean(importedEhrFields.medications)}
                  editable={!importedEhrFields.medications}
                />

                <LargeField
                  label={t("onboarding.patient.dailyRoutine.label")}
                  value={baselineDailyRoutine}
                  onChangeText={setBaselineDailyRoutine}
                  placeholder={t("onboarding.patient.dailyRoutine.placeholder")}
                />

                <View style={styles.clinicalGuidanceCard}>
                  <View style={styles.clinicalGuidanceHeader}>
                    <Text style={styles.clinicalGuidanceTitle}>
                      {t("onboarding.patient.clinicalGuidance.title")}
                    </Text>
                    <Text style={styles.clinicalGuidanceText}>
                      {t("onboarding.patient.clinicalGuidance.body")}
                    </Text>
                  </View>

                  <SectionLabel title={t("onboarding.patient.thresholds")} />

                  <Field
                    label={t("onboarding.patient.spo2.label")}
                    value={spo2Cutoff}
                    onChangeText={setSpo2Cutoff}
                    placeholder={t("onboarding.patient.spo2.placeholder")}
                    imported={Boolean(importedEhrFields.spo2Cutoff)}
                    editable={!importedEhrFields.spo2Cutoff}
                  />

                  <SectionLabel title={t("onboarding.patient.readings")} />

                  <Field
                    label={t("onboarding.patient.heartRate.label")}
                    value={baselineHeartRate}
                    onChangeText={setBaselineHeartRate}
                    placeholder={t("onboarding.patient.heartRate.placeholder")}
                    keyboardType="number-pad"
                    imported={Boolean(importedEhrFields.baselineHeartRate)}
                    editable={!importedEhrFields.baselineHeartRate}
                  />

                  <Field
                    label={t("onboarding.patient.bloodOxygen.label")}
                    value={baselineBloodOxygen}
                    onChangeText={setBaselineBloodOxygen}
                    placeholder={t("onboarding.patient.bloodOxygen.placeholder")}
                    keyboardType="decimal-pad"
                  />

                  <Field
                    label={t("onboarding.patient.breathingRate.label")}
                    value={baselineRespiratoryRate}
                    onChangeText={setBaselineRespiratoryRate}
                    placeholder={t("onboarding.patient.breathingRate.placeholder")}
                    keyboardType="number-pad"
                  />

                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>
                      {t("onboarding.patient.bloodPressure.label")}
                    </Text>
                    <View style={styles.bloodPressureFields}>
                      <View style={styles.bloodPressureField}>
                        <TextInput
                          style={styles.input}
                          value={baselineBloodPressureSystolic}
                          onChangeText={setBaselineBloodPressureSystolic}
                          placeholder={t("onboarding.patient.bloodPressure.topPlaceholder")}
                          placeholderTextColor={theme.appTextMuted}
                          keyboardType="number-pad"
                        />
                        <Text style={styles.fieldUnitText}>
                          {t("onboarding.patient.bloodPressure.unit")}
                        </Text>
                      </View>

                      <View style={styles.bloodPressureField}>
                        <TextInput
                          style={styles.input}
                          value={baselineBloodPressureDiastolic}
                          onChangeText={setBaselineBloodPressureDiastolic}
                          placeholder={t("onboarding.patient.bloodPressure.bottomPlaceholder")}
                          placeholderTextColor={theme.appTextMuted}
                          keyboardType="number-pad"
                        />
                        <Text style={styles.fieldUnitText}>
                          {t("onboarding.patient.bloodPressure.unit")}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <Field
                    label={t("onboarding.patient.glucose.label")}
                    value={baselineGlucoseLevel}
                    onChangeText={setBaselineGlucoseLevel}
                    placeholder={t("onboarding.patient.glucose.placeholder")}
                    keyboardType="decimal-pad"
                  />

                  <Field
                    label={t("onboarding.patient.temperature.label")}
                    value={baselineBodyTemperature}
                    onChangeText={setBaselineBodyTemperature}
                    placeholder={t("onboarding.patient.temperature.placeholder")}
                    keyboardType="decimal-pad"
                  />
                </View>

                <SectionLabel title={t("onboarding.classification.section")} />

                <ClassificationSelect
                  id="gmfcs"
                  title={t("onboarding.classification.gmfcs.title")}
                  value={gmfcsLevel}
                  displayValue={formatClassificationValue(
                    gmfcsLevel,
                    translatedGmfcsOptions,
                    t,
                  )}
                  options={translatedGmfcsOptions}
                  expanded={expandedSelect === "gmfcs"}
                  setExpandedSelect={setExpandedSelect}
                  onSelect={setGmfcsLevel}
                />

                <ClassificationSelect
                  id="fms"
                  title={t("onboarding.classification.fms.title")}
                  value={fmsScore}
                  displayValue={formatClassificationValue(
                    fmsScore,
                    translatedFmsOptions,
                    t,
                    t("onboarding.classification.scorePrefix"),
                  )}
                  options={translatedFmsOptions}
                  expanded={expandedSelect === "fms"}
                  setExpandedSelect={setExpandedSelect}
                  onSelect={setFmsScore}
                />

                <ClassificationSelect
                  id="macs"
                  title={t("onboarding.classification.macs.title")}
                  value={macsLevel}
                  displayValue={formatClassificationValue(
                    macsLevel,
                    translatedMacsOptions,
                    t,
                  )}
                  options={translatedMacsOptions}
                  expanded={expandedSelect === "macs"}
                  setExpandedSelect={setExpandedSelect}
                  onSelect={setMacsLevel}
                />

                <ClassificationSelect
                  id="cfcs"
                  title={t("onboarding.classification.cfcs.title")}
                  value={cfcsLevel}
                  displayValue={formatClassificationValue(
                    cfcsLevel,
                    translatedCfcsOptions,
                    t,
                  )}
                  options={translatedCfcsOptions}
                  expanded={expandedSelect === "cfcs"}
                  setExpandedSelect={setExpandedSelect}
                  onSelect={setCfcsLevel}
                />

                <ClassificationSelect
                  id="edacs"
                  title={t("onboarding.classification.edacs.title")}
                  value={edacsLevel}
                  displayValue={formatClassificationValue(
                    edacsLevel,
                    translatedEdacsOptions,
                    t,
                  )}
                  options={translatedEdacsOptions}
                  expanded={expandedSelect === "edacs"}
                  setExpandedSelect={setExpandedSelect}
                  onSelect={setEdacsLevel}
                />
              </StepShell>
            ) : null}

            {stepIndex === 4 ? (
              <StepShell
                title={t("onboarding.safety.title")}
                subtitle={t("onboarding.safety.subtitle")}
              >
                <SectionLabel title={t("onboarding.safety.provider.section")} />

                <Field
                  label={t("onboarding.safety.providerName.label")}
                  value={providerName}
                  onChangeText={setProviderName}
                  placeholder={t("onboarding.safety.providerName.placeholder")}
                />

                <Field
                  label={t("onboarding.safety.providerPhone.label")}
                  value={providerPhone}
                  onChangeText={setProviderPhone}
                  placeholder={t("onboarding.safety.providerPhone.placeholder")}
                  keyboardType="phone-pad"
                />

                <Field
                  label={t("onboarding.safety.providerEmail.label")}
                  value={providerEmail}
                  onChangeText={setProviderEmail}
                  placeholder={t("onboarding.safety.providerEmail.placeholder")}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <SectionLabel title={t("onboarding.safety.emergency.section")} />

                <Field
                  label={t("onboarding.safety.emergencyContact.label")}
                  value={emergencyContact}
                  onChangeText={setEmergencyContact}
                  placeholder={t("onboarding.safety.emergencyContact.placeholder")}
                />

                <LargeField
                  label={t("onboarding.safety.notes.label")}
                  value={safetyNotes}
                  onChangeText={setSafetyNotes}
                  placeholder={t("onboarding.safety.notes.placeholder")}
                />

                <Pressable
                  style={[
                    styles.disclaimerCard,
                    emergencyDisclaimerAccepted &&
                      styles.disclaimerCardAccepted,
                  ]}
                  onPress={() =>
                    setEmergencyDisclaimerAccepted((current) => !current)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={t("onboarding.safety.disclaimer.accessibilityLabel")}
                  accessibilityHint={t("onboarding.safety.disclaimer.accessibilityHint")}
                  accessibilityState={{ checked: emergencyDisclaimerAccepted }}
                >
                  <View
                    style={[
                      styles.checkCircle,
                      emergencyDisclaimerAccepted &&
                        styles.checkCircleSelected,
                    ]}
                  >
                    {emergencyDisclaimerAccepted ? (
                      <AppIcon
                        name="check"
                        size={14}
                        color={AppTheme.colors.white}
                      />
                    ) : null}
                  </View>

                  <View style={styles.disclaimerTextBlock}>
                    <Text style={styles.disclaimerTitle}>
                      {t("onboarding.safety.disclaimer.title")}
                    </Text>
                    <Text style={styles.disclaimerBody}>
                      {t("onboarding.safety.disclaimer.body")}
                    </Text>
                  </View>
                </Pressable>
              </StepShell>
            ) : null}

            {stepIndex === 6 ? (
              <>
                <DeviceSetupStep runnerOptions={deviceSetupRunnerOptions} />
                <View style={styles.optionalFeatureBlock}>
                  <Text style={styles.optionalFeatureTitle}>
                    {t("onboarding.optionalFeature.title")}
                  </Text>
                  <Text style={styles.optionalFeatureBody}>
                    {t("onboarding.optionalFeature.body")}
                  </Text>
                </View>
              </>
            ) : null}

            {stepIndex === 5 ? (
              <StepShell
                title={t("onboarding.device.title")}
                subtitle={t("onboarding.device.subtitle")}
              >
                <ChipGroup
                  label={t("onboarding.device.type")}
                  options={WEARABLE_DEVICE_OPTIONS}
                  selectedValue={deviceType}
                  onSelect={(value) => {
                    setDeviceType(value);
                    setDeviceConnected(false);
                    setBaselineStatus("not_started");
                  }}
                  getOptionLabel={(option) =>
                    translateOption(option, wearableDeviceOptionKeys, t)
                  }
                />

                <Field
                  label={t("onboarding.device.label")}
                  value={deviceLabel}
                  onChangeText={setDeviceLabel}
                  placeholder={t("onboarding.device.label.placeholder")}
                />

                <View style={styles.deviceCard}>
                  <View style={styles.deviceHeaderRow}>
                    <View style={styles.deviceIconCircle}>
                      <AppIcon
                        name="heart"
                        size={24}
                        color={AppTheme.colors.brand}
                      />
                    </View>

                    <View style={styles.deviceTextBlock}>
                      <Text style={styles.deviceTitle}>
                        {deviceConnected
                          ? t("onboarding.device.connected")
                          : t("onboarding.device.notConnected")}
                      </Text>
                      <Text style={styles.deviceSubtitle}>
                        {getBaselineStatusText(baselineStatus, t)}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    style={styles.connectButton}
                    onPress={connectAppleWatch}
                  >
                    <Text style={styles.connectButtonText}>
                      {t("onboarding.device.checkConnection")}
                    </Text>
                  </Pressable>

                  <Text style={styles.deviceHelper}>
                    {t("onboarding.device.helper")}
                  </Text>
                </View>

                <View style={styles.summaryCard}>
                  <Text style={styles.summaryTitle}>
                    {t("onboarding.device.summary.title")}
                  </Text>

                  <SummaryRow text={t("onboarding.device.summary.vitals")} />
                  <SummaryRow text={t("onboarding.device.summary.alerts")} />
                  <SummaryRow text={t("onboarding.device.summary.notifications")} />
                </View>
              </StepShell>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={[
                styles.primaryButton,
              ]}
              onPress={goNext}
              accessibilityRole="button"
              accessibilityLabel={primaryButtonLabel}
            >
              <Text style={styles.primaryButtonText}>
                {primaryButtonLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function WelcomeStep({
  selectedDemoProfileId,
  onSelectDemoProfile,
}: {
  selectedDemoProfileId: DemoOnboardingProfileId | null;
  onSelectDemoProfile: (profileId: DemoOnboardingProfileId) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createThemedStyles(theme), [theme]);
  const { t } = useTranslation();
  const demoOptions = getDemoOnboardingOptions();
  const [isDemoCasesExpanded, setIsDemoCasesExpanded] = useState(false);

  return (
    <View style={styles.welcome}>
      <Pressable
        style={styles.demoDisclosure}
        onPress={() => setIsDemoCasesExpanded((expanded) => !expanded)}
        accessibilityRole="button"
        accessibilityLabel={
          isDemoCasesExpanded
            ? t("onboarding.welcome.demo.hide")
            : t("onboarding.welcome.demo.show")
        }
        accessibilityState={{ expanded: isDemoCasesExpanded }}
      >
        <AppIcon
          name="chevronRight"
          size={24}
          color={theme.appTextMuted}
        />
      </Pressable>

      <View style={styles.heroLogoCard}>
        <Image
          source={require("@/assets/images/hta-logo.png")}
          style={styles.heroLogoImage}
          resizeMode="contain"
        />
      </View>

      <Text style={styles.welcomeEyebrow}>{t("onboarding.welcome.eyebrow")}</Text>
      <Text style={styles.welcomeTitle}>ACCESS-DP</Text>

      <Text style={styles.welcomeSubtitle}>
        {t("onboarding.welcome.subtitle")}
      </Text>

      <View style={styles.previewCard}>
        <Text style={styles.previewTitle}>{t("onboarding.welcome.previewTitle")}</Text>

        <SummaryRow text={t("onboarding.welcome.summary.status")} />
        <SummaryRow text={t("onboarding.welcome.summary.pathways")} />
        <SummaryRow text={t("onboarding.welcome.summary.context")} />
      </View>

      <Text style={styles.privacyText}>
        {t("onboarding.welcome.privacy")}
      </Text>

      {isDemoCasesExpanded ? (
        <View style={styles.demoProfileBlock}>
          {demoOptions.map((option) => {
            const selected = selectedDemoProfileId === option.id;

            return (
              <Pressable
                key={option.id}
                style={[
                  styles.demoProfileRow,
                  selected && styles.demoProfileRowSelected,
                ]}
                onPress={() => onSelectDemoProfile(option.id)}
              >
                <View style={styles.demoProfileTextBlock}>
                  <Text style={styles.demoProfileTitle}>{option.label}</Text>
                  <Text style={styles.demoProfileSubtitle}>
                    {option.caregiver.name} - {option.caregiver.relationship}
                  </Text>
                </View>
                {selected ? (
                  <AppIcon
                    name="check"
                    size={18}
                    color={AppTheme.colors.brand}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function ProgressTracker({
  activeIndex,
  labels,
}: {
  activeIndex: number;
  labels: string[];
}) {
  const theme = useTheme();
  const styles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <View style={styles.progressBlock}>
      <View style={styles.progressLine}>
        {labels.map((label, index) => {
          const active = index <= activeIndex;

          return (
            <View key={label} style={styles.progressItem}>
              <View
                style={[
                  styles.progressDot,
                  active && styles.progressDotActive,
                ]}
              >
                <Text
                  style={[
                    styles.progressNumber,
                    active && styles.progressNumberActive,
                  ]}
                >
                  {index + 1}
                </Text>
              </View>

              <Text
                style={[
                  styles.progressLabel,
                  active && styles.progressLabelActive,
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function StepShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <View style={styles.stepShell}>
      <View style={styles.stepIntro}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepSubtitle}>{subtitle}</Text>
      </View>

      {children}
    </View>
  );
}

function SectionLabel({ title }: { title: string }) {
  const theme = useTheme();
  const styles = useMemo(() => createThemedStyles(theme), [theme]);

  return <Text style={styles.sectionLabel}>{title}</Text>;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  helper,
  editable = true,
  imported = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?:
    | "default"
    | "phone-pad"
    | "number-pad"
    | "decimal-pad"
    | "email-address";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  helper?: string;
  editable?: boolean;
  imported?: boolean;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createThemedStyles(theme), [theme]);
  const { t } = useTranslation();
  const helperText = imported ? t("onboarding.field.imported") : helper;

  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, imported && styles.inputImported]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.appTextMuted}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        editable={editable}
        accessibilityLabel={
          imported
            ? t("onboarding.field.importedA11y", { label })
            : label
        }
        accessibilityHint={
          imported
            ? t("onboarding.field.importedHint")
            : undefined
        }
        accessibilityState={{ disabled: !editable }}
      />
      {helperText ? <Text style={styles.fieldHelper}>{helperText}</Text> : null}
    </View>
  );
}

function LargeField({
  label,
  value,
  onChangeText,
  placeholder,
  editable = true,
  imported = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  editable?: boolean;
  imported?: boolean;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createThemedStyles(theme), [theme]);
  const { t } = useTranslation();
  const helperText = imported ? t("onboarding.field.imported") : undefined;

  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          styles.largeInput,
          imported && styles.inputImported,
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.appTextMuted}
        multiline
        textAlignVertical="top"
        editable={editable}
        accessibilityLabel={
          imported
            ? t("onboarding.field.importedA11y", { label })
            : label
        }
        accessibilityHint={
          imported
            ? t("onboarding.field.importedHint")
            : undefined
        }
        accessibilityState={{ disabled: !editable }}
      />
      {helperText ? <Text style={styles.fieldHelper}>{helperText}</Text> : null}
    </View>
  );
}

function AddressFields({
  address,
  onChange,
}: {
  address: AddressProfile;
  onChange: (field: keyof AddressProfile, value: string) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createThemedStyles(theme), [theme]);
  const { t } = useTranslation();

  return (
    <View>
      <Field
        label={t("onboarding.address.street")}
        value={address.line1}
        onChangeText={(value) => onChange("line1", value)}
        placeholder={t("onboarding.address.street")}
      />

      <Field
        label={t("onboarding.address.line2")}
        value={address.line2 ?? ""}
        onChangeText={(value) => onChange("line2", value)}
        placeholder={t("onboarding.address.optional")}
      />

      <View style={styles.twoColumnFields}>
        <Field
          label={t("onboarding.address.city")}
          value={address.city}
          onChangeText={(value) => onChange("city", value)}
          placeholder={t("onboarding.address.city")}
        />

        <Field
          label={t("onboarding.address.state")}
          value={address.state}
          onChangeText={(value) => onChange("state", value)}
          placeholder={t("onboarding.address.state")}
        />
      </View>

      <View style={styles.twoColumnFields}>
        <Field
          label={t("onboarding.address.zip")}
          value={address.postalCode}
          onChangeText={(value) => onChange("postalCode", value)}
          placeholder={t("onboarding.address.zip")}
        />

        <Field
          label={t("onboarding.address.country")}
          value={address.country}
          onChangeText={(value) => onChange("country", value)}
          placeholder={t("onboarding.address.unitedStates")}
        />
      </View>
    </View>
  );
}

function ChipGroup<T extends string>({
  label,
  options,
  selectedValue,
  onSelect,
  getOptionLabel,
}: {
  label: string;
  options: readonly T[];
  selectedValue: T;
  onSelect: (value: T) => void;
  getOptionLabel?: (value: T) => string;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <View style={styles.chipBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>

      <View style={styles.chipRow}>
        {options.map((option) => {
          const selected = option === selectedValue;
          const displayLabel = getOptionLabel?.(option) ?? option;

          return (
            <Pressable
              key={option}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => onSelect(option)}
              accessibilityRole="button"
              accessibilityLabel={displayLabel}
              accessibilityState={{ selected }}
            >
              <Text
                style={[
                  styles.chipText,
                  selected && styles.chipTextSelected,
                ]}
              >
                {displayLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ChoiceCard({
  title,
  body,
  selected,
  onPress,
}: {
  title: string;
  body: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <Pressable
      style={[styles.choiceCard, selected && styles.choiceCardSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      accessibilityState={{ selected }}
    >
      <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>

      <View style={styles.choiceTextBlock}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceBody}>{body}</Text>
      </View>
    </Pressable>
  );
}

function ClassificationSelect({
  id,
  title,
  value,
  displayValue,
  options,
  expanded,
  setExpandedSelect,
  onSelect,
}: {
  id: Exclude<ExpandedSelect, "symptoms" | null>;
  title: string;
  value: string;
  displayValue: string;
  options: MobilityOption[];
  expanded: boolean;
  setExpandedSelect: Dispatch<SetStateAction<ExpandedSelect>>;
  onSelect: (value: string) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <SelectPanel
      title={title}
      value={displayValue}
      expanded={expanded}
      onToggle={() =>
        setExpandedSelect((current) => (current === id ? null : id))
      }
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <Pressable
            key={option.value}
            style={[
              styles.mobilityOptionRow,
              selected && styles.mobilityOptionRowSelected,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${title}: ${option.label}, ${option.description}`}
            accessibilityState={{ selected }}
            onPress={() => {
              onSelect(option.value);
              setExpandedSelect(null);
            }}
          >
            <View
              style={[
                styles.mobilityIconCircle,
                selected && styles.mobilityIconCircleSelected,
              ]}
            >
              <AppIcon
                name={option.icon}
                size={20}
                color={
                  selected ? AppTheme.colors.white : AppTheme.colors.brand
                }
              />
            </View>

            <View style={styles.mobilityOptionTextBlock}>
              <Text style={styles.mobilityOptionLabel}>{option.label}</Text>
              <Text style={styles.mobilityOptionDescription}>
                {option.description}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </SelectPanel>
  );
}

function SelectPanel({
  title,
  value,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  value: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <View style={styles.selectPanel}>
      <Pressable
        style={styles.selectHeader}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${value}`}
        accessibilityState={{ expanded }}
      >
        <View style={styles.selectTextBlock}>
          <Text style={styles.selectTitle}>{title}</Text>
          <Text style={styles.selectValue}>{value}</Text>
        </View>

        <Text style={styles.selectChevron}>{expanded ? "⌃" : "⌄"}</Text>
      </Pressable>

      {expanded ? <View style={styles.selectContent}>{children}</View> : null}
    </View>
  );
}

function SummaryRow({ text }: { text: string }) {
  const theme = useTheme();
  const styles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryDot} />
      <Text style={styles.summaryText}>{text}</Text>
    </View>
  );
}

function getBaselineStatusText(
  status: WearableBaselineStatus,
  t: TranslateFn,
): string {
  if (status === "simulated") {
    return t("onboarding.device.status.simulated");
  }

  if (status === "connected") {
    return t("onboarding.device.status.connected");
  }

  if (status === "failed") {
    return t("onboarding.device.status.failed");
  }

  return t("onboarding.device.status.notStarted");
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === "#000000";
  const colors = {
    screen: theme.appBackground,
    surface: theme.appSurface,
    softSurface: theme.appControlSurface,
    text: theme.appText,
    textSoft: theme.appTextSupporting,
    textMuted: theme.appTextMuted,
    sectionText: theme.appSectionText,
    border: theme.appBorder,
    brandSoft: theme.appBrandSoftSurface,
    importedAccent: isDark ? theme.appProfileAvatarBorder : "#B7FFF1",
    iconSurface: isDark ? theme.appControlSurface : AppTheme.colors.white,
    clinicalSurface: isDark ? "#0A2B2E" : "#F4FBFC",
    clinicalBorder: isDark ? "#1D5C64" : "#B7DDE8",
    clinicalMetricBorder: isDark ? "#284A4D" : "#D9E7E5",
    selectedAccentText: isDark ? "#6EE7D8" : AppTheme.colors.brandDark,
  };

  return StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.screen,
  },
  keyboardRoot: {
    flex: 1,
  },
  root: {
    flex: 1,
    backgroundColor: colors.screen,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 116,
  },
  introContent: {
    paddingTop: 36,
  },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  backButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "700",
    lineHeight: 34,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  kicker: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  stepCount: {
    color: colors.textSoft,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  topSpacer: {
    width: 46,
  },

  progressBlock: {
    marginBottom: 26,
  },
  progressLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 6,
  },
  progressItem: {
    flex: 1,
    alignItems: "center",
  },
  progressDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.softSurface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  progressDotActive: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  progressNumber: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  progressNumberActive: {
    color: AppTheme.colors.white,
  },
  progressLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
  },
  progressLabelActive: {
    color: AppTheme.colors.brand,
  },

  welcome: {
    alignItems: "center",
    paddingTop: 12,
  },
  heroLogoCard: {
    width: 116,
    height: 116,
    borderRadius: 34,
    backgroundColor: AppTheme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
    ...AppTheme.shadow,
  },
  heroLogoImage: {
    width: 86,
    height: 86,
  },
  welcomeEyebrow: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  welcomeTitle: {
    color: colors.text,
    fontSize: 38,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  welcomeSubtitle: {
    color: colors.textSoft,
    fontSize: 17,
    lineHeight: 27,
    textAlign: "center",
    marginBottom: 24,
  },
  previewCard: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    ...AppTheme.shadow,
  },
  previewTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 14,
  },
  privacyText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 20,
    textAlign: "center",
  },
  demoProfileBlock: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginTop: 14,
    gap: 8,
  },
  demoDisclosure: {
    position: "absolute",
    top: 0,
    right: 0,
    zIndex: 1,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.55,
  },
  demoProfileRow: {
    minHeight: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.softSurface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  demoProfileRowSelected: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: colors.brandSoft,
  },
  demoProfileTextBlock: {
    flex: 1,
  },
  demoProfileTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  demoProfileSubtitle: {
    color: colors.textSoft,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },

  stepShell: {
    gap: 16,
  },
  stepIntro: {
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.importedAccent,
    borderRadius: AppTheme.radius.card,
    padding: 20,
    marginBottom: 4,
  },
  stepTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "900",
    marginBottom: 8,
  },
  stepSubtitle: {
    color: colors.textSoft,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "600",
  },
  sectionLabel: {
    color: colors.sectionText,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 8,
  },

  fieldBlock: {
    flex: 1,
    minWidth: 160,
    marginBottom: 2,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
  },
  fieldHelper: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 6,
    lineHeight: 17,
  },
  input: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  inputImported: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: colors.brandSoft,
  },
  largeInput: {
    minHeight: 104,
    lineHeight: 22,
  },
  twoColumnFields: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  bloodPressureFields: {
    flexDirection: "row",
    gap: 12,
  },
  bloodPressureField: {
    flex: 1,
    minWidth: 120,
  },
  fieldUnitText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 6,
  },

  diagnosisHelper: {
    color: colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    marginTop: -6,
  },
  ehrPlaceholderButton: {
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: AppTheme.colors.brand,
    backgroundColor: colors.brandSoft,
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
  },
  ehrIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.iconSurface,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  ehrTextBlock: {
    flex: 1,
  },
  ehrTitle: {
    color: AppTheme.colors.brand,
    fontSize: 15,
    fontWeight: "900",
  },
  ehrSubtitle: {
    color: colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    marginTop: 2,
  },
  ehrSelectedPatient: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
    marginTop: 6,
  },
  ehrAppliedButton: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: colors.brandSoft,
    opacity: 0.7,
  },
  ehrDisabledButton: {
    opacity: 0.55,
  },
  clinicalGuidanceCard: {
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: colors.clinicalBorder,
    backgroundColor: colors.clinicalSurface,
    padding: 16,
    gap: 14,
  },
  clinicalGuidanceHeader: {
    gap: 6,
  },
  clinicalGuidanceTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  clinicalGuidanceText: {
    color: colors.textSoft,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
  },
  guidanceMetricRow: {
    flexDirection: "row",
    gap: 10,
  },
  guidanceMetric: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.clinicalMetricBorder,
    backgroundColor: colors.iconSurface,
    padding: 12,
  },
  guidanceMetricLabel: {
    color: colors.sectionText,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  guidanceMetricValue: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  mobilityOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 10,
  },
  mobilityOptionRowSelected: {
    backgroundColor: colors.brandSoft,
  },
  mobilityIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.iconSurface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  mobilityIconCircleSelected: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  mobilityOptionTextBlock: {
    flex: 1,
  },
  mobilityOptionLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  mobilityOptionDescription: {
    color: colors.textSoft,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  suggestedDiagnosisBlock: {
    gap: 10,
  },
  suggestedDiagnosisTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  suggestedDiagnosisRow: {
    gap: 10,
  },
  suggestedDiagnosisChip: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
  },
  suggestedDiagnosisChipSelected: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: colors.brandSoft,
  },
  suggestedDiagnosisCode: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 4,
  },
  suggestedDiagnosisCodeSelected: {
    color: colors.selectedAccentText,
  },
  suggestedDiagnosisLabel: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "800",
  },
  suggestedDiagnosisLabelSelected: {
    color: colors.text,
  },

  chipBlock: {
    gap: 8,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    borderRadius: AppTheme.radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  chipSelected: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  chipText: {
    color: colors.textSoft,
    fontSize: 13,
    fontWeight: "900",
  },
  chipTextSelected: {
    color: AppTheme.colors.white,
  },

  choiceCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  choiceCardSelected: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: colors.brandSoft,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    marginTop: 1,
  },
  radioOuterSelected: {
    borderColor: AppTheme.colors.brand,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: AppTheme.colors.brand,
  },
  choiceTextBlock: {
    flex: 1,
  },
  choiceTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 4,
  },
  choiceBody: {
    color: colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },

  selectPanel: {
    borderRadius: AppTheme.radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  selectHeader: {
    minHeight: 66,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  selectTextBlock: {
    flex: 1,
  },
  selectTitle: {
    color: colors.sectionText,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  selectValue: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  selectChevron: {
    color: AppTheme.colors.brand,
    fontSize: 24,
    fontWeight: "900",
    marginLeft: 12,
  },
  selectContent: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 10,
    gap: 8,
  },

  optionRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.softSurface,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  optionRowSelected: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: colors.brandSoft,
  },
  optionCode: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 3,
  },
  optionTextBlock: {
    flex: 1,
  },
  optionLabel: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  optionCategory: {
    color: colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 3,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkCircleSelected: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },

  symptomSearchInput: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 10,
  },
  symptomGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  symptomChip: {
    borderRadius: AppTheme.radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.softSurface,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  symptomChipSelected: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  symptomChipText: {
    color: colors.textSoft,
    fontSize: 13,
    fontWeight: "800",
  },
  symptomChipTextSelected: {
    color: AppTheme.colors.white,
  },
  emptySelectText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    paddingVertical: 10,
    textAlign: "center",
  },

  disclaimerCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  disclaimerCardAccepted: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: colors.brandSoft,
  },
  disclaimerTextBlock: {
    flex: 1,
    marginLeft: 12,
  },
  disclaimerTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 5,
  },
  disclaimerBody: {
    color: colors.textSoft,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },
  optionalFeatureBlock: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 16,
    marginBottom: 8,
    gap: 6,
  },
  optionalFeatureTitle: {
    color: AppTheme.colors.brandDark,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  optionalFeatureBody: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },

  deviceCard: {
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 20,
    ...AppTheme.shadow,
  },
  deviceHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  deviceIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  deviceTextBlock: {
    flex: 1,
  },
  deviceTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 4,
  },
  deviceSubtitle: {
    color: colors.textSoft,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  connectButton: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: AppTheme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  connectButtonText: {
    color: AppTheme.colors.white,
    fontSize: 16,
    fontWeight: "900",
  },
  deviceHelper: {
    color: colors.textSoft,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
    marginTop: 14,
  },
  summaryCard: {
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 18,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  summaryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: AppTheme.colors.brand,
    marginTop: 7,
    marginRight: 10,
  },
  summaryText: {
    flex: 1,
    color: colors.textSoft,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
  },

  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 18,
    backgroundColor: colors.screen,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  primaryButton: {
    minHeight: 58,
    borderRadius: 20,
    backgroundColor: AppTheme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: AppTheme.colors.white,
    fontSize: 17,
    fontWeight: "900",
  },
  });
}
