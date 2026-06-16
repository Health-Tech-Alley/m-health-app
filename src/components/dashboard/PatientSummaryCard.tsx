import { StyleSheet, Text, View } from "react-native";

import { AppTheme } from "@/constants/theme";
import { getOnboardingProfile } from "@/services/onboarding/onboardingService";

export function PatientSummaryCard() {
  const profile = getOnboardingProfile();

  const patient = profile.patient;
  const caregiver = profile.caregiver;
  const provider = profile.primaryCareProvider;
  const initials = getInitials(patient.name);

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>

        <View style={styles.infoBlock}>
          <Text style={styles.patientName}>{patient.name}</Text>
          <Text style={styles.detail}>
            Age {patient.age} · PCP: {provider.name}
          </Text>
        </View>

        <View style={styles.alertBlock}>
          <View style={styles.alertRow}>
            <View style={styles.alertDot} />
            <Text style={styles.alertText}>Alert</Text>
          </View>
          <Text style={styles.alertTime}>2 min ago</Text>
        </View>
      </View>

      <View style={styles.conditionRow}>
        {patient.conditions.split(",").map((condition) => (
          <Text key={condition.trim()} style={styles.conditionPill}>
            {condition.trim()}
          </Text>
        ))}
      </View>

      <View style={styles.divider} />

      <View style={styles.footer}>
        <Text style={styles.footerText}>⌁ Monitoring active</Text>
        <Text style={styles.footerText}>
          · Caregiver: {getFirstName(caregiver.name)} ({caregiver.relationship})
        </Text>
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

function getFirstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    padding: 24,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    ...AppTheme.shadow,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: AppTheme.colors.brandSoft,
    borderWidth: 2,
    borderColor: "#B7FFF1",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 18,
  },
  avatarText: {
    color: AppTheme.colors.brand,
    fontWeight: "900",
    fontSize: 20,
  },
  infoBlock: {
    flex: 1,
  },
  patientName: {
    color: AppTheme.colors.text,
    fontSize: 21,
    fontWeight: "900",
  },
  detail: {
    color: AppTheme.colors.textSoft,
    fontSize: 16,
    marginTop: 4,
  },
  alertBlock: {
    alignItems: "flex-end",
  },
  alertRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  alertDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#FF7B87",
  },
  alertText: {
    color: AppTheme.colors.danger,
    fontSize: 14,
    fontWeight: "900",
  },
  alertTime: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 10,
  },
  conditionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 24,
  },
  conditionPill: {
    backgroundColor: AppTheme.colors.chip,
    color: AppTheme.colors.textSoft,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: AppTheme.radius.pill,
    fontSize: 14,
    fontWeight: "800",
  },
  divider: {
    height: 1,
    backgroundColor: AppTheme.colors.border,
    marginTop: 20,
    marginBottom: 16,
  },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  footerText: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
  },
});