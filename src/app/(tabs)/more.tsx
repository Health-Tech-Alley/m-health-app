import { useState } from "react";
import { useRouter } from "expo-router";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import { useSettings } from "@/contexts/settings-context";
import {
    getOnboardingProfile,
    getWearableDeviceDisplay,
} from "@/services/onboarding/onboardingService";

export default function MoreScreen() {
  const router = useRouter();
  const profile = getOnboardingProfile();
  const { settings, setNotificationPreferences } = useSettings();
  const [notifOpen, setNotifOpen] = useState(false);

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
              title="Caregiver & patient profile"
              subtitle={`${profile.caregiver.name} · caring for ${profile.patient.name}`}
              onPress={() => router.push("/profile")}
            />
          </SettingsSection>

          <SettingsSection title="Preferences">
            <SettingsRow
              icon="bell"
              title="Notification preferences"
              subtitle={`Anomaly ${settings.notifications.anomaly ? "on" : "off"} · Meds ${settings.notifications.medication ? "on" : "off"} · Appts ${settings.notifications.appointment ? "on" : "off"}`}
              onPress={() => setNotifOpen(true)}
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
      </View>

      {/* Notification preferences modal */}
      <Modal
        visible={notifOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNotifOpen(false)}
      >
        <Pressable style={styles.notifOverlay} onPress={() => setNotifOpen(false)}>
          <Pressable style={styles.notifSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.notifHeader}>
              <Text style={styles.notifTitle}>Notification preferences</Text>
              <Pressable onPress={() => setNotifOpen(false)} hitSlop={12}>
                <Text style={styles.notifClose}>×</Text>
              </Pressable>
            </View>

            <NotifToggle
              label="Anomaly alerts"
              value={settings.notifications.anomaly}
              onValueChange={(v) => setNotificationPreferences({ anomaly: v })}
            />
            <NotifToggle
              label="Medication reminders"
              value={settings.notifications.medication}
              onValueChange={(v) => setNotificationPreferences({ medication: v })}
            />
            <NotifToggle
              label="Appointment reminders"
              value={settings.notifications.appointment}
              onValueChange={(v) => setNotificationPreferences({ appointment: v })}
            />
            <NotifToggle
              label="Care task reminders"
              value={settings.notifications.careTask}
              onValueChange={(v) => setNotificationPreferences({ careTask: v })}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function NotifToggle({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.notifRow}>
      <Text style={styles.notifLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: AppTheme.colors.border, true: AppTheme.colors.brand }}
      />
    </View>
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
  notifOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  notifSheet: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    padding: 22,
  },
  notifHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  notifTitle: {
    color: AppTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  notifClose: {
    color: AppTheme.colors.textSoft,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 26,
  },
  notifRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AppTheme.colors.border,
  },
  notifLabel: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
});