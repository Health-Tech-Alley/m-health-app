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
  type LanguagePreference,
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

const formProgressSteps = [
  "Caregiver",
  "Caregiving",
  "Patient",
  "Safety",
  "Device",
  "Setup",
];

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

const languageOptions: LanguagePreference[] = [
  "English",
  "Español",
  "English + Español",
  "Other",
];

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
  prefix?: string,
): string {
  if (!value) return "Not selected";
  const option = options.find((item) => item.value === value);
  if (!option) return value;
  if (option.value === "Not assessed") return option.label;
  return prefix ? `${prefix} ${option.value}` : option.detail ?? option.label;
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
} | undefined): string {
  if (bundleStatus?.state === "in_flight") {
    return "Import complete. Clinical evidence is still updating.";
  }
  if (bundleStatus?.state === "failed") {
    return "Import complete. Clinical evidence will retry later.";
  }

  return "Imported patient details are ready for review.";
}

export default function OnboardingScreen() {
  const router = useRouter();
  const existingProfile = getOnboardingProfile();
  const { snapshot, ready } = usePatientRecord();
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
    useState<LanguagePreference>(
      existingProfile.caregiver.languagePreference ?? "English + Español",
    );
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
    if (caregiver.languagePreference) {
      setLanguagePreference(caregiver.languagePreference);
    }
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

  const selectedSymptomLabels = useMemo(
    () =>
      selectedSymptoms
        .map((symptomId) =>
          COMMON_SYMPTOM_OPTIONS.find((option) => option.id === symptomId),
        )
        .filter((option): option is SymptomProfile => Boolean(option))
        .map((option) => option.label),
    [selectedSymptoms],
  );

  const visibleSymptoms = useMemo(() => {
    const query = symptomSearch.trim().toLowerCase();

    return COMMON_SYMPTOM_OPTIONS.filter((symptom) => {
      if (!query) return true;
      return symptom.label.toLowerCase().includes(query);
    }).sort((a, b) => a.label.localeCompare(b.label));
  }, [symptomSearch]);

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
      statusText: getImportedEhrStatusText(snapshot.bundleStatus),
    };
  }, [ehrImportSucceeded, snapshot]);

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
    const t = setTimeout(() => {
      handleSelectDemoProfile(pending as DemoOnboardingProfileId);
    }, 0);
    return () => clearTimeout(t);
    // Mount-only: apply queued demo once when the wizard opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isIntroScreen = stepIndex === 0;
  const canGoBack = stepIndex > 0;
  const isWearableStep = stepIndex === 5;
  const isDeviceSetupStep = stepIndex === 6;
  const isFinalStep = isDeviceSetupStep;
  const formStepNumber = Math.max(stepIndex, 1);

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
        setEhrImportError("The selected EHR profile could not be imported.");
        return;
      }

      setEhrImportRequest({
        patientId: result.patientId,
        profileId: selectedEhrProfile.id,
      });
    } catch (error) {
      console.error("Failed to import onboarding EHR profile", error);
      setEhrImportRequest(null);
      setEhrImportError("EHR import failed. Try again.");
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

    if (ehrImportRequest) {
      const importedPatientId = ehrImportRequest.patientId;
      if (!ready || snapshot?.patient?.patientId !== importedPatientId) {
        setEhrImportError(
          "The imported EHR patient is no longer active. Import EHR again before continuing.",
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
        router.replace("/dashboard");
      } catch (error) {
        console.error("Failed to complete onboarding for imported patient", error);
        setEhrImportError(
          "Onboarding could not finish with the imported EHR patient. Try importing again.",
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
                  >
                    <Text style={styles.backIcon}>‹</Text>
                  </Pressable>

                  <View style={styles.headerCenter}>
                    <Text style={styles.kicker}>Caregiver Concierge</Text>
                    <Text style={styles.stepCount}>
                      Step {formStepNumber} of {formStepCount}
                    </Text>
                  </View>

                  <View style={styles.topSpacer} />
                </View>

                <ProgressTracker activeIndex={formStepNumber - 1} />
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
                title="About You"
                subtitle="Tell us who is providing care and where to reach you."
              >
                <Field
                  label="Caregiver name"
                  value={caregiverName}
                  onChangeText={setCaregiverName}
                  placeholder="Caregiver name"
                />

                <Field
                  label="Relationship to patient"
                  value={relationship}
                  onChangeText={setRelationship}
                  placeholder="Son, spouse, daughter, aide..."
                />

                <Field
                  label="Phone"
                  value={caregiverPhone}
                  onChangeText={setCaregiverPhone}
                  placeholder="Phone number"
                  keyboardType="phone-pad"
                />

                <SectionLabel title="Caregiver address" />

                <AddressFields
                  address={caregiverAddress}
                  onChange={updateCaregiverAddress}
                />
              </StepShell>
            ) : null}

            {stepIndex === 2 ? (
              <StepShell
                title="Caregiving"
                subtitle="These choices help tune alerts, explanations, and support around how you provide care."
              >
                <ChipGroup
                  label="Experience"
                  options={experienceOptions}
                  selectedValue={experience}
                  onSelect={setExperience}
                />

                <ChipGroup
                  label="Availability"
                  options={availabilityOptions}
                  selectedValue={availability}
                  onSelect={setAvailability}
                />

                <ChipGroup
                  label="Notifications"
                  options={notificationOptions}
                  selectedValue={notificationStyle}
                  onSelect={setNotificationStyle}
                />

                <ChipGroup
                  label="Language"
                  options={languageOptions}
                  selectedValue={languagePreference}
                  onSelect={setLanguagePreference}
                />

                <ChipGroup
                  label="Medical detail comfort"
                  options={medicalComfortOptions}
                  selectedValue={medicalComfortLevel}
                  onSelect={setMedicalComfortLevel}
                />

                <ChipGroup
                  label="Emergency comfort"
                  options={emergencyComfortOptions}
                  selectedValue={emergencyComfortLevel}
                  onSelect={setEmergencyComfortLevel}
                />

                <LargeField
                  label="Main concern"
                  value={mainConcern}
                  onChangeText={setMainConcern}
                  placeholder="Example: breathing episodes, falls, confusion..."
                />

                <LargeField
                  label="Helpful routines or hobbies"
                  value={hobbiesOrRoutines}
                  onChangeText={setHobbiesOrRoutines}
                  placeholder="Example: evening walks, cooking, music..."
                />

                <LargeField
                  label="Stress or support needs"
                  value={stressOrSupportNeeds}
                  onChangeText={setStressOrSupportNeeds}
                  placeholder="Example: family check-ins help, prefers simple alerts..."
                />

                <Field
                  label="Backup caregiver"
                  value={backupCaregiver}
                  onChangeText={setBackupCaregiver}
                  placeholder="Name and phone number"
                />
              </StepShell>
            ) : null}

            {stepIndex === 3 ? (
              <StepShell
                title="Patient"
                subtitle="Start with the name your family uses, then add official record details when you are ready."
              >
                <SectionLabel title="Preferred name" />

                <Field
                  label="What name should we use for your loved one?"
                  value={patientPreferredName}
                  onChangeText={setPatientPreferredName}
                  placeholder="Preferred name"
                />

                <Text style={styles.diagnosisHelper}>
                  This can be a nickname, preferred name, or the name your family
                  normally uses.
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
                  accessibilityLabel="Import from EHR"
                  accessibilityHint="Imports EHR details for the selected onboarding patient"
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
                        ? "Importing..."
                        : importedEhrSummary
                        ? "Imported from EHR"
                        : "Import from EHR"}
                    </Text>
                    <Text style={styles.ehrSubtitle}>
                      {ehrImporting
                        ? "Importing EHR details for the selected patient."
                        : ehrImportError
                        ? ehrImportError
                        : importedEhrSummary
                        ? importedEhrSummary.statusText
                        : selectedEhrProfile
                        ? "Some information on this page can be obtained from the patient's EHR."
                        : selectedDemoProfileId
                        ? "The selected onboarding case does not have a matching EHR profile."
                        : "Select a patient case on the landing page before importing EHR details."}
                    </Text>
                    {selectedEhrProfile ? (
                      <Text style={styles.ehrSelectedPatient}>
                        Selected patient: {selectedEhrProfile.label}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>

                <SectionLabel title="Patient information" />

                <View style={styles.twoColumnFields}>
                  <Field
                    label="Full name"
                    value={patientFullName}
                    onChangeText={setPatientFullName}
                    placeholder="Full name"
                    autoCapitalize="words"
                    imported={Boolean(importedEhrFields.fullName)}
                    editable={!importedEhrFields.fullName}
                  />

                  <Field
                    label="Age"
                    value={patientAge}
                    onChangeText={setPatientAge}
                    placeholder="Age"
                    keyboardType="number-pad"
                    imported={Boolean(importedEhrFields.age)}
                    editable={!importedEhrFields.age}
                  />
                </View>

                <SectionLabel title="Address" />

                <ChoiceCard
                  title="Same as caregiver address"
                  body="Use the caregiver address for the patient profile."
                  selected={patientAddressSameAsCaregiver}
                  onPress={() => setPatientAddressSameAsCaregiver(true)}
                />

                <ChoiceCard
                  title="Different patient address"
                  body="Enter a separate address for the patient."
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
                  label="Conditions"
                  value={patientConditions}
                  onChangeText={setPatientConditions}
                  placeholder="Add known conditions..."
                  imported={Boolean(importedEhrFields.conditions)}
                  editable={!importedEhrFields.conditions}
                />

                <SectionLabel title="Common symptoms" />

                <SelectPanel
                  title="Symptoms"
                  value={
                    selectedSymptomLabels.length > 0
                      ? `${selectedSymptomLabels.length} selected`
                      : "Select common symptoms"
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
                    placeholder="Search symptoms..."
                    placeholderTextColor={AppTheme.colors.textMuted}
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
                      No matching symptoms
                    </Text>
                  ) : null}
                </SelectPanel>

                <LargeField
                  label="Other symptoms"
                  value={otherSymptoms}
                  onChangeText={setOtherSymptoms}
                  placeholder="Add symptoms not listed above..."
                />

                <LargeField
                  label="Current medications"
                  value={patientCurrentMedications}
                  onChangeText={setPatientCurrentMedications}
                  placeholder="Add current medications..."
                  imported={Boolean(importedEhrFields.medications)}
                  editable={!importedEhrFields.medications}
                />

                <LargeField
                  label="Daily routine"
                  value={baselineDailyRoutine}
                  onChangeText={setBaselineDailyRoutine}
                  placeholder="Describe the usual daily routine..."
                />

                <View style={styles.clinicalGuidanceCard}>
                  <View style={styles.clinicalGuidanceHeader}>
                    <Text style={styles.clinicalGuidanceTitle}>
                      Clinical guidance
                    </Text>
                    <Text style={styles.clinicalGuidanceText}>
                      These values should come from the patient&apos;s care plan or
                      be confirmed with the primary care provider.
                    </Text>
                  </View>

                  <SectionLabel title="CARE-PLAN THRESHOLDS" />

                  <Field
                    label="SpO2 cutoff"
                    value={spo2Cutoff}
                    onChangeText={setSpo2Cutoff}
                    placeholder="Care-plan cutoff"
                    imported={Boolean(importedEhrFields.spo2Cutoff)}
                    editable={!importedEhrFields.spo2Cutoff}
                  />

                  <SectionLabel title="USUAL HEALTH READINGS" />

                  <Field
                    label="Baseline HR"
                    value={baselineHeartRate}
                    onChangeText={setBaselineHeartRate}
                    placeholder="bpm"
                    keyboardType="number-pad"
                    imported={Boolean(importedEhrFields.baselineHeartRate)}
                    editable={!importedEhrFields.baselineHeartRate}
                  />

                  <Field
                    label="Baseline blood oxygen (SpO2)"
                    value={baselineBloodOxygen}
                    onChangeText={setBaselineBloodOxygen}
                    placeholder="%"
                    keyboardType="decimal-pad"
                  />

                  <Field
                    label="Baseline breathing rate"
                    value={baselineRespiratoryRate}
                    onChangeText={setBaselineRespiratoryRate}
                    placeholder="breaths/min"
                    keyboardType="number-pad"
                  />

                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>Baseline blood pressure</Text>
                    <View style={styles.bloodPressureFields}>
                      <View style={styles.bloodPressureField}>
                        <TextInput
                          style={styles.input}
                          value={baselineBloodPressureSystolic}
                          onChangeText={setBaselineBloodPressureSystolic}
                          placeholder="Top number"
                          placeholderTextColor={AppTheme.colors.textMuted}
                          keyboardType="number-pad"
                        />
                        <Text style={styles.fieldUnitText}>mmHg</Text>
                      </View>

                      <View style={styles.bloodPressureField}>
                        <TextInput
                          style={styles.input}
                          value={baselineBloodPressureDiastolic}
                          onChangeText={setBaselineBloodPressureDiastolic}
                          placeholder="Bottom number"
                          placeholderTextColor={AppTheme.colors.textMuted}
                          keyboardType="number-pad"
                        />
                        <Text style={styles.fieldUnitText}>mmHg</Text>
                      </View>
                    </View>
                  </View>

                  <Field
                    label="Baseline blood glucose"
                    value={baselineGlucoseLevel}
                    onChangeText={setBaselineGlucoseLevel}
                    placeholder="mg/dL"
                    keyboardType="decimal-pad"
                  />

                  <Field
                    label="Baseline body temperature"
                    value={baselineBodyTemperature}
                    onChangeText={setBaselineBodyTemperature}
                    placeholder="deg F"
                    keyboardType="decimal-pad"
                  />
                </View>

                <SectionLabel title="Functional and communication classifications" />

                <ClassificationSelect
                  id="gmfcs"
                  title="Gross Motor Function Classification System (GMFCS)"
                  value={gmfcsLevel}
                  displayValue={formatClassificationValue(
                    gmfcsLevel,
                    gmfcsOptions,
                  )}
                  options={gmfcsOptions}
                  expanded={expandedSelect === "gmfcs"}
                  setExpandedSelect={setExpandedSelect}
                  onSelect={setGmfcsLevel}
                />

                <ClassificationSelect
                  id="fms"
                  title="Functional Mobility Scale (FMS)"
                  value={fmsScore}
                  displayValue={formatClassificationValue(
                    fmsScore,
                    fmsOptions,
                    "Score",
                  )}
                  options={fmsOptions}
                  expanded={expandedSelect === "fms"}
                  setExpandedSelect={setExpandedSelect}
                  onSelect={setFmsScore}
                />

                <ClassificationSelect
                  id="macs"
                  title="Manual Ability Classification System (MACS)"
                  value={macsLevel}
                  displayValue={formatClassificationValue(macsLevel, macsOptions)}
                  options={macsOptions}
                  expanded={expandedSelect === "macs"}
                  setExpandedSelect={setExpandedSelect}
                  onSelect={setMacsLevel}
                />

                <ClassificationSelect
                  id="cfcs"
                  title="Communication Function Classification System (CFCS)"
                  value={cfcsLevel}
                  displayValue={formatClassificationValue(cfcsLevel, cfcsOptions)}
                  options={cfcsOptions}
                  expanded={expandedSelect === "cfcs"}
                  setExpandedSelect={setExpandedSelect}
                  onSelect={setCfcsLevel}
                />

                <ClassificationSelect
                  id="edacs"
                  title="Eating and Drinking Ability Classification System (EDACS)"
                  value={edacsLevel}
                  displayValue={formatClassificationValue(
                    edacsLevel,
                    edacsOptions,
                  )}
                  options={edacsOptions}
                  expanded={expandedSelect === "edacs"}
                  setExpandedSelect={setExpandedSelect}
                  onSelect={setEdacsLevel}
                />
              </StepShell>
            ) : null}

            {stepIndex === 4 ? (
              <StepShell
                title="Safety"
                subtitle="Add provider and emergency information that should be easy to find during stressful moments."
              >
                <SectionLabel title="Primary care provider" />

                <Field
                  label="Provider name"
                  value={providerName}
                  onChangeText={setProviderName}
                  placeholder="Provider name"
                />

                <Field
                  label="Provider phone"
                  value={providerPhone}
                  onChangeText={setProviderPhone}
                  placeholder="Phone number"
                  keyboardType="phone-pad"
                />

                <Field
                  label="Provider email"
                  value={providerEmail}
                  onChangeText={setProviderEmail}
                  placeholder="Email address"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <SectionLabel title="Emergency and safety" />

                <Field
                  label="Emergency contact"
                  value={emergencyContact}
                  onChangeText={setEmergencyContact}
                  placeholder="Name and phone number"
                />

                <LargeField
                  label="Safety notes"
                  value={safetyNotes}
                  onChangeText={setSafetyNotes}
                  placeholder="Example: allergies, falls risk, mobility limitations..."
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
                      Emergency disclaimer
                    </Text>
                    <Text style={styles.disclaimerBody}>
                      I understand this app supports caregiver decisions but does
                      not replace emergency care or automatically call 911.
                    </Text>
                  </View>
                </Pressable>
              </StepShell>
            ) : null}

            {stepIndex === 6 ? (
              <>
                <DeviceSetupStep runnerOptions={deviceSetupRunnerOptions} />
                <View style={styles.optionalFeatureBlock}>
                  <Text style={styles.optionalFeatureTitle}>Optional Feature</Text>
                  <Text style={styles.optionalFeatureBody}>
                    The Concierge (on-device AI) and Clinical Knowledge are
                    optional downloads. They enhance the app with explanations
                    of alerts, medication checks, care-plan support, and
                    grounded answers with citations. You can skip them now and
                    download later from Settings → Models and Clinical
                    Knowledge. All health monitoring and care-planning
                    features work without them.
                  </Text>
                </View>
              </>
            ) : null}

            {stepIndex === 5 ? (
              <StepShell
                title="Device"
                subtitle="Choose the device the patient uses so the app can understand normal patterns over time."
              >
                <ChipGroup
                  label="Device type"
                  options={WEARABLE_DEVICE_OPTIONS}
                  selectedValue={deviceType}
                  onSelect={(value) => {
                    setDeviceType(value);
                    setDeviceConnected(false);
                    setBaselineStatus("not_started");
                  }}
                />

                <Field
                  label="Device label"
                  value={deviceLabel}
                  onChangeText={setDeviceLabel}
                  placeholder="Device label"
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
                          ? "Device connected"
                          : "Device not connected yet"}
                      </Text>
                      <Text style={styles.deviceSubtitle}>
                        {getBaselineStatusText(baselineStatus)}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    style={styles.connectButton}
                    onPress={connectAppleWatch}
                  >
                    <Text style={styles.connectButtonText}>
                      Check device connection
                    </Text>
                  </Pressable>

                  <Text style={styles.deviceHelper}>
                    We’ll use this to understand normal vital and movement
                    patterns over time.
                  </Text>
                </View>

                <View style={styles.summaryCard}>
                  <Text style={styles.summaryTitle}>What this helps with</Text>

                  <SummaryRow text="Baseline vitals and mobility patterns" />
                  <SummaryRow text="In-app alerts for non-emergency changes" />
                  <SummaryRow text="Better context before sending too many notifications" />
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
            >
              <Text style={styles.primaryButtonText}>
                {isIntroScreen
                  ? "Start Onboarding"
                  : isFinalStep
                    ? "Continue to Home"
                    : "Continue"}
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
            ? "Hide demo onboarding cases"
            : "Show demo onboarding cases"
        }
        accessibilityState={{ expanded: isDemoCasesExpanded }}
      >
        <AppIcon
          name="chevronRight"
          size={24}
          color={AppTheme.colors.textMuted}
        />
      </Pressable>

      <View style={styles.heroLogoCard}>
        <Image
          source={require("@/assets/images/hta-logo.png")}
          style={styles.heroLogoImage}
          resizeMode="contain"
        />
      </View>

      <Text style={styles.welcomeEyebrow}>Caregiver Concierge</Text>
      <Text style={styles.welcomeTitle}>ACCESS-DP</Text>

      <Text style={styles.welcomeSubtitle}>
        Personalized caregiving support for alerts, routines, medications,
        safety decisions, and device-based health patterns.
      </Text>

      <View style={styles.previewCard}>
        <Text style={styles.previewTitle}>Designed for family caregivers</Text>

        <SummaryRow text="Quickly understand your patient’s health status." />
        <SummaryRow text="Follow confident care pathways while keeping human judgment at the center" />
        <SummaryRow text="Reduce uncertainty with structured health context" />
      </View>

      <Text style={styles.privacyText}>
        Takes about 5 minutes · You can update this later
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

function ProgressTracker({ activeIndex }: { activeIndex: number }) {
  return (
    <View style={styles.progressBlock}>
      <View style={styles.progressLine}>
        {formProgressSteps.map((label, index) => {
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
  const helperText = imported ? "Imported from EHR" : helper;

  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, imported && styles.inputImported]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={AppTheme.colors.textMuted}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        editable={editable}
        accessibilityLabel={
          imported ? `${label}. Imported from EHR. Read only.` : label
        }
        accessibilityHint={
          imported
            ? "This field was imported from the selected EHR profile and cannot be edited."
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
  const helperText = imported ? "Imported from EHR" : undefined;

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
        placeholderTextColor={AppTheme.colors.textMuted}
        multiline
        textAlignVertical="top"
        editable={editable}
        accessibilityLabel={
          imported ? `${label}. Imported from EHR. Read only.` : label
        }
        accessibilityHint={
          imported
            ? "This field was imported from the selected EHR profile and cannot be edited."
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
  return (
    <View>
      <Field
        label="Street address"
        value={address.line1}
        onChangeText={(value) => onChange("line1", value)}
        placeholder="Street address"
      />

      <Field
        label="Apartment, unit, or floor"
        value={address.line2 ?? ""}
        onChangeText={(value) => onChange("line2", value)}
        placeholder="Optional"
      />

      <View style={styles.twoColumnFields}>
        <Field
          label="City"
          value={address.city}
          onChangeText={(value) => onChange("city", value)}
          placeholder="City"
        />

        <Field
          label="State"
          value={address.state}
          onChangeText={(value) => onChange("state", value)}
          placeholder="State"
        />
      </View>

      <View style={styles.twoColumnFields}>
        <Field
          label="ZIP"
          value={address.postalCode}
          onChangeText={(value) => onChange("postalCode", value)}
          placeholder="ZIP"
        />

        <Field
          label="Country"
          value={address.country}
          onChangeText={(value) => onChange("country", value)}
          placeholder="United States"
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
}: {
  label: string;
  options: readonly T[];
  selectedValue: T;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.chipBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>

      <View style={styles.chipRow}>
        {options.map((option) => {
          const selected = option === selectedValue;

          return (
            <Pressable
              key={option}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => onSelect(option)}
            >
              <Text
                style={[
                  styles.chipText,
                  selected && styles.chipTextSelected,
                ]}
              >
                {option}
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
  return (
    <Pressable
      style={[styles.choiceCard, selected && styles.choiceCardSelected]}
      onPress={onPress}
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
  return (
    <View style={styles.selectPanel}>
      <Pressable style={styles.selectHeader} onPress={onToggle}>
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
  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryDot} />
      <Text style={styles.summaryText}>{text}</Text>
    </View>
  );
}

function getBaselineStatusText(status: WearableBaselineStatus): string {
  if (status === "simulated") {
    return "Baseline is ready for this demo.";
  }

  if (status === "connected") {
    return "Device connected and baseline is available.";
  }

  if (status === "failed") {
    return "Connection failed. Try again later.";
  }

  return "Tap below to check the device connection.";
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
  },
  keyboardRoot: {
    flex: 1,
  },
  root: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
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
    backgroundColor: AppTheme.colors.surface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: {
    color: AppTheme.colors.text,
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
    color: AppTheme.colors.textSoft,
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
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  progressDotActive: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  progressNumber: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  progressNumberActive: {
    color: AppTheme.colors.white,
  },
  progressLabel: {
    color: AppTheme.colors.textMuted,
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
    color: AppTheme.colors.text,
    fontSize: 38,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  welcomeSubtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 17,
    lineHeight: 27,
    textAlign: "center",
    marginBottom: 24,
  },
  previewCard: {
    width: "100%",
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 20,
    ...AppTheme.shadow,
  },
  previewTitle: {
    color: AppTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 14,
  },
  privacyText: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 20,
    textAlign: "center",
  },
  demoProfileBlock: {
    width: "100%",
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
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
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  demoProfileRowSelected: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
  },
  demoProfileTextBlock: {
    flex: 1,
  },
  demoProfileTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  demoProfileSubtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },

  stepShell: {
    gap: 16,
  },
  stepIntro: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderWidth: 1,
    borderColor: "#B7FFF1",
    borderRadius: AppTheme.radius.card,
    padding: 20,
    marginBottom: 4,
  },
  stepTitle: {
    color: AppTheme.colors.text,
    fontSize: 26,
    fontWeight: "900",
    marginBottom: 8,
  },
  stepSubtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "600",
  },
  sectionLabel: {
    color: AppTheme.colors.sectionText,
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
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
  },
  fieldHelper: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 6,
    lineHeight: 17,
  },
  input: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  inputImported: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
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
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 6,
  },

  diagnosisHelper: {
    color: AppTheme.colors.textSoft,
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
    backgroundColor: AppTheme.colors.brandSoft,
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
  },
  ehrIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: AppTheme.colors.white,
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
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    marginTop: 2,
  },
  ehrSelectedPatient: {
    color: AppTheme.colors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
    marginTop: 6,
  },
  ehrAppliedButton: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
    opacity: 0.7,
  },
  ehrDisabledButton: {
    opacity: 0.55,
  },
  clinicalGuidanceCard: {
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: "#B7DDE8",
    backgroundColor: "#F4FBFC",
    padding: 16,
    gap: 14,
  },
  clinicalGuidanceHeader: {
    gap: 6,
  },
  clinicalGuidanceTitle: {
    color: AppTheme.colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  clinicalGuidanceText: {
    color: AppTheme.colors.textSoft,
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
    borderColor: "#D9E7E5",
    backgroundColor: AppTheme.colors.white,
    padding: 12,
  },
  guidanceMetricLabel: {
    color: AppTheme.colors.sectionText,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  guidanceMetricValue: {
    color: AppTheme.colors.text,
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
    borderBottomColor: AppTheme.colors.border,
    gap: 10,
  },
  mobilityOptionRowSelected: {
    backgroundColor: AppTheme.colors.brandSoft,
  },
  mobilityIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: AppTheme.colors.white,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
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
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  mobilityOptionDescription: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  suggestedDiagnosisBlock: {
    gap: 10,
  },
  suggestedDiagnosisTitle: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  suggestedDiagnosisRow: {
    gap: 10,
  },
  suggestedDiagnosisChip: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
    padding: 14,
  },
  suggestedDiagnosisChipSelected: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
  },
  suggestedDiagnosisCode: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 4,
  },
  suggestedDiagnosisCodeSelected: {
    color: AppTheme.colors.brandDark,
  },
  suggestedDiagnosisLabel: {
    color: AppTheme.colors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "800",
  },
  suggestedDiagnosisLabelSelected: {
    color: AppTheme.colors.text,
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
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  chipSelected: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  chipText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "900",
  },
  chipTextSelected: {
    color: AppTheme.colors.white,
  },

  choiceCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
    padding: 16,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  choiceCardSelected: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: AppTheme.colors.border,
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
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 4,
  },
  choiceBody: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },

  selectPanel: {
    borderRadius: AppTheme.radius.lg,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
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
    color: AppTheme.colors.sectionText,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  selectValue: {
    color: AppTheme.colors.text,
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
    borderTopColor: AppTheme.colors.border,
    padding: 10,
    gap: 8,
  },

  optionRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  optionRowSelected: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
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
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  optionCategory: {
    color: AppTheme.colors.textSoft,
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
    borderColor: AppTheme.colors.border,
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
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: AppTheme.colors.text,
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
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  symptomChipSelected: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  symptomChipText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "800",
  },
  symptomChipTextSelected: {
    color: AppTheme.colors.white,
  },
  emptySelectText: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    paddingVertical: 10,
    textAlign: "center",
  },

  disclaimerCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
    padding: 16,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  disclaimerCardAccepted: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
  },
  disclaimerTextBlock: {
    flex: 1,
    marginLeft: 12,
  },
  disclaimerTitle: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 5,
  },
  disclaimerBody: {
    color: AppTheme.colors.textSoft,
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
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
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
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  deviceTextBlock: {
    flex: 1,
  },
  deviceTitle: {
    color: AppTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 4,
  },
  deviceSubtitle: {
    color: AppTheme.colors.textSoft,
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
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
    marginTop: 14,
  },
  summaryCard: {
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
    padding: 18,
  },
  summaryTitle: {
    color: AppTheme.colors.text,
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
    color: AppTheme.colors.textSoft,
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
    backgroundColor: AppTheme.colors.screen,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
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
