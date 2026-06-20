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
import { NonEmergencyInsightCard } from "@/components/dashboard/NonEmergencyInsightCard";
import { PatientSummaryCard } from "@/components/dashboard/PatientSummaryCard";
import { TodayPriorityCard } from "@/components/dashboard/TodayPriorityCard";
import { WeeklyVitalsCard } from "@/components/dashboard/WeeklyVitalsCard";
import { AppTheme } from "@/constants/theme";
import { getOnboardingProfile } from "@/services/onboarding/onboardingService";

export default function DashboardRoute() {
  const profile = getOnboardingProfile();
  const scrollRef = useRef<ScrollView | null>(null);
  const [alertsLogY, setAlertsLogY] = useState(0);

  const caregiverFirstName = getFirstName(profile.caregiver.name);
  const patientFirstName = getFirstName(profile.patient.name);

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
            subtitle={`Good evening, ${caregiverFirstName}. Here's ${patientFirstName}'s status.`}
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
          <NonEmergencyInsightCard />

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
