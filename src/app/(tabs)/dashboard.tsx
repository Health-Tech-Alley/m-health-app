import { useRouter } from "expo-router";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "@/components/AppIcon";
import { ActiveAlertCard } from "@/components/dashboard/ActiveAlertCard";
import { NonEmergencyInsightCard } from "@/components/dashboard/NonEmergencyInsightCard";
import { PatientSummaryCard } from "@/components/dashboard/PatientSummaryCard";
import { RecentActivityCard } from "@/components/dashboard/RecentActivityCard";
import { TodayPriorityCard } from "@/components/dashboard/TodayPriorityCard";
import { WeeklyVitalsCard } from "@/components/dashboard/WeeklyVitalsCard";
import { AppTheme } from "@/constants/theme";
import { getOnboardingProfile } from "@/services/onboarding/onboardingService";

export default function DashboardRoute() {
  const router = useRouter();
  const profile = getOnboardingProfile();

  const caregiverFirstName = getFirstName(profile.caregiver.name);
  const patientFirstName = getFirstName(profile.patient.name);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.root}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <View style={styles.logoCircle}>
                <Image
                  source={require("@/assets/images/hta-logo.png")}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
              </View>

              <View style={styles.brandTextBlock}>
                <Text style={styles.appName}>Caregiver Concierge</Text>
                <Text style={styles.brandName}>ACCESS-DP</Text>
              </View>

              <Pressable
                style={styles.bellButton}
                onPress={() => router.push("/care")}
              >
                <AppIcon
                  name="bell"
                  size={25}
                  color={AppTheme.colors.textMuted}
                />
                <View style={styles.bellDot} />
              </Pressable>
            </View>

            <Text style={styles.greeting}>
              {`Good evening, ${caregiverFirstName}. Here's ${patientFirstName}'s status.`}
            </Text>
          </View>

          <PatientSummaryCard />
          <ActiveAlertCard />
          <WeeklyVitalsCard />
          <NonEmergencyInsightCard />

          <Text style={styles.sectionTitle}>Today&apos;s Priority</Text>
          <TodayPriorityCard />

          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <RecentActivityCard />
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
  header: {
    marginBottom: 24,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoCircle: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: AppTheme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
    overflow: "hidden",
  },
  logoImage: {
    width: 40,
    height: 40,
  },
  brandTextBlock: {
    flex: 1,
  },
  appName: {
    color: AppTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  brandName: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginTop: 2,
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