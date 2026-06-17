import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import {
    getOnboardingProfile,
    getPrimaryIcdDisplay,
    getWearableDeviceDisplay,
} from "@/services/onboarding/onboardingService";

export default function MoreScreen() {
  const router = useRouter();
  const profile = getOnboardingProfile();

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.root}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <Text style={styles.kicker}>Caregiver Concierge</Text>
          <Text style={styles.title}>More</Text>
          <Text style={styles.subtitle}>
            Profile, device, notification, and data-source settings.
          </Text>

          <View style={styles.profileCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {getInitials(profile.caregiver.name)}
              </Text>
            </View>

            <View style={styles.profileTextBlock}>
              <Text style={styles.profileName}>{profile.caregiver.name}</Text>
              <Text style={styles.profileRole}>
                Caregiver · {profile.caregiver.relationship}
              </Text>
              <Text style={styles.profilePatient}>
                Caring for {profile.patient.name}, {profile.patient.age}
              </Text>
            </View>
          </View>

          <SettingsSection title="Profile">
            <SettingsRow
              icon="profile"
              title="Caregiver profile"
              subtitle={`${profile.caregiver.phone} · ${profile.caregiver.languagePreference ?? "Language not set"}`}
              onPress={() => router.push("/profile")}
            />

            <SettingsRow
              icon="care"
              title="Patient profile"
              subtitle={getPrimaryIcdDisplay(profile.patient)}
              onPress={() => router.push("/profile")}
            />
          </SettingsSection>

          <SettingsSection title="Preferences">
            <SettingsRow
              icon="bell"
              title="Notification preferences"
              subtitle={profile.caregiver.notificationStyle ?? "Push + sound"}
              disabled
            />

            <SettingsRow
              icon="device"
              title="Device and baseline"
              subtitle={getWearableDeviceDisplay(profile.patient)}
              disabled
            />

            <SettingsRow
              icon="settings"
              title="Data source status"
              subtitle="Onboarding data · EHR import coming soon"
              disabled
            />
          </SettingsSection>

          <SettingsSection title="Future integrations">
            <SettingsRow
              icon="plus"
              title="Populate from EHR"
              subtitle="C-CDA / FHIR records placeholder"
              disabled
            />

            <SettingsRow
              icon="doctor"
              title="Care team and provider settings"
              subtitle={profile.primaryCareProvider.name}
              disabled
            />
          </SettingsSection>

          <SettingsSection title="Developer / Demo">
            <SettingsRow
              icon="alert"
              title="Acute anomaly demo"
              subtitle="End-to-end orchestration flow"
              onPress={() => router.push("/acute-anomaly")}
            />

            <SettingsRow
              icon="device"
              title="Models"
              subtitle="On-device SLM model management"
              onPress={() => router.push("/models")}
            />

            <SettingsRow
              icon="settings"
              title="Performance"
              subtitle="Device memory and SLM attribution"
              onPress={() => router.push("/performance")}
            />
          </SettingsSection>
        </ScrollView>

        <View style={styles.bottomNav}>
          <BottomNavItem
            label="Home"
            icon="home"
            onPress={() => router.push("/dashboard")}
          />

          <BottomNavItem
            label="Care"
            icon="care"
            alert
            onPress={() => router.push("/care")}
          />

          <BottomNavItem
            label="Meds"
            icon="pill"
            onPress={() => router.push("/medications")}
          />

          <BottomNavItem
            label="Schedule"
            icon="schedule"
            onPress={() => router.push("/schedule")}
          />

          <BottomNavItem
            label="Assistant"
            icon="assistant"
            onPress={() => router.push("/slm")}
          />

          <BottomNavItem label="More" icon="more" active onPress={() => {}} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function SettingsRow({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
}: {
  icon: AppIconName;
  title: string;
  subtitle: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.settingsRow, disabled && styles.settingsRowDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.settingsIconCircle}>
        <AppIcon name={icon} size={22} color={AppTheme.colors.brand} />
      </View>

      <View style={styles.settingsTextBlock}>
        <Text style={styles.settingsTitle}>{title}</Text>
        <Text style={styles.settingsSubtitle}>{subtitle}</Text>
      </View>

      <Text style={styles.chevron}>{disabled ? "Soon" : "›"}</Text>
    </Pressable>
  );
}

function BottomNavItem({
  label,
  icon,
  active,
  alert,
  onPress,
}: {
  label: string;
  icon: AppIconName;
  active?: boolean;
  alert?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.navItem} onPress={onPress}>
      <View style={[styles.navIconCircle, active && styles.navIconCircleActive]}>
        <AppIcon
          name={icon}
          size={active ? 30 : 26}
          color={active ? AppTheme.colors.white : AppTheme.colors.navMuted}
        />

        {alert ? <View style={styles.navAlertDot} /> : null}
      </View>

      <Text style={[styles.navLabel, active && styles.navLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
    paddingTop: 24,
    paddingBottom: 124,
  },
  kicker: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  subtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
    marginTop: 8,
    marginBottom: 22,
  },
  profileCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
    ...AppTheme.shadow,
  },
  avatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  avatarText: {
    color: AppTheme.colors.brand,
    fontSize: 20,
    fontWeight: "900",
  },
  profileTextBlock: {
    flex: 1,
  },
  profileName: {
    color: AppTheme.colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  profileRole: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    fontWeight: "800",
    marginTop: 4,
  },
  profilePatient: {
    color: AppTheme.colors.brand,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 4,
  },
  section: {
    marginBottom: 22,
  },
  sectionTitle: {
    color: AppTheme.colors.sectionText,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  sectionCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    overflow: "hidden",
    ...AppTheme.shadow,
  },
  settingsRow: {
    minHeight: 76,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: AppTheme.colors.border,
    flexDirection: "row",
    alignItems: "center",
  },
  settingsRowDisabled: {
    opacity: 0.82,
  },
  settingsIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  settingsTextBlock: {
    flex: 1,
  },
  settingsTitle: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  settingsSubtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    marginTop: 3,
  },
  chevron: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
    marginLeft: 12,
  },

  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 92,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.white,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  navItem: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 50,
  },
  navIconCircle: {
    width: 48,
    height: 38,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  navIconCircleActive: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: AppTheme.colors.brand,
  },
  navAlertDot: {
    position: "absolute",
    right: 3,
    top: -3,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: AppTheme.colors.danger,
  },
  navLabel: {
    color: AppTheme.colors.navMuted,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 5,
  },
  navLabelActive: {
    color: AppTheme.colors.brand,
  },
});