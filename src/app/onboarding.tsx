/**
 * First-time caregiver onboarding screen.
 *
 * Collects caregiver, patient, provider, preferences, and safety information.
 * Saves the profile through onboardingService before opening the dashboard.
 */

import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

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
const darkText = "#102033";
const mutedText = "#667085";
const lightBackground = "#F7FAF9";
const cardBorder = "#E4E7EC";

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
    "Cooking, evening walks"
  );
  const [mainConcern, setMainConcern] = useState("Breathing episodes");
  const [stressOrSupportNeeds, setStressOrSupportNeeds] = useState(
    "Family check-ins help"
  );
  const [backupCaregiver, setBackupCaregiver] = useState(
    "Maria Garcia · (555) 020-3040"
  );

  const [patientName, setPatientName] = useState("Elena Garcia");
  const [patientAge, setPatientAge] = useState("72");
  const [conditions, setConditions] = useState(
    "COPD, Traumatic Brain Injury"
  );
  const [baselineDailyRoutine, setBaselineDailyRoutine] = useState(
    "Wakes at 8am, naps at 2pm, quiet evenings"
  );
  const [currentMedications, setCurrentMedications] = useState(
    "Albuterol PRN, Tiotropium daily, Prednisone"
  );
  const [spo2Cutoff, setSpo2Cutoff] = useState("88%");
  const [baselineHeartRate, setBaselineHeartRate] = useState("72–88 BPM");

  const [providerName, setProviderName] = useState("Dr. Smith");
  const [providerPhone, setProviderPhone] = useState("(555) 800-1234");
  const [providerEmail, setProviderEmail] = useState("dr.smith@clinic.org");
  const [emergencyContact, setEmergencyContact] = useState(
    "Maria Garcia · (555) 020-3040"
  );
  const [safetyNotes, setSafetyNotes] = useState(
    "Allergic to penicillin. Falls risk."
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

    router.replace("/(tabs)/dashboard");
  }

  function handleBack() {
    if (step === 0) return;
    setStep(step - 1);
  }

  return (
    <View style={styles.root}>
      {step === 0 ? (
        <WelcomeStep onNext={handleNext} />
      ) : (
        <>
          <View style={styles.header}>
            <Pressable style={styles.backButton} onPress={handleBack}>
              <Text style={styles.backButtonText}>‹</Text>
            </Pressable>

            <View style={styles.headerTextBlock}>
              <Text style={styles.stepText}>Step {step} of 4</Text>
              <Text style={styles.headerTitle}>
                {step === 1 && "About You"}
                {step === 2 && "Your Caregiving"}
                {step === 3 && "About Patient"}
                {step === 4 && "Safety & Providers"}
              </Text>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            {step === 1 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Caregiver information</Text>
                <Text style={styles.cardDescription}>
                  Tell us who is providing care and how you prefer to be reached.
                </Text>

                <Field
                  label="Your Name"
                  value={caregiverName}
                  onChangeText={setCaregiverName}
                />

                <Field
                  label="Your Relationship to Patient"
                  value={relationship}
                  onChangeText={setRelationship}
                />

                <Field
                  label="Your Phone Number"
                  value={caregiverPhone}
                  onChangeText={setCaregiverPhone}
                />

                <Field
                  label="Caregiving Experience"
                  value={experience}
                  onChangeText={(value) =>
                    setExperience(value as CaregivingExperience)
                  }
                  helper="Example: First time, Some experience, Experienced, Medical background"
                />

                <Field
                  label="Your Typical Availability"
                  value={availability}
                  onChangeText={(value) =>
                    setAvailability(value as Availability)
                  }
                  helper="Example: Full time, Mornings, Evenings & weekends, On-call only"
                />

                <Field
                  label="Preferred Notification Style"
                  value={notificationStyle}
                  onChangeText={(value) =>
                    setNotificationStyle(value as NotificationStyle)
                  }
                  helper="Example: Push + sound, Vibrate only, Push only, Text message"
                />

                <Field
                  label="Language Preference"
                  value={languagePreference}
                  onChangeText={(value) =>
                    setLanguagePreference(value as LanguagePreference)
                  }
                  helper="Example: English, Español, English + Español, Other"
                />
              </View>
            )}

            {step === 2 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Caregiving preferences</Text>
                <Text style={styles.cardDescription}>
                  These answers help the app explain alerts and support you at
                  the right level.
                </Text>

                <Field
                  label="Comfort With Medical Information"
                  value={medicalComfortLevel}
                  onChangeText={(value) =>
                    setMedicalComfortLevel(value as MedicalComfortLevel)
                  }
                  helper="Example: Keep it simple, Moderate detail, Full clinical detail"
                />

                <Field
                  label="Emergency Comfort Level"
                  value={emergencyComfortLevel}
                  onChangeText={(value) =>
                    setEmergencyComfortLevel(value as EmergencyComfortLevel)
                  }
                  helper="Example: Would call 911 if needed, Prefer provider first, Not sure — guide me"
                />

                <LargeField
                  label="Your Hobbies or Daily Routines"
                  value={hobbiesOrRoutines}
                  onChangeText={setHobbiesOrRoutines}
                  helper="Optional. Helps avoid scheduling conflicts."
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
                  helper="Optional. Helps surface appropriate support resources."
                />

                <Field
                  label="Backup Caregiver or Family Support"
                  value={backupCaregiver}
                  onChangeText={setBackupCaregiver}
                  helper="Who else can be contacted if you are unavailable?"
                />
              </View>
            )}

            {step === 3 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Patient information</Text>
                <Text style={styles.cardDescription}>
                  This gives the dashboard patient context for alerts,
                  medication, scheduling, and care summaries.
                </Text>

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
                  helper="Helps detect when the patient's pattern changes."
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
              </View>
            )}

            {step === 4 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Provider and safety details</Text>
                <Text style={styles.cardDescription}>
                  These details are shown when the caregiver needs contact or
                  safety context.
                </Text>

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
                  helper="A person to surface if the caregiver cannot be reached."
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
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.primaryButton} onPress={handleNext}>
              <Text style={styles.primaryButtonText}>
                {step === 4 ? "Go to Dashboard" : "Continue"}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <View style={styles.welcomeRoot}>
      <View style={styles.logoCircle}>
        <Text style={styles.logoText}>CC</Text>
      </View>

      <Text style={styles.welcomeTitle}>Caregiver Concierge</Text>
      <Text style={styles.welcomeBrand}>ACCESS-DP</Text>

      <Text style={styles.welcomeSubtitle}>
        Set up the caregiver, patient, provider, and safety information.
      </Text>

      <Pressable style={styles.welcomeButton} onPress={onNext}>
        <Text style={styles.welcomeButtonText}>Start Onboarding</Text>
      </Pressable>
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
      />
      {helper ? <Text style={styles.helperText}>{helper}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: lightBackground,
  },
  welcomeRoot: {
    flex: 1,
    backgroundColor: lightBackground,
    padding: 28,
    justifyContent: "center",
  },
  logoCircle: {
    width: 84,
    height: 84,
    borderRadius: 28,
    backgroundColor: teal,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  logoText: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
  },
  welcomeTitle: {
    fontSize: 36,
    fontWeight: "800",
    color: darkText,
    marginBottom: 4,
  },
  welcomeBrand: {
    color: teal,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 18,
  },
  welcomeSubtitle: {
    fontSize: 18,
    lineHeight: 28,
    color: mutedText,
    marginBottom: 28,
  },
  welcomeButton: {
    backgroundColor: teal,
    borderRadius: 18,
    padding: 18,
    alignItems: "center",
  },
  welcomeButtonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  header: {
    paddingTop: 54,
    paddingHorizontal: 22,
    paddingBottom: 18,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: cardBorder,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#F2F4F7",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  backButtonText: {
    fontSize: 34,
    color: darkText,
    marginTop: -4,
  },
  headerTextBlock: {
    flex: 1,
  },
  stepText: {
    color: teal,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  headerTitle: {
    color: darkText,
    fontSize: 24,
    fontWeight: "800",
  },
  progressContainer: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 16,
    backgroundColor: "#FFFFFF",
  },
  progressSegment: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#EAECF0",
  },
  progressSegmentActive: {
    backgroundColor: teal,
  },
  content: {
    padding: 22,
    paddingBottom: 120,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: cardBorder,
  },
  cardTitle: {
    color: darkText,
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 8,
  },
  cardDescription: {
    color: mutedText,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
  },
  fieldBlock: {
    marginBottom: 22,
  },
  fieldLabel: {
    color: darkText,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: cardBorder,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: darkText,
    fontSize: 17,
  },
  largeInput: {
    minHeight: 110,
  },
  helperText: {
    color: "#8EA0BA",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  noteBox: {
    backgroundColor: "#FFF8E7",
    borderColor: "#FEDF89",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
  },
  noteText: {
    color: "#92400E",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: cardBorder,
  },
  primaryButton: {
    backgroundColor: teal,
    borderRadius: 18,
    padding: 18,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
});