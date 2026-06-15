/**
 * Main caregiver home dashboard screen.
 *
 * Shows patient context first, then links to the core caregiver flows:
 * medications, care alerts, scheduling, assistant support, and performance.
 */

import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useSLM } from "@/contexts/slm-context";
import { MODEL_CATALOG } from "@/inference/model-catalog";
import { isModelInstalled } from "@/services/model-storage";

import { MainFeatureCard } from "./MainFeatureCard";
import { PatientSummaryCard } from "./PatientSummaryCard";
import { QuickActionsCard } from "./QuickActionsCard";
import { RecentActivityCard } from "./RecentActivityCard";

const teal = "#008573";
const darkText = "#102033";
const mutedText = "#667085";
const lightBackground = "#F7FAF9";
const cardBorder = "#E4E7EC";

export function CaregiverDashboardScreen() {
  const router = useRouter();
  const { loadStatus: slmStatus } = useSLM();

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>CC</Text>
        </View>

        <View style={styles.headerTextContainer}>
          <Text style={styles.appName}>Caregiver Concierge</Text>
          <Text style={styles.brandName}>ACCESS-DP</Text>
          <Text style={styles.subtitle}>Caregiver Home Dashboard</Text>
        </View>
      </View>

      <PatientSummaryCard />

      <Text style={styles.sectionTitle}>Main Features</Text>

      <MainFeatureCard
        title="Medication Management"
        subtitle="Track medication reminders, missed doses, and caregiver confirmations."
        status="Next medication: Albuterol due at 8:00 PM"
        buttonLabel="View Medications"
        onPress={() => router.push("/medications")}
      />

      <MainFeatureCard
        title="Care Management"
        subtitle="Monitor urgent alerts, caregiver actions, notes, and care timeline events."
        status="Red Breath Alert active for Elena"
        buttonLabel="View Care"
        onPress={() => router.push("/care")}
      />

      <MainFeatureCard
        title="Scheduling Management"
        subtitle="Manage appointments, follow-ups, care tasks, and provider visits."
        status="Pulmonology follow-up tomorrow at 10:00 AM"
        buttonLabel="View Schedule"
        onPress={() => router.push("/schedule")}
      />

      <Text style={styles.sectionTitle}>AI & Insights</Text>

      <MainFeatureCard
        title="Models"
        subtitle="Download and manage on-device AI models."
        status={`${MODEL_CATALOG.filter(isModelInstalled).length} of ${MODEL_CATALOG.length} installed`}
        buttonLabel="Manage Models"
        onPress={() => router.push("/models")}
      />

      <MainFeatureCard
        title="SLM Prompt"
        subtitle="Ask the caregiver assistant using the patient profile and on-device SLM."
        status={
          slmStatus === "ready"
            ? "Native model ready"
            : "Mock / native SLM chat"
        }
        buttonLabel="Open SLM Prompt"
        onPress={() => router.push("/slm")}
      />

      <MainFeatureCard
        title="Care Management"
        subtitle="Run anomaly detection on vitals and explain results with the SLM."
        status="ML model loaded with mock scenarios"
        buttonLabel="Open Care Management"
        onPress={() => router.push("/care-management")}
      />

      <Text style={styles.sectionTitle}>Prototype Tools</Text>

      <MainFeatureCard
        title="RAM / Performance Check"
        subtitle="Track mobile resource constraints such as memory, latency, and device limits."
        status="Mock performance screen for simulator testing"
        buttonLabel="Open Performance"
        onPress={() => router.push("/performance")}
      />

      <RecentActivityCard />

      <QuickActionsCard />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    padding: 18,
    paddingBottom: 32,
    backgroundColor: lightBackground,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 22,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: cardBorder,
    padding: 18,
  },
  logoCircle: {
    width: 56,
    height: 56,
    borderRadius: 20,
    backgroundColor: teal,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  headerTextContainer: {
    flex: 1,
  },
  appName: {
    fontSize: 22,
    fontWeight: "800",
    color: darkText,
  },
  brandName: {
    fontSize: 14,
    fontWeight: "800",
    color: teal,
    letterSpacing: 1,
    marginTop: 2,
  },
  subtitle: {
    fontSize: 15,
    marginTop: 6,
    color: mutedText,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 22,
    marginBottom: 12,
    color: mutedText,
  },
});