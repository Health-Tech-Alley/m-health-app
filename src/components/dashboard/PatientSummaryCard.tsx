/**
 * Displays the patient summary card for the caregiver home dashboard.
 *
 * Reads caregiver and patient context from onboardingService.
 * Later, this can connect to Rahal's patient/profile data layer.
 */

import { StyleSheet, Text, View } from "react-native";

import { getOnboardingProfile } from "../../services/onboarding/onboardingService";

const teal = "#008573";
const darkText = "#102033";
const mutedText = "#667085";
const cardBorder = "#E4E7EC";
const danger = "#EF4444";

export function PatientSummaryCard() {
  const profile = getOnboardingProfile();

  const patient = profile.patient;
  const caregiver = profile.caregiver;
  const provider = profile.primaryCareProvider;

  const initials = getInitials(patient.name);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.headerText}>Patient Summary</Text>

        <View style={styles.alertBadge}>
          <View style={styles.alertDot} />
          <Text style={styles.alertText}>Alert Active</Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>

        <View style={styles.patientInfo}>
          <Text style={styles.patientName}>{patient.name}</Text>
          <Text style={styles.detail}>
            Age {patient.age} · PCP: {provider.name}
          </Text>
          <Text style={styles.detail}>
            Caregiver: {caregiver.name} ({caregiver.relationship})
          </Text>

          <View style={styles.conditionRow}>
            {patient.conditions.split(",").map((condition) => (
              <Text key={condition.trim()} style={styles.conditionPill}>
                {condition.trim()}
              </Text>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.footer}>
        <Text style={styles.footerText}>Monitoring active</Text>
        <Text style={styles.footerText}>Updated 2 min ago</Text>
      </View>
    </View>
  );
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    overflow: "hidden",
    marginBottom: 18,
    borderWidth: 1,
    borderColor: cardBorder,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardHeader: {
    backgroundColor: teal,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  alertBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  alertDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: danger,
  },
  alertText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  body: {
    flexDirection: "row",
    padding: 16,
    gap: 12,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#EAFBF7",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: teal,
    fontWeight: "800",
    fontSize: 17,
  },
  patientInfo: {
    flex: 1,
  },
  patientName: {
    fontSize: 20,
    fontWeight: "800",
    color: darkText,
  },
  detail: {
    color: mutedText,
    fontSize: 14,
    marginTop: 3,
  },
  conditionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  conditionPill: {
    backgroundColor: "#F2F4F7",
    color: "#344054",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "700",
  },
  divider: {
    height: 1,
    backgroundColor: cardBorder,
    marginHorizontal: 16,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
  },
  footerText: {
    color: mutedText,
    fontSize: 13,
  },
});