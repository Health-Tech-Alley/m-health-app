/**
 * Displays recent caregiver activity on the dashboard.
 *
 * Shows a simple mock activity timeline using the current onboarding profile.
 * Later, this can connect to local timeline, audit log, SQLite, or SQLCipher records.
 */

import { StyleSheet, Text, View } from "react-native";

import { getOnboardingProfile } from "../../services/onboarding/onboardingService";

const teal = "#008573";
const darkText = "#102033";
const mutedText = "#667085";
const cardBorder = "#E4E7EC";

export function RecentActivityCard() {
  const profile = getOnboardingProfile();

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Recent Activity</Text>
      <Text style={styles.subtitle}>
        Latest caregiver and care events for {profile.patient.name}.
      </Text>

      <ActivityItem text={`Care alert created for ${profile.patient.name}`} />
      <ActivityItem
        text={`${profile.caregiver.name} reviewed the patient summary`}
      />
      <ActivityItem text="Action saved to local timeline placeholder" />
    </View>
  );
}

function ActivityItem({ text }: { text: string }) {
  return (
    <View style={styles.activityRow}>
      <View style={styles.dot} />
      <Text style={styles.activityText}>{text}</Text>
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
    marginTop: 8,
    marginBottom: 12,
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
  activityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: teal,
    marginTop: 6,
  },
  activityText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: darkText,
  },
});