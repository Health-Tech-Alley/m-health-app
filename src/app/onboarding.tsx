import { useRouter } from "expo-router";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useMemo, useState } from "react";
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
import { AppTheme } from "@/constants/theme";
import {
  COMMON_ICD_OPTIONS,
  COMMON_SYMPTOM_OPTIONS,
  WEARABLE_DEVICE_OPTIONS,
  completeOnboardingProfile,
  getOnboardingProfile,
  type AddressProfile,
  type Availability,
  type CaregivingExperience,
  type EmergencyComfortLevel,
  type IcdConditionProfile,
  type LanguagePreference,
  type MedicalComfortLevel,
  type NotificationStyle,
  type OnboardingProfile,
  type SymptomProfile,
  type WearableBaselineStatus,
  type WearableDeviceType,
} from "@/services/onboarding/onboardingService";
import {
  getElenaGarciaFhirOnboardingImport,
  type OnboardingFhirImportResult,
} from "@/services/onboarding/fhirDemoImport";
import { refreshPatientRecord } from "@/contexts/patient-record-context";

const totalScreens = 6;
const formStepCount = 5;

const formProgressSteps = [
  "Caregiver",
  "Caregiving",
  "Patient",
  "Safety",
  "Device",
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
  | "comorbidities"
  | "symptoms"
  | "gmfcs"
  | "fms"
  | "macs"
  | "cfcs"
  | "edacs"
  | null;

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

export default function OnboardingScreen() {
  const router = useRouter();
  const existingProfile = getOnboardingProfile();

  const [stepIndex, setStepIndex] = useState(0);
  const [expandedSelect, setExpandedSelect] = useState<ExpandedSelect>(null);

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
  const [officialFirstName, setOfficialFirstName] = useState(
    existingProfile.patient.officialFirstName ?? "",
  );
  const [officialLastName, setOfficialLastName] = useState(
    existingProfile.patient.officialLastName ?? "",
  );
  const [officialDisplayName, setOfficialDisplayName] = useState(
    existingProfile.patient.officialDisplayName ?? "",
  );
  const [patientAge, setPatientAge] = useState(existingProfile.patient.age);

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

  const [primaryDiagnosisText, setPrimaryDiagnosisText] = useState(() =>
    getInitialPrimaryDiagnosisText({
      code: existingProfile.patient.primaryIcdCode,
      label: existingProfile.patient.primaryIcdLabel,
      fallback: existingProfile.patient.conditions,
    }),
  );

  const [comorbidities, setComorbidities] = useState<IcdConditionProfile[]>(
    () =>
      (existingProfile.patient.comorbidities ?? []).map((condition) => ({
        ...condition,
        isPrimary: false,
      })),
  );

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
  const [currentMedications, setCurrentMedications] = useState(
    existingProfile.patient.currentMedications ?? "",
  );
  const [spo2Cutoff, setSpo2Cutoff] = useState(
    existingProfile.patient.spo2Cutoff ?? "",
  );
  const [baselineHeartRate, setBaselineHeartRate] = useState(
    existingProfile.patient.baselineHeartRate ?? "",
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
  // D5: free-text location for SDOH / CDC PLACES bundling.
  const [patientLocation, setPatientLocation] = useState(
    existingProfile.patient.location ?? "",
  );
  const [ehrRecordApplied, setEhrRecordApplied] = useState(false);
  const [clinicalImport, setClinicalImport] = useState<
    OnboardingFhirImportResult["clinicalImport"] | undefined
  >(existingProfile.clinicalImport);

  function handleApplyEhrRecord() {
    if (ehrRecordApplied) return;
    const { onboardingPatch, clinicalImport: importedClinicalPackage } =
      getElenaGarciaFhirOnboardingImport();
    const primaryDiagnosis = getInitialPrimaryDiagnosisText({
      code: onboardingPatch.primaryCondition?.code,
      label: onboardingPatch.primaryCondition?.label,
    });

    if (onboardingPatch.officialFirstName) {
      setOfficialFirstName(onboardingPatch.officialFirstName);
    }
    if (onboardingPatch.officialLastName) {
      setOfficialLastName(onboardingPatch.officialLastName);
    }
    if (onboardingPatch.officialDisplayName) {
      setOfficialDisplayName(onboardingPatch.officialDisplayName);
    }
    if (onboardingPatch.patientAge) {
      setPatientAge(onboardingPatch.patientAge);
    }
    if (primaryDiagnosis) {
      setPrimaryDiagnosisText(primaryDiagnosis);
    }
    if (onboardingPatch.comorbidities.length) {
      setComorbidities(onboardingPatch.comorbidities);
    }
    if (onboardingPatch.baselineDailyRoutine) {
      setBaselineDailyRoutine(onboardingPatch.baselineDailyRoutine);
    }
    if (onboardingPatch.currentMedications) {
      setCurrentMedications(onboardingPatch.currentMedications);
    }
    if (onboardingPatch.spo2Cutoff) {
      setSpo2Cutoff(onboardingPatch.spo2Cutoff);
    }
    if (onboardingPatch.baselineHeartRate) {
      setBaselineHeartRate(onboardingPatch.baselineHeartRate);
    }
    if (onboardingPatch.gmfcsLevel) {
      setGmfcsLevel(normalizeClassificationValue(onboardingPatch.gmfcsLevel));
    }
    setFmsScore((current) => current || "Not assessed");
    if (onboardingPatch.macsLevel) {
      setMacsLevel(normalizeClassificationValue(onboardingPatch.macsLevel));
    }
    if (onboardingPatch.cfcsLevel) {
      setCfcsLevel(normalizeClassificationValue(onboardingPatch.cfcsLevel));
    }
    if (onboardingPatch.edacsLevel) {
      setEdacsLevel(normalizeClassificationValue(onboardingPatch.edacsLevel));
    }
    setClinicalImport(importedClinicalPackage);
    setEhrRecordApplied(true);
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

  const matchedPrimaryCondition = useMemo(
    () => findMatchingDiagnosis(primaryDiagnosisText),
    [primaryDiagnosisText],
  );

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

  const isIntroScreen = stepIndex === 0;
  const canGoBack = stepIndex > 0;
  const isFinalStep = stepIndex === totalScreens - 1;
  const formStepNumber = Math.max(stepIndex, 1);

  function goBack() {
    if (canGoBack) {
      setExpandedSelect(null);
      setStepIndex((current) => current - 1);
    }
  }

  function goNext() {
    setExpandedSelect(null);

    if (isFinalStep) {
      void saveProfileAndContinue();
      return;
    }

    setStepIndex((current) => Math.min(current + 1, totalScreens - 1));
  }

  async function saveProfileAndContinue() {
    const finalPatientAddress = patientAddressSameAsCaregiver
      ? caregiverAddress
      : patientAddress;

    const primaryDiagnosis = parsePrimaryDiagnosisInput(primaryDiagnosisText);
    const finalComorbidities = dedupeIcdConditions(
      comorbidities,
      primaryDiagnosis.code,
      primaryDiagnosis.label,
    );

    const conditions = [
      primaryDiagnosis.label,
      ...finalComorbidities.map((condition) => condition.label),
    ]
      .filter(Boolean)
      .join(", ");

    const profile: OnboardingProfile = {
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
        name: patientPreferredName,
        preferredName: patientPreferredName,
        officialFirstName,
        officialLastName,
        officialDisplayName,
        age: patientAge,
        conditions,
        addressSameAsCaregiver: patientAddressSameAsCaregiver,
        address: finalPatientAddress,
        primaryIcdCode: primaryDiagnosis.code,
        primaryIcdLabel: primaryDiagnosis.label,
        comorbidities: finalComorbidities,
        symptoms: selectedSymptoms,
        otherSymptoms,
        baselineDailyRoutine,
        currentMedications,
        spo2Cutoff,
        baselineHeartRate,
        gmfcsLevel,
        fmsScore,
        macsLevel,
        cfcsLevel,
        edacsLevel,
        location: patientLocation,
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
      clinicalImport,
      completedAt: new Date().toISOString(),
    };

    const result = await completeOnboardingProfile(profile);
    refreshPatientRecord(result.patientId);
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

  function toggleComorbidity(condition: IcdConditionProfile) {
    setComorbidities((current) => {
      const exists = current.some((item) => item.code === condition.code);

      if (exists) {
        return current.filter((item) => item.code !== condition.code);
      }

      return [
        ...current,
        {
          ...condition,
          isPrimary: false,
        },
      ];
    });
  }

  function toggleSymptom(symptomId: string) {
    setSelectedSymptoms((current) => {
      if (current.includes(symptomId)) {
        return current.filter((id) => id !== symptomId);
      }

      return [...current, symptomId];
    });
  }

  function simulateDeviceConnection() {
    const startedAt = new Date().toISOString();

    setBaselineStartedAt(startedAt);
    setBaselineStatus("not_started");
    setDeviceConnected(false);

    setTimeout(() => {
      const completedAt = new Date().toISOString();

      setDeviceConnected(true);
      setBaselineStatus("simulated");
      setBaselineCompletedAt(completedAt);
    }, 1000);
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

            {stepIndex === 0 ? <WelcomeStep /> : null}

            {stepIndex === 1 ? (
              <StepShell
                title="About You"
                subtitle="Tell us who is providing care and where to reach you."
              >
                <Field
                  label="Caregiver name"
                  value={caregiverName}
                  onChangeText={setCaregiverName}
                  placeholder="Luis Garcia"
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
                  placeholder="(555) 010-2030"
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
                  placeholder="Maria Garcia · (555) 020-3040"
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

                <SectionLabel title="Patient address" />

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

                <SectionLabel title="Clinical information" />

                <Text style={styles.diagnosisHelper}>
                  Use information from the health record to help complete the
                  patient profile, or enter the information manually.
                </Text>

                <Pressable
                  style={[styles.ehrPlaceholderButton, ehrRecordApplied && styles.ehrAppliedButton]}
                  onPress={handleApplyEhrRecord}
                  disabled={ehrRecordApplied}
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
                      {ehrRecordApplied ? "Health record imported" : "Import from health record"}
                    </Text>
                    <Text style={styles.ehrSubtitle}>
                      {ehrRecordApplied
                        ? "Official and clinical details are ready for review"
                        : "Use the local Elena Garcia demo Bundle"}
                    </Text>
                  </View>
                </Pressable>

                <View style={styles.twoColumnFields}>
                  <Field
                    label="First name"
                    value={officialFirstName}
                    onChangeText={setOfficialFirstName}
                    placeholder="Imported from health record"
                  />

                  <Field
                    label="Last name"
                    value={officialLastName}
                    onChangeText={setOfficialLastName}
                    placeholder="Imported from health record"
                  />
                </View>

                <Field
                  label="Age"
                  value={patientAge}
                  onChangeText={setPatientAge}
                  placeholder="Age"
                  keyboardType="number-pad"
                />

                <SectionLabel title="Primary diagnosis" />

                <Field
                  label="ICD code or official diagnosis name"
                  value={primaryDiagnosisText}
                  onChangeText={setPrimaryDiagnosisText}
                  placeholder="ICD code or diagnosis name"
                />

                <Text style={styles.diagnosisHelper}>
                  Enter the main diagnosis exactly as it appears in paperwork if
                  possible.
                </Text>

                <SectionLabel title="Comorbidities or other conditions" />

                <SelectPanel
                  title="Comorbidities"
                  value={
                    comorbidities.length > 0
                      ? `${comorbidities.length} selected`
                      : "No comorbidities selected"
                  }
                  expanded={expandedSelect === "comorbidities"}
                  onToggle={() =>
                    setExpandedSelect((current) =>
                      current === "comorbidities" ? null : "comorbidities",
                    )
                  }
                >
                  {COMMON_ICD_OPTIONS.filter(
                    (condition) =>
                      condition.code !== matchedPrimaryCondition?.code,
                  ).map((condition) => {
                    const selected = comorbidities.some(
                      (item) => item.code === condition.code,
                    );

                    return (
                      <Pressable
                        key={condition.code}
                        style={[
                          styles.optionRow,
                          selected && styles.optionRowSelected,
                        ]}
                        onPress={() => toggleComorbidity(condition)}
                      >
                        <View
                          style={[
                            styles.checkCircle,
                            selected && styles.checkCircleSelected,
                          ]}
                        >
                          {selected ? (
                            <AppIcon
                              name="check"
                              size={14}
                              color={AppTheme.colors.white}
                            />
                          ) : null}
                        </View>

                        <View style={styles.optionTextBlock}>
                          <Text style={styles.optionCode}>
                            {condition.code}
                          </Text>
                          <Text style={styles.optionLabel}>
                            {condition.label}
                          </Text>
                          <Text style={styles.optionCategory}>
                            {condition.category}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </SelectPanel>

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
                  label="Baseline daily routine"
                  value={baselineDailyRoutine}
                  onChangeText={setBaselineDailyRoutine}
                  placeholder="Describe the usual daily routine..."
                />

                <LargeField
                  label="Current medications"
                  value={currentMedications}
                  onChangeText={setCurrentMedications}
                  placeholder="List current medications..."
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

                  <View style={styles.guidanceMetricRow}>
                    <View style={styles.guidanceMetric}>
                      <Text style={styles.guidanceMetricLabel}>
                        Baseline SpO₂
                      </Text>
                      <Text style={styles.guidanceMetricValue}>
                        Confirm from care plan
                      </Text>
                    </View>
                    <View style={styles.guidanceMetric}>
                      <Text style={styles.guidanceMetricLabel}>
                        Mobility classification
                      </Text>
                      <Text style={styles.guidanceMetricValue}>
                        GMFCS / FMS
                      </Text>
                    </View>
                  </View>

                <View style={styles.twoColumnFields}>
                  <Field
                    label="SpO₂ cutoff"
                    value={spo2Cutoff}
                    onChangeText={setSpo2Cutoff}
                    placeholder="Care-plan cutoff"
                  />

                  <Field
                    label="Baseline HR"
                    value={baselineHeartRate}
                    onChangeText={setBaselineHeartRate}
                    placeholder="Baseline range"
                  />
                </View>

                <Field
                  label="Location (county, state)"
                  value={patientLocation}
                  onChangeText={setPatientLocation}
                  placeholder="e.g. Garrett County, Maryland"
                  helper="Used to fetch community health context (CDC PLACES) and tailor rural/urban care guidance."
                />

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
                </View>
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
                  placeholder="Dr. Smith"
                />

                <Field
                  label="Provider phone"
                  value={providerPhone}
                  onChangeText={setProviderPhone}
                  placeholder="(555) 800-1234"
                  keyboardType="phone-pad"
                />

                <Field
                  label="Provider email"
                  value={providerEmail}
                  onChangeText={setProviderEmail}
                  placeholder="dr.smith@clinic.org"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <SectionLabel title="Emergency and safety" />

                <Field
                  label="Emergency contact"
                  value={emergencyContact}
                  onChangeText={setEmergencyContact}
                  placeholder="Maria Garcia · (555) 020-3040"
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
                  placeholder="Elena's Apple Watch"
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
                    onPress={simulateDeviceConnection}
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
            <Pressable style={styles.primaryButton} onPress={goNext}>
              <Text style={styles.primaryButtonText}>
                {isIntroScreen
                  ? "Start Onboarding"
                  : isFinalStep
                    ? "Go to Dashboard"
                    : "Continue"}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function WelcomeStep() {
  return (
    <View style={styles.welcome}>
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

        <SummaryRow text="Understand what is happening quickly" />
        <SummaryRow text="Keep emergency decisions human-controlled" />
        <SummaryRow text="Reduce guessing with structured health context" />
        <SummaryRow text="Prepare data for future EHR and wearable integration" />
      </View>

      <Text style={styles.privacyText}>
        Takes about 3 minutes · You can update this later
      </Text>
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
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: "default" | "phone-pad" | "number-pad" | "email-address";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  helper?: string;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={AppTheme.colors.textMuted}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
      />
      {helper ? <Text style={styles.fieldHelper}>{helper}</Text> : null}
    </View>
  );
}

function LargeField({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, styles.largeInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={AppTheme.colors.textMuted}
        multiline
        textAlignVertical="top"
      />
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
        placeholder="1200 Cypress Ave"
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
          placeholder="Gaithersburg"
        />

        <Field
          label="State"
          value={address.state}
          onChangeText={(value) => onChange("state", value)}
          placeholder="MD"
        />
      </View>

      <View style={styles.twoColumnFields}>
        <Field
          label="ZIP"
          value={address.postalCode}
          onChangeText={(value) => onChange("postalCode", value)}
          placeholder="20877"
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
  id: Exclude<ExpandedSelect, "comorbidities" | "symptoms" | null>;
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

function getInitialPrimaryDiagnosisText({
  code,
  label,
  fallback,
}: {
  code?: string;
  label?: string;
  fallback?: string;
}): string {
  if (code && label) {
    return `${code} · ${label}`;
  }

  return code ?? label ?? fallback ?? "";
}

function normalizeDiagnosisText(value: string): string {
  return value.trim().toLowerCase();
}

function findMatchingDiagnosis(value: string): IcdConditionProfile | undefined {
  const normalized = normalizeDiagnosisText(value);

  return COMMON_ICD_OPTIONS.find((option) => {
    const code = normalizeDiagnosisText(option.code);
    const label = normalizeDiagnosisText(option.label);
    const combined = normalizeDiagnosisText(`${option.code} · ${option.label}`);

    return normalized === code || normalized === label || normalized === combined;
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

function parsePrimaryDiagnosisInput(value: string): {
  code?: string;
  label: string;
} {
  const trimmed = value.trim();

  if (!trimmed) {
    return {
      code: undefined,
      label: "",
    };
  }

  const matched = findMatchingDiagnosis(trimmed);

  if (matched) {
    return {
      code: matched.code,
      label: matched.label,
    };
  }

  const codedDisplayMatch = trimmed.match(
    /^([A-Z][0-9][A-Z0-9.]*)\s*(?:[\u00B7-]+|\s+)\s*(.+)$/i,
  );
  if (codedDisplayMatch) {
    return {
      code: codedDisplayMatch[1].toUpperCase(),
      label: codedDisplayMatch[2].trim(),
    };
  }

  const looksLikeIcdCode = /^[A-Z][0-9][A-Z0-9.]*$/i.test(trimmed);

  return {
    code: looksLikeIcdCode ? trimmed.toUpperCase() : undefined,
    label: trimmed,
  };
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
  largeInput: {
    minHeight: 104,
    lineHeight: 22,
  },
  twoColumnFields: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
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
  ehrAppliedButton: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
    opacity: 0.7,
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
