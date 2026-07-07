import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "@/components/AppIcon";
import { MainTabHeader } from "@/components/MainTabHeader";
import { AlertsLogCard } from "@/components/dashboard/AlertsLogCard";
import { NeedsYourReviewBanner } from "@/components/dashboard/NeedsYourReviewBanner";
import { NonEmergencyInsightCard } from "@/components/dashboard/NonEmergencyInsightCard";
import { PatientSummaryCard } from "@/components/dashboard/PatientSummaryCard";
import { TodayPriorityCard } from "@/components/dashboard/TodayPriorityCard";
import { WeeklyVitalsCard } from "@/components/dashboard/WeeklyVitalsCard";
import { AppTheme } from "@/constants/theme";
import { timeOfDayGreeting } from "@/constants/user-terms";
import { useOrchestratorPatientId } from "@/contexts/orchestrator-context";
import { getEventBus } from "@/orchestration/event-bus";
import {
  getActiveCareAlerts,
  type CareAlert,
} from "@/services/care/careService";
import { useActivePatientView } from "@/hooks/useActivePatientView";
import {
  getCaregiverDisplay,
  getPatientDisplayName,
} from "@/utils/patientDisplay";

export default function DashboardRoute() {
  const activePatient = useActivePatientView();
  const patientId = useOrchestratorPatientId();
  const scrollRef = useRef<ScrollView | null>(null);
  const [alertsLogY, setAlertsLogY] = useState(0);
  const [nonEmergencyAlert, setNonEmergencyAlert] = useState<CareAlert | null>(
    null,
  );

  const caregiverFirstName = getFirstName(getCaregiverDisplay(activePatient));
  const patientFirstName = getFirstName(getPatientDisplayName(activePatient));
  const greeting = `${timeOfDayGreeting()}, ${caregiverFirstName}`;

  const scrollToAlertsLog = () => {
    scrollRef.current?.scrollTo({
      y: Math.max(alertsLogY - 16, 0),
      animated: true,
    });
  };

  const refreshNonEmergencyAlert = useCallback(() => {
    if (!patientId) {
      setNonEmergencyAlert(null);
      return;
    }

    const alert = selectNonEmergencyAlert(getActiveCareAlerts(patientId));
    setNonEmergencyAlert(alert);
  }, [patientId]);

  useEffect(() => {
    if (!patientId) {
      const clear = setTimeout(() => setNonEmergencyAlert(null), 0);
      return () => clearTimeout(clear);
    }

    const initial = setTimeout(refreshNonEmergencyAlert, 0);
    const deferredRefresh = () => setTimeout(refreshNonEmergencyAlert, 250);
    const bus = getEventBus();
    const unsubMl = bus.subscribe("ml_alert_created", deferredRefresh);
    const unsubVitals = bus.subscribe("vitals_sample", deferredRefresh);

    return () => {
      clearTimeout(initial);
      unsubMl();
      unsubVitals();
    };
  }, [patientId, refreshNonEmergencyAlert]);

  useFocusEffect(
    useCallback(() => {
      refreshNonEmergencyAlert();
    }, [refreshNonEmergencyAlert]),
  );

  const visibleNonEmergencyAlert =
    nonEmergencyAlert?.patientId === patientId ? nonEmergencyAlert : null;

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
          {visibleNonEmergencyAlert ? (
            <NonEmergencyInsightCard
              key={`${visibleNonEmergencyAlert.patientId}:${visibleNonEmergencyAlert.alertId}`}
              alertId={visibleNonEmergencyAlert.alertId}
              patientId={visibleNonEmergencyAlert.patientId}
            />
          ) : null}

          <Text style={styles.sectionTitle}>Today&apos;s Priority</Text>
          <TodayPriorityCard />

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

function selectNonEmergencyAlert(alerts: CareAlert[]): CareAlert | null {
  return alerts.reduce<CareAlert | null>((selected, alert) => {
    if (alert.severity !== 1 && alert.severity !== 2) {
      return selected;
    }
    if (!selected) {
      return alert;
    }
    if (alert.severity !== selected.severity) {
      return alert.severity > selected.severity ? alert : selected;
    }

    const alertTime = Date.parse(alert.createdAt);
    const selectedTime = Date.parse(selected.createdAt);
    const safeAlertTime = Number.isFinite(alertTime) ? alertTime : 0;
    const safeSelectedTime = Number.isFinite(selectedTime) ? selectedTime : 0;

    if (safeAlertTime !== safeSelectedTime) {
      return safeAlertTime > safeSelectedTime ? alert : selected;
    }

    return alert.alertId.localeCompare(selected.alertId) > 0
      ? alert
      : selected;
  }, null);
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
});
