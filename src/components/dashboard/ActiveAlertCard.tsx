import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import { getOnboardingProfile } from "@/services/onboarding/onboardingService";

export function ActiveAlertCard() {
  const router = useRouter();
  const profile = getOnboardingProfile();
  const patientFirstName =
    profile.patient.name.trim().split(/\s+/)[0] || "patient";

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.alertIconCircle}>
          <AppIcon name="alert" size={28} color={AppTheme.colors.white} />
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.eyebrow}>Active Alert</Text>
          <Text style={styles.title}>Red Breath Alert</Text>
          <Text style={styles.subtitle}>Severity 3 · Respiratory · Just now</Text>
        </View>

        <View style={styles.urgentPill}>
          <Text style={styles.urgentText}>Urgent</Text>
        </View>
      </View>

      <View style={styles.metricRow}>
        <MetricBox label="SpO₂" value="84%" />
        <MetricBox label="HR" value="118 BPM" />
        <MetricBox label="RR" value="32/min" />
      </View>

      <Text style={styles.bodyText}>
        {profile.patient.name}&apos;s oxygen is below her safe threshold. She
        hasn&apos;t moved in 25 min.{" "}
        <Text style={styles.boldText}>
          You decide — the app never acts for you.
        </Text>
      </Text>

      <View style={styles.primaryActions}>
        <Pressable style={styles.callButton}>
          <Text style={styles.callButtonText}>Call 911</Text>
        </Pressable>

        <Pressable
          style={styles.checkButton}
          onPress={() => router.push("/(tabs)/care")}
        >
          <Text style={styles.checkButtonText}>Check on {patientFirstName}</Text>
        </Pressable>
      </View>

      <View style={styles.secondaryActions}>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.push("/(tabs)/care")}
        >
          <Text style={styles.secondaryButtonText}>Contact Provider</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.push("/(tabs)/care")}
        >
          <Text style={styles.secondaryButtonText}>Acknowledge</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.push("/(tabs)/care")}
        >
          <Text style={styles.secondaryButtonText}>Add Note</Text>
        </Pressable>
      </View>

      <Pressable onPress={() => router.push("/(tabs)/care")}>
        <Text style={styles.footerLink}>Dismiss from home · View full alert →</Text>
      </Pressable>
    </View>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.danger,
    borderRadius: AppTheme.radius.card,
    padding: 22,
    marginBottom: 24,
    shadowColor: "#900",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  alertIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  titleBlock: {
    flex: 1,
  },
  eyebrow: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  title: {
    color: AppTheme.colors.white,
    fontSize: 21,
    fontWeight: "900",
  },
  subtitle: {
    color: AppTheme.colors.white,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 4,
  },
  urgentPill: {
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  urgentText: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  metricRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 26,
  },
  metricBox: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.16)",
    paddingVertical: 13,
    alignItems: "center",
  },
  metricLabel: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: "700",
  },
  metricValue: {
    color: AppTheme.colors.white,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 4,
  },
  bodyText: {
    color: AppTheme.colors.white,
    fontSize: 16,
    lineHeight: 27,
    marginTop: 22,
  },
  boldText: {
    fontWeight: "900",
  },
  primaryActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  callButton: {
    flex: 1,
    backgroundColor: AppTheme.colors.white,
    borderRadius: 18,
    paddingVertical: 17,
    alignItems: "center",
  },
  callButtonText: {
    color: AppTheme.colors.danger,
    fontSize: 17,
    fontWeight: "900",
  },
  checkButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 18,
    paddingVertical: 17,
    alignItems: "center",
  },
  checkButtonText: {
    color: AppTheme.colors.white,
    fontSize: 17,
    fontWeight: "900",
  },
  secondaryActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 74,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.32)",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  secondaryButtonText: {
    color: AppTheme.colors.white,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  footerLink: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: "900",
    textDecorationLine: "underline",
    textAlign: "center",
    marginTop: 20,
  },
});