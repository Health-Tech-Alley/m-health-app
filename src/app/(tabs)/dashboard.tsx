import { router } from "expo-router";
import { useMemo, useRef, useState } from "react";
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
import { useOrchestratorPatientId } from "@/contexts/orchestrator-context";
import { usePatientRecord } from "@/contexts/patient-record-context";
import { useActivePatientView } from "@/hooks/useActivePatientView";
import { usePendingReviews } from "@/hooks/usePendingReviews";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/localization/i18n";
import {
  formatPossessive,
  getCaregiverDisplay,
  getFirstName,
  getPatientDisplayName,
} from "@/utils/patientDisplay";

export default function DashboardRoute() {
  const theme = useTheme();
  const { locale, t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const activePatient = useActivePatientView();
  const patientId = useOrchestratorPatientId();
  const { snapshot } = usePatientRecord();
  const scrollRef = useRef<ScrollView | null>(null);
  const [alertsLogY, setAlertsLogY] = useState(0);

  const caregiverFirstName = getFirstName(getCaregiverDisplay(activePatient));
  const patientFirstName = getFirstName(getPatientDisplayName(activePatient));
  const greeting = t(getDashboardGreetingKey(), { name: caregiverFirstName });
  const patientStatusOwner = formatPossessive(patientFirstName);
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
  const showCareReviews = pendingReviews.careReviewTotal > 0;
  const showUc3Status =
    Boolean(uc3Result) && uc3Result?.eventType !== "NO_TRAJECTORY_FAILURE";
  const showTodayCare =
    Boolean(topUc4Priority) ||
    showRehabReminder ||
    showUc3Status ||
    showCareReviews;

  const scrollToAlertsLog = () => {
    scrollRef.current?.scrollTo({
      y: Math.max(alertsLogY - 16, 0),
      animated: true,
    });
  };

  return (
    <SafeAreaView style={[styles.safeArea, themedStyles.screen]} edges={["top"]}>
      <View style={[styles.root, themedStyles.screen]}>
        <ScrollView
          ref={scrollRef}
          style={themedStyles.screen}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, themedStyles.content]}
        >
          <MainTabHeader
            title={t("dashboard.header.title")}
            brandText="ACCESS-DP"
            brandSubtitle={t("common.productTagline")}
            subtitle={`${greeting}. ${t("dashboard.header.subtitle", {
              patientName: patientFirstName,
              patientStatusOwner,
            })}`}
            logoSource={require("@/assets/images/access-dp-adaptive-foreground.png")}
            rightContent={
              <>
                <Pressable
                  style={[styles.bellButton, themedStyles.iconButton]}
                  onPress={scrollToAlertsLog}
                  accessibilityRole="button"
                  accessibilityLabel={t("dashboard.action.viewAlerts")}
                >
                  <AppIcon
                    name="bell"
                    size={25}
                    color={theme.appTextMuted}
                  />
                  <View style={styles.bellDot} />
                </Pressable>
                <Pressable
                  style={[styles.gearButton, themedStyles.iconButton]}
                  onPress={() => router.push("/more" as never)}
                  accessibilityRole="button"
                  accessibilityLabel={t("dashboard.action.openMore")}
                >
                  <AppIcon
                    name="settings"
                    size={22}
                    color={theme.appTextMuted}
                  />
                </Pressable>
              </>
            }
          />

          <PatientSummaryCard />
          <WeeklyVitalsCard />
          <NeedsYourReviewBanner
            reviews={pendingReviews}
            variant="alerts"
          />
          {showTodayCare ? (
            <View style={styles.todayCareSection}>
              <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>{t("dashboard.section.todayCare")}</Text>
              <View style={styles.todayCareList}>
                {topUc4Priority ? (
                  <CareFocusCompactCard
                    title={topUc4Priority.title}
                    detail={t("dashboard.careFocus.priority", {
                      percent: Math.round(topUc4Priority.score * 100).toLocaleString(locale),
                    })}
                  />
                ) : null}
                {showRehabReminder ? <RehabReminderCard /> : null}
                {showUc3Status && uc3Result ? (
                  <Uc3HomeStatusCard
                    eventType={uc3Result.eventType}
                    urgent={uc3Result.emergencyThresholdBreach || uc3Result.severity === "urgent"}
                  />
                ) : null}
                {showCareReviews ? (
                  <NeedsYourReviewBanner
                    reviews={pendingReviews}
                    variant="care"
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
            <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>{t("dashboard.section.alertsLog")}</Text>
            <AlertsLogCard />
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function getDashboardGreetingKey(now: Date = new Date()): TranslationKey {
  const hour = now.getHours();
  if (hour < 5) return "dashboard.greeting.neutral";
  if (hour < 12) return "dashboard.greeting.morning";
  if (hour < 17) return "dashboard.greeting.afternoon";
  if (hour < 22) return "dashboard.greeting.evening";
  return "dashboard.greeting.neutral";
}

function CareFocusCompactCard({ title, detail }: { title: string; detail: string }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <Pressable
      style={[styles.compactCard, themedStyles.compactCard]}
      onPress={() => router.push("/care")}
      accessibilityRole="button"
      accessibilityLabel={t("dashboard.careFocus.open")}
    >
      <View style={[styles.compactIcon, themedStyles.compactIcon]}>
        <AppIcon name="heart" size={24} color={AppTheme.colors.warning} />
      </View>
      <View style={styles.compactBody}>
        <Text style={[styles.compactKicker, themedStyles.compactKicker]}>{t("dashboard.careFocus.kicker")}</Text>
        <Text style={[styles.compactTitle, themedStyles.compactTitle]} numberOfLines={2}>{title}</Text>
        <Text style={[styles.compactMeta, themedStyles.compactMeta]}>{detail}</Text>
      </View>
      <AppIcon name="chevronRight" size={24} color={theme.appTextMuted} />
    </Pressable>
  );
}

function Uc3HomeStatusCard({ eventType, urgent }: { eventType: string; urgent: boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const brandIconColor = theme.appBackground === "#000000" ? AppTheme.colors.brandPale : AppTheme.colors.brand;

  return (
    <Pressable
      style={[
        styles.compactCard,
        themedStyles.compactCard,
        urgent && styles.compactCardUrgent,
        urgent && themedStyles.compactCardUrgent,
      ]}
      onPress={() => router.push("/care")}
      accessibilityRole="button"
      accessibilityLabel={t("dashboard.rehab.openProgress")}
    >
      <View style={[styles.compactIcon, themedStyles.compactIcon]}>
        <AppIcon name={urgent ? "alert" : "walking"} size={24} color={urgent ? AppTheme.colors.danger : brandIconColor} />
      </View>
      <View style={styles.compactBody}>
        <Text style={[styles.compactKicker, themedStyles.compactKicker]}>{t("dashboard.rehab.progress")}</Text>
        <Text style={[styles.compactTitle, themedStyles.compactTitle]} numberOfLines={2}>
          {urgent ? t("dashboard.rehab.urgent") : t("dashboard.rehab.reviewAvailable")}
        </Text>
        <Text style={[styles.compactMeta, themedStyles.compactMeta]}>{eventType.replace(/_/g, " ").toLowerCase()}</Text>
      </View>
      <AppIcon name="chevronRight" size={24} color={theme.appTextMuted} />
    </Pressable>
  );
}

function RehabReminderCard() {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const brandIconColor = theme.appBackground === "#000000" ? AppTheme.colors.brandPale : AppTheme.colors.brand;

  return (
    <Pressable
      style={[styles.compactCard, themedStyles.compactCard]}
      onPress={() =>
        router.push({
          pathname: "/care",
          params: { focus: "rehab-check-in" },
        } as never)
      }
      accessibilityRole="button"
      accessibilityLabel={t("dashboard.rehab.openCheckIn")}
    >
      <View style={[styles.compactIcon, themedStyles.compactIcon]}>
        <AppIcon name="walking" size={24} color={brandIconColor} />
      </View>
      <View style={styles.compactBody}>
        <Text style={[styles.compactKicker, themedStyles.compactKicker]}>{t("dashboard.rehab.todayCheckIn")}</Text>
        <Text style={[styles.compactTitle, themedStyles.compactTitle]} numberOfLines={2}>
          {t("dashboard.rehab.incompleteToday")}
        </Text>
        <Text style={[styles.compactMeta, themedStyles.compactMeta]}>{t("dashboard.rehab.openCheckInShort")}</Text>
      </View>
      <AppIcon name="chevronRight" size={24} color={theme.appTextMuted} />
    </Pressable>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === "#000000";

  return StyleSheet.create({
    screen: {
      backgroundColor: theme.appBackground,
    },
    content: {
      backgroundColor: theme.appBackground,
    },
    iconButton: {
      backgroundColor: theme.appControlSurface,
    },
    sectionTitle: {
      color: theme.appSectionText,
    },
    compactCard: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    compactCardUrgent: {
      backgroundColor: isDark ? "rgba(240, 6, 22, 0.16)" : "#FEF2F2",
      borderColor: AppTheme.colors.danger,
    },
    compactIcon: {
      backgroundColor: theme.appControlSurface,
    },
    compactKicker: {
      color: theme.appTextMuted,
    },
    compactTitle: {
      color: theme.appText,
    },
    compactMeta: {
      color: theme.appTextSupporting,
    },
  });
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
  gearButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: AppTheme.colors.softSurface,
    alignItems: "center",
    justifyContent: "center",
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
