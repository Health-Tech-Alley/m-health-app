import { router } from "expo-router";
import { useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "@/components/AppIcon";
import { MainTabHeader } from "@/components/MainTabHeader";
import { AlertsLogCard } from "@/components/dashboard/AlertsLogCard";
import { NeedsYourReviewBanner } from "@/components/dashboard/NeedsYourReviewBanner";
import { PatientSummaryCard } from "@/components/dashboard/PatientSummaryCard";
import { WeeklyVitalsCard } from "@/components/dashboard/WeeklyVitalsCard";
import { AppTheme } from "@/constants/theme";
import { timeOfDayGreeting } from "@/constants/user-terms";
import { useOrchestratorPatientId } from "@/contexts/orchestrator-context";
import { usePatientRecord } from "@/contexts/patient-record-context";
import { useActivePatientView } from "@/hooks/useActivePatientView";
import {
  getCaregiverDisplay,
  getPatientDisplayName,
} from "@/utils/patientDisplay";

export default function DashboardRoute() {
  const activePatient = useActivePatientView();
  const patientId = useOrchestratorPatientId();
  const { snapshot } = usePatientRecord();
  const scrollRef = useRef<ScrollView | null>(null);
  const [alertsLogY, setAlertsLogY] = useState(0);

  const caregiverFirstName = getFirstName(getCaregiverDisplay(activePatient));
  const patientFirstName = getFirstName(getPatientDisplayName(activePatient));
  const greeting = `${timeOfDayGreeting()}, ${caregiverFirstName}`;
  const hasDocumentedRehabPlan = Boolean(
    snapshot?.carePlan &&
      ((snapshot.carePlan.activities?.length ?? 0) > 0 ||
        (snapshot.rehabPlanMetrics?.length ?? 0) > 0),
  );
  const showRehabReminder =
    hasDocumentedRehabPlan && snapshot?.todayDailyCareEntry?.therapyCompleted !== true;

  const scrollToAlertsLog = () => {
    scrollRef.current?.scrollTo({
      y: Math.max(alertsLogY - 16, 0),
      animated: true,
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.root}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <MainTabHeader
            title="Caregiver Concierge"
            eyebrow="ACCESS-DP"
            subtitle={`${greeting}. Here's ${patientFirstName}'s status.`}
            logoSource={require("@/assets/images/hta-logo.png")}
            rightContent={
              <Pressable
                style={styles.bellButton}
                onPress={scrollToAlertsLog}
                accessibilityRole="button"
                accessibilityLabel="View alerts"
              >
                <AppIcon
                  name="bell"
                  size={25}
                  color={AppTheme.colors.textMuted}
                />
                <View style={styles.bellDot} />
              </Pressable>
            }
          />

          <PatientSummaryCard />
          <WeeklyVitalsCard />
          <NeedsYourReviewBanner
            patientId={patientId}
            onReviewPress={scrollToAlertsLog}
          />
          {showRehabReminder ? (
            <View>
              <Text style={styles.sectionTitle}>{"Today\u2019s care"}</Text>
              <RehabReminderCard />
            </View>
          ) : null}

          <View
            onLayout={(event) => {
              setAlertsLogY(event.nativeEvent.layout.y);
            }}
          >
            <Text style={styles.sectionTitle}>Alerts Log</Text>
            <AlertsLogCard />
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function RehabReminderCard() {
  return (
    <Pressable
      style={styles.rehabCard}
      onPress={() =>
        router.push({
          pathname: "/care",
          params: { focus: "rehab-check-in" },
        } as never)
      }
      accessibilityRole="button"
      accessibilityLabel="Open today's rehab check-in"
    >
      <View style={styles.rehabCardHeader}>
        <View>
          <Text style={styles.rehabKicker}>{"Today\u2019s rehab check-in"}</Text>
          <Text style={styles.rehabStatus}>
            Therapy has not been completed today.
          </Text>
        </View>
        <View style={styles.rehabIcon}>
          <AppIcon name="walking" size={24} color={AppTheme.colors.brand} />
        </View>
      </View>
      <Text style={styles.rehabActionText}>Open check-in</Text>
    </Pressable>
  );
}

function getFirstName(name: string): string {
  const firstName = name.trim().split(/\s+/)[0];
  return firstName || name;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
  },
  root: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 124,
  },
  bellButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: AppTheme.colors.softSurface,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  bellDot: {
    position: "absolute",
    right: 14,
    top: 12,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: AppTheme.colors.danger,
  },
  greeting: {
    marginTop: 18,
    color: AppTheme.colors.textSoft,
    fontSize: 18,
    lineHeight: 25,
  },
  sectionTitle: {
    marginTop: 24,
    marginBottom: 12,
    color: AppTheme.colors.sectionText,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  rehabCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 18,
    ...AppTheme.shadow,
  },
  rehabCardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  rehabKicker: {
    color: AppTheme.colors.sectionText,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  rehabStatus: {
    color: AppTheme.colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    marginTop: 6,
  },
  rehabActionText: {
    color: AppTheme.colors.brand,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "900",
    marginTop: 14,
  },
  rehabIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
});
