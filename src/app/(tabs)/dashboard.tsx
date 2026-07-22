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
import { usePendingReviews } from "@/hooks/usePendingReviews";
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
  // planning/41 §4 + §11: rehab reminder only when a therapy contract is
  // present. Use the snapshot's `therapyContractPresent` flag (set by the
  // ADCP spine) as the single source of truth so the Dashboard + Care tab
  // agree on the same presence signal.
  const therapyContractPresent = Boolean(
    snapshot?.therapyContractPresent ||
      (snapshot?.carePlan &&
        ((snapshot.carePlan.activities?.length ?? 0) > 0 ||
          (snapshot.rehabPlanMetrics?.length ?? 0) > 0)),
  );
  const showRehabReminder =
    therapyContractPresent && snapshot?.todayDailyCareEntry?.therapyCompleted !== true;
  const topUc4Priority = snapshot?.latestUc4PriorityCards?.[0] ?? null;
  const uc3Result = snapshot?.latestUc3TrajectoryResult ?? null;
  const pendingReviews = usePendingReviews(patientId);
  const showUc3Status =
    Boolean(uc3Result) && uc3Result?.eventType !== "NO_TRAJECTORY_FAILURE";
  const showTodayCare =
    Boolean(topUc4Priority) ||
    showRehabReminder ||
    showUc3Status ||
    pendingReviews.total > 0;

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
          {showTodayCare ? (
            <View style={styles.todayCareSection}>
              <Text style={styles.sectionTitle}>{"Today\u2019s care"}</Text>
              <View style={styles.todayCareList}>
                {topUc4Priority ? (
                  <CareFocusCompactCard
                    title={topUc4Priority.title}
                    detail={`Priority ${Math.round(topUc4Priority.score * 100)}%`}
                  />
                ) : null}
                {showRehabReminder ? <RehabReminderCard /> : null}
                {showUc3Status && uc3Result ? (
                  <Uc3HomeStatusCard
                    eventType={uc3Result.eventType}
                    urgent={uc3Result.emergencyThresholdBreach || uc3Result.severity === "urgent"}
                  />
                ) : null}
                {pendingReviews.total > 0 ? (
                  <NeedsYourReviewBanner
                    patientId={patientId}
                    reviews={pendingReviews}
                    onReviewPress={scrollToAlertsLog}
                  />
                ) : null}
              </View>
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

function CareFocusCompactCard({ title, detail }: { title: string; detail: string }) {
  return (
    <Pressable
      style={styles.compactCard}
      onPress={() => router.push("/care")}
      accessibilityRole="button"
      accessibilityLabel="Open care focus checklist"
    >
      <View style={styles.compactIcon}>
        <AppIcon name="heart" size={24} color={AppTheme.colors.warning} />
      </View>
      <View style={styles.compactBody}>
        <Text style={styles.compactKicker}>Care focus</Text>
        <Text style={styles.compactTitle} numberOfLines={2}>{title}</Text>
        <Text style={styles.compactMeta}>{detail}</Text>
      </View>
      <AppIcon name="chevronRight" size={24} color={AppTheme.colors.textMuted} />
    </Pressable>
  );
}

function Uc3HomeStatusCard({ eventType, urgent }: { eventType: string; urgent: boolean }) {
  return (
    <Pressable
      style={[styles.compactCard, urgent && styles.compactCardUrgent]}
      onPress={() => router.push("/care")}
      accessibilityRole="button"
      accessibilityLabel="Open rehabilitation progress result"
    >
      <View style={styles.compactIcon}>
        <AppIcon name={urgent ? "alert" : "walking"} size={24} color={urgent ? AppTheme.colors.danger : AppTheme.colors.brand} />
      </View>
      <View style={styles.compactBody}>
        <Text style={styles.compactKicker}>Rehabilitation progress</Text>
        <Text style={styles.compactTitle} numberOfLines={2}>
          {urgent ? "Urgent safety concern" : "Progress review available"}
        </Text>
        <Text style={styles.compactMeta}>{eventType.replace(/_/g, " ").toLowerCase()}</Text>
      </View>
      <AppIcon name="chevronRight" size={24} color={AppTheme.colors.textMuted} />
    </Pressable>
  );
}

function RehabReminderCard() {
  return (
    <Pressable
      style={styles.compactCard}
      onPress={() =>
        router.push({
          pathname: "/care",
          params: { focus: "rehab-check-in" },
        } as never)
      }
      accessibilityRole="button"
      accessibilityLabel="Open today's rehab check-in"
    >
      <View style={styles.compactIcon}>
        <AppIcon name="walking" size={24} color={AppTheme.colors.brand} />
      </View>
      <View style={styles.compactBody}>
        <Text style={styles.compactKicker}>{"Today\u2019s rehab check-in"}</Text>
        <Text style={styles.compactTitle} numberOfLines={2}>
          Therapy has not been completed today.
        </Text>
        <Text style={styles.compactMeta}>Open check-in</Text>
      </View>
      <AppIcon name="chevronRight" size={24} color={AppTheme.colors.textMuted} />
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
  todayCareSection: {
    marginBottom: 14,
  },
  todayCareList: {
    gap: 10,
  },
  compactCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 14,
    ...AppTheme.shadow,
  },
  compactCardUrgent: {
    borderColor: AppTheme.colors.danger,
    backgroundColor: "#FEF2F2",
  },
  compactIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: AppTheme.colors.softSurface,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  compactBody: {
    flex: 1,
    minWidth: 0,
  },
  compactKicker: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  compactTitle: {
    color: AppTheme.colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    marginTop: 2,
  },
  compactMeta: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 3,
  },
});
