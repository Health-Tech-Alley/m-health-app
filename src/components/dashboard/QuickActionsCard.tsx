/**
 * Displays quick caregiver actions on the home dashboard.
 *
 * Gives the caregiver fast access to common actions such as adding a note,
 * contacting the provider, or reviewing the care timeline.
 */

import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useActivePatientView } from "@/hooks/useActivePatientView";
import { getPatientDisplayName } from "@/utils/patientDisplay";
import { getOnboardingProfile } from "../../services/onboarding/onboardingService";

const teal = "#008573";
const darkText = "#102033";
const mutedText = "#667085";
const cardBorder = "#E4E7EC";

export function QuickActionsCard() {
  const router = useRouter();
  const profile = getOnboardingProfile();
  const activePatient = useActivePatientView();
  const patientName = getPatientDisplayName(activePatient);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Quick Actions</Text>
      <Text style={styles.subtitle}>
        Common caregiver actions for {patientName}.
      </Text>

      <Pressable style={styles.actionButton} onPress={() => router.push("/care")}>
        <Text style={styles.actionTitle}>Add Care Note</Text>
        <Text style={styles.actionDescription}>
          Record a caregiver observation or action.
        </Text>
      </Pressable>

      <Pressable style={styles.actionButton} onPress={() => router.push("/care")}>
        <Text style={styles.actionTitle}>Contact Provider</Text>
        <Text style={styles.actionDescription}>
          View contact info for {profile.primaryCareProvider.name}.
        </Text>
      </Pressable>

      <Pressable style={styles.actionButton} onPress={() => router.push("/care")}>
        <Text style={styles.actionTitle}>View Care Timeline</Text>
        <Text style={styles.actionDescription}>
          Review recent alerts, notes, and caregiver actions.
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: cardBorder,
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: darkText,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: mutedText,
    lineHeight: 20,
    marginBottom: 14,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: cardBorder,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    backgroundColor: "#F7FAF9",
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: teal,
    marginBottom: 4,
  },
  actionDescription: {
    fontSize: 13,
    color: mutedText,
    lineHeight: 18,
  },
});
