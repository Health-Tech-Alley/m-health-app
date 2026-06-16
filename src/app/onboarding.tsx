/**
 * First-time caregiver onboarding screen.
 *
 * Collects caregiver, patient, provider, preferences, and safety information.
 * Saves the profile through onboardingService before opening the dashboard.
 */

import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  Availability,
  CaregivingExperience,
  EmergencyComfortLevel,
  LanguagePreference,
  MedicalComfortLevel,
  NotificationStyle,
  saveOnboardingProfile,
} from "../services/onboarding/onboardingService";

const teal = "#008573";
const tealSoft = "#E9FFFA";
const darkText = "#102033";
const mutedText = "#667085";
const helperText = "#8EA0BA";
const lightBackground = "#FFFFFF";
const screenBackground = "#F7FAF9";
const cardBorder = "#E4E7EC";
const inactiveDot = "#E5E7EB";

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

const progressSteps = [
  "Welcome",
  "About You",
  "Caregiving",
  "Patient",
  "Safety",
];

export default function OnboardingScreen() {
  const router = useRouter();

  const [step, setStep] = useState(0);

  const [caregiverName, setCaregiverName] = useState("Luis Garcia");
  const [relationship, setRelationship] = useState("Son");
  const [caregiverPhone, setCaregiverPhone] = useState("(555) 010-2030");

  const [experience, setExperience] =
    useState<CaregivingExperience>("Some experience");
  const [availability, setAvailability] =
    useState<Availability>("Evenings & weekends");
  const [notificationStyle, setNotificationStyle] =
    useState<NotificationStyle>("Push + sound");
  const [languagePreference, setLanguagePreference] =
    useState<LanguagePreference>("English + Español");

  const [medicalComfortLevel, setMedicalComfortLevel] =
    useState<MedicalComfortLevel>("Moderate detail");
  const [emergencyComfortLevel, setEmergencyComfortLevel] =
    useState<EmergencyComfortLevel>("Would call 911 if needed");

  const [hobbiesOrRoutines, setHobbiesOrRoutines] = useState(
    "Cooking, evening walks",
  );
  const [mainConcern, setMainConcern] = useState("Breathing episodes");
  const [stressOrSupportNeeds, setStressOrSupportNeeds] = useState(
    "Family check-ins help",
  );
  const [backupCaregiver, setBackupCaregiver] = useState(
    "Maria Garcia · (555) 020-3040",
  );

  const [patientName, setPatientName] = useState("Elena Garcia");
  const [patientAge, setPatientAge] = useState("72");
  const [conditions, setConditions] = useState(
    "COPD, Traumatic Brain Injury",
  );
  const [baselineDailyRoutine, setBaselineDailyRoutine] = useState(
    "Wakes at 8am, naps at 2pm, quiet evenings",
  );
  const [currentMedications, setCurrentMedications] = useState(
    "Albuterol PRN, Tiotropium daily, Prednisone",
  );
  const [spo2Cutoff, setSpo2Cutoff] = useState("88%");
  const [baselineHeartRate, setBaselineHeartRate] = useState("72–88 BPM");

  const [providerName, setProviderName] = useState("Dr. Smith");
  const [providerPhone, setProviderPhone] = useState("(555) 800-1234");
  const [providerEmail, setProviderEmail] = useState("dr.smith@clinic.org");
  const [emergencyContact, setEmergencyContact] = useState(
    "Maria Garcia · (555) 020-3040",
  );
  const [safetyNotes, setSafetyNotes] = useState(
    "Allergic to penicillin. Falls risk.",
  );

  function handleNext() {
    if (step < 4) {
      setStep(step + 1);
      return;
    }

    saveOnboardingProfile({
      caregiver: {
        name: caregiverName,
        relationship,
        phone: caregiverPhone,
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
        name: patientName,
        age: patientAge,
        conditions,
        baselineDailyRoutine,
        currentMedications,
        spo2Cutoff,
        baselineHeartRate,
      },
      primaryCareProvider: {
        name: providerName,
        phone: providerPhone,
        email: providerEmail,
      },
      safety: {
        emergencyContact,
        safetyNotes,
        emergencyDisclaimerAccepted: true,
      },
    });

    router.replace("/dashboard");
  }

  function handleBack() {
    if (step === 0) return;
    setStep(step - 1);
  }

  const title = getStepTitle(step);
  const description = getStepDescription(step);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      {step === 0 ? (
        <WelcomeStep onNext={handleNext} />
      ) : (
        <View style={styles.root}>
          <View style={styles.header}>
            <View style={styles.headerTopRow}>
              <Pressable style={styles.backButton} onPress={handleBack}>
                <Text style={styles.backButtonText}>‹</Text>
              </Pressable>

              <View style={styles.headerTextBlock}>
                <Text style={styles.stepText}>Step {step} of 4</Text>
                <Text style={styles.headerTitle}>{title}</Text>
              </View>

              <View style={styles.shieldButton}>
                <Text style={styles.shieldText}>⌾</Text>
              </View>
            </View>

            <ProgressTracker activeStep={step} />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            <View style={styles.callout}>
              <Text style={styles.calloutText}>{description}</Text>
            </View>

            {step === 1 && (
              <>
                <Field
                  label="Your Name"
                  value={caregiverName}
                  onChangeText={setCaregiverName}
                />

                <Field
                  label="Your Relationship to Elena"
                  value={relationship}
                  onChangeText={setRelationship}
                />

                <Field
                  label="Your Phone Number"
                  value={caregiverPhone}
                  onChangeText={setCaregiverPhone}
                />

                <ChipGroup
                  label="Caregiving Experience"
                  value={experience}
                  options={experienceOptions}
                  onChange={setExperience}
                  helper="Helps us explain medical information at the right level."
                />

                <ChipGroup
                  label="Your Typical Availability"
                  value={availability}
                  options={availabilityOptions}
                  onChange={setAvailability}
                />

                <ChipGroup
                  label="Preferred Notification Style"
                  value={notificationStyle}
                  options={notificationOptions}
                  onChange={setNotificationStyle}
                />

                <ChipGroup
                  label="Language Preference"
                  value={languagePreference}
                  options={languageOptions}
                  onChange={setLanguagePreference}
                />
              </>
            )}

            {step === 2 && (
              <>
                <ChipGroup
                  label="Comfort With Medical Information"
                  value={medicalComfortLevel}
                  options={medicalComfortOptions}
                  onChange={setMedicalComfortLevel}
                  helper="We'll adjust how we explain alerts and recommendations."
                />

                <ChipGroup
                  label="Emergency Comfort Level"
                  value={emergencyComfortLevel}
                  options={emergencyComfortOptions}
                  onChange={setEmergencyComfortLevel}
                  helper="The app will always guide you — it never calls 911 on its own."
                />

                <LargeField
                  label="Your Hobbies or Daily Routines"
                  value={hobbiesOrRoutines}
                  onChangeText={setHobbiesOrRoutines}
                  helper="Optional. Helps us avoid scheduling conflicts."
                />

                <LargeField
                  label="Your Main Caregiving Concern"
                  value={mainConcern}
                  onChangeText={setMainConcern}
                />

                <LargeField
                  label="Stress or Support Needs"
                  value={stressOrSupportNeeds}
                  onChangeText={setStressOrSupportNeeds}
                  helper="Optional. This helps us offer appropriate support resources."
                />

                <Field
                  label="Backup Caregiver or Family Support"
                  value={backupCaregiver}
                  onChangeText={setBackupCaregiver}
                  helper="Who else can be contacted if you're unavailable?"
                />
              </>
            )}

            {step === 3 && (
              <>
                <Field
                  label="Patient Name"
                  value={patientName}
                  onChangeText={setPatientName}
                />

                <Field
                  label="Patient Age"
                  value={patientAge}
                  onChangeText={setPatientAge}
                />

                <LargeField
                  label="Conditions or Diagnosis"
                  value={conditions}
                  onChangeText={setConditions}
                />

                <LargeField
                  label="Baseline Daily Routine"
                  value={baselineDailyRoutine}
                  onChangeText={setBaselineDailyRoutine}
                  helper="Helps detect when Elena's pattern changes."
                />

                <LargeField
                  label="Current Medications"
                  value={currentMedications}
                  onChangeText={setCurrentMedications}
                />

                <Field
                  label="SpO₂ Cutoff"
                  value={spo2Cutoff}
                  onChangeText={setSpo2Cutoff}
                />

                <Field
                  label="Baseline Heart Rate"
                  value={baselineHeartRate}
                  onChangeText={setBaselineHeartRate}
                />
              </>
            )}

            {step === 4 && (
              <>
                <Field
                  label="Primary Care Provider"
                  value={providerName}
                  onChangeText={setProviderName}
                />

                <Field
                  label="PCP Phone"
                  value={providerPhone}
                  onChangeText={setProviderPhone}
                />

                <Field
                  label="PCP Email"
                  value={providerEmail}
                  onChangeText={setProviderEmail}
                />

                <Field
                  label="Emergency Contact"
                  value={emergencyContact}
                  onChangeText={setEmergencyContact}
                  helper="A person we should surface if you can't be reached."
                />

                <LargeField
                  label="Important Safety Notes"
                  value={safetyNotes}
                  onChangeText={setSafetyNotes}
                  helper="Shown prominently in urgent alert screens."
                />

                <View style={styles.noteBox}>
                  <Text style={styles.noteText}>
                    This app will never automatically call 911 or contact a
                    provider. Emergency actions require caregiver confirmation.
                  </Text>
                </View>
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.primaryButton} onPress={handleNext}>
              <Text style={styles.primaryButtonText}>
                {step === 4 ? "Go to Dashboard" : "Continue"}
              </Text>
              <Text style={styles.primaryButtonArrow}>›</Text>
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <View style={styles.welcomeRoot}>
      <View style={styles.welcomeTop}>
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
          and safety decisions.
        </Text>
      </View>
      
      <View style={styles.welcomePreviewCard}>
        <Text style={styles.welcomeCardTitle}>Designed for family caregivers</Text>

        <View style={styles.featureRow}>
          <View style={styles.featureDot} />
          <Text style={styles.featureText}>
            Builds a profile around the caregiver and patient.
          </Text>
        </View>

        <View style={styles.featureRow}>
          <View style={styles.featureDot} />
          <Text style={styles.featureText}>
            Uses safety notes, provider details, and baseline routines.
          </Text>
        </View>

        <View style={styles.featureRow}>
          <View style={styles.featureDot} />
          <Text style={styles.featureText}>
            Keeps emergency choices in the caregiver&apos;s control.
          </Text>
        </View>
      </View>
    
      <View style={styles.welcomeFooter}>
        <Text style={styles.privacyText}>
          Takes about 2 minutes · You can update this later
        </Text>

        <Pressable style={styles.welcomeButton} onPress={onNext}>
          <Text style={styles.welcomeButtonText}>Start Onboarding</Text>
          <Text style={styles.primaryButtonArrow}>›</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ProgressTracker({ activeStep }: { activeStep: number }) {
  const activeIndex = activeStep;

  return (
    <View style={styles.progressWrapper}>
      {progressSteps.map((label, index) => {
        const isComplete = index < activeIndex;
        const isActive = index === activeIndex;

        return (
          <View key={label} style={styles.progressItem}>
            <View style={styles.progressTopRow}>
              <View
                style={[
                  styles.progressCircle,
                  isComplete && styles.progressCircleComplete,
                  isActive && styles.progressCircleActive,
                ]}
              >
                <Text
                  style={[
                    styles.progressCircleText,
                    (isComplete || isActive) && styles.progressCircleTextActive,
                  ]}
                >
                  {isComplete ? "✓" : index + 1}
                </Text>
              </View>

              {index < progressSteps.length - 1 ? (
                <View
                  style={[
                    styles.progressConnector,
                    index < activeIndex && styles.progressConnectorActive,
                  ]}
                />
              ) : null}
            </View>

            <Text
              style={[
                styles.progressLabel,
                (isComplete || isActive) && styles.progressLabelActive,
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  helper,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  helper?: string;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor="#98A2B3"
        selectionColor={teal}
      />
      {helper ? <Text style={styles.helperText}>{helper}</Text> : null}
    </View>
  );
}

function LargeField({
  label,
  value,
  onChangeText,
  helper,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  helper?: string;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, styles.largeInput]}
        value={value}
        onChangeText={onChangeText}
        multiline
        textAlignVertical="top"
        placeholderTextColor="#98A2B3"
        selectionColor={teal}
      />
      {helper ? <Text style={styles.helperText}>{helper}</Text> : null}
    </View>
  );
}

function ChipGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  helper,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (value: T) => void;
  helper?: string;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>

      <View style={styles.chipRow}>
        {options.map((option) => {
          const isSelected = option === value;

          return (
            <Pressable
              key={option}
              style={[styles.chip, isSelected && styles.chipSelected]}
              onPress={() => onChange(option)}
            >
              <Text
                style={[
                  styles.chipText,
                  isSelected && styles.chipTextSelected,
                ]}
              >
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {helper ? <Text style={styles.helperText}>{helper}</Text> : null}
    </View>
  );
}

function getStepTitle(step: number): string {
  if (step === 1) return "About You";
  if (step === 2) return "Your Caregiving";
  if (step === 3) return "About Elena";
  return "Safety & Providers";
}

function getStepDescription(step: number): string {
  if (step === 1) {
    return "Tell us a bit about yourself so we can personalize your experience.";
  }

  if (step === 2) {
    return "Help us understand how you care for Elena day-to-day.";
  }

  if (step === 3) {
    return "Tell us about the person you're caring for.";
  }

  return "Important contacts and safety information.";
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: lightBackground,
  },
  root: {
    flex: 1,
    backgroundColor: lightBackground,
  },

  welcomeRoot: {
    flex: 1,
    backgroundColor: screenBackground,
    paddingHorizontal: 28,
    paddingTop: 52,
    paddingBottom: 28,
    justifyContent: "space-between",
  },
  welcomeTop: {
    paddingTop: 28,
  },
  heroLogoCard: {
    width: 116,
    height: 116,
    borderRadius: 34,
    backgroundColor: teal,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
    shadowColor: "#003D35",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  heroLogoImage: {
    width: 86,
    height: 86,
  },
  welcomeEyebrow: {
    color: teal,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  welcomeTitle: {
    fontSize: 42,
    lineHeight: 48,
    fontWeight: "900",
    color: darkText,
    marginBottom: 16,
  },
  welcomeSubtitle: {
    fontSize: 18,
    lineHeight: 29,
    color: mutedText,
  },
  welcomePreviewCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: cardBorder,
    borderRadius: 28,
    padding: 22,
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  welcomeCardTitle: {
    color: darkText,
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 13,
  },
  featureDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: teal,
    marginTop: 7,
    marginRight: 11,
  },
  featureText: {
    flex: 1,
    color: mutedText,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "600",
  },
  welcomeFooter: {
    gap: 14,
  },
  privacyText: {
    color: helperText,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    fontWeight: "700",
  },
  welcomeButton: {
    backgroundColor: teal,
    borderRadius: 18,
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    shadowColor: "#003D35",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  welcomeButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },

  header: {
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: cardBorder,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 14,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  backButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#F2F4F7",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  backButtonText: {
    fontSize: 34,
    color: "#5B677A",
    lineHeight: 36,
    marginTop: -2,
  },
  headerTextBlock: {
    flex: 1,
  },
  stepText: {
    color: teal,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  headerTitle: {
    color: darkText,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "900",
  },
  shieldButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: teal,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  shieldText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },

  progressWrapper: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  progressItem: {
    flex: 1,
  },
  progressTopRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  progressCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: inactiveDot,
    alignItems: "center",
    justifyContent: "center",
  },
  progressCircleComplete: {
    backgroundColor: teal,
  },
  progressCircleActive: {
    backgroundColor: teal,
  },
  progressCircleText: {
    color: "#98A2B3",
    fontSize: 12,
    fontWeight: "900",
  },
  progressCircleTextActive: {
    color: "#FFFFFF",
  },
  progressConnector: {
    flex: 1,
    height: 2,
    backgroundColor: "#D8DCE3",
    marginHorizontal: 7,
  },
  progressConnectorActive: {
    backgroundColor: teal,
  },
  progressLabel: {
    color: "#8EA0BA",
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "800",
    marginTop: 6,
  },
  progressLabelActive: {
    color: teal,
  },

  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 118,
    backgroundColor: "#FFFFFF",
  },
  callout: {
    backgroundColor: tealSoft,
    borderWidth: 1,
    borderColor: "#B8F3EA",
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 17,
    marginBottom: 24,
  },
  calloutText: {
    color: "#00786C",
    fontSize: 16,
    lineHeight: 24,
  },

  fieldBlock: {
    marginBottom: 22,
  },
  fieldLabel: {
    color: "#536789",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 9,
  },
  input: {
    borderWidth: 1,
    borderColor: cardBorder,
    backgroundColor: "#FFFFFF",
    borderRadius: 17,
    minHeight: 58,
    paddingHorizontal: 18,
    paddingVertical: 15,
    color: darkText,
    fontSize: 16,
    lineHeight: 22,
  },
  largeInput: {
    minHeight: 112,
  },
  helperText: {
    color: helperText,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 7,
  },

  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    minHeight: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: cardBorder,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  chipSelected: {
    backgroundColor: teal,
    borderColor: teal,
  },
  chipText: {
    color: darkText,
    fontSize: 14,
    fontWeight: "800",
  },
  chipTextSelected: {
    color: "#FFFFFF",
  },

  noteBox: {
    backgroundColor: "#FFF8E7",
    borderColor: "#FEDF89",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginTop: 2,
  },
  noteText: {
    color: "#92400E",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
  },

  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 16,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: cardBorder,
  },
  primaryButton: {
    backgroundColor: teal,
    borderRadius: 16,
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  primaryButtonArrow: {
    color: "#FFFFFF",
    fontSize: 24,
    lineHeight: 26,
    fontWeight: "800",
  },
});