import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { MainTabHeader } from "@/components/MainTabHeader";
import { YourDecisionsSection } from "@/components/concierge/YourDecisionsSection";
import { AppTheme } from "@/constants/theme";
import { useOrchestratorPatientId } from "@/contexts/orchestrator-context";
import { usePatientRecord } from '@/contexts/patient-record-context';
import { useSettings } from "@/contexts/settings-context";
import { getOnboardingProfile } from "@/services/onboarding/onboardingService";

import { useActivePatientView } from '@/hooks/useActivePatientView';
import { useAppDispatch } from '@/store/hooks';
import {
  getCaregiverDisplay,
  getCaregiverRoleDisplay,
  getPatientAgeDisplay,
  getPatientDisplayName,
} from '@/utils/patientDisplay';

export default function MoreScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ focus?: string }>();
  const dispatch = useAppDispatch();
  const profile = getOnboardingProfile();
  const activePatient = useActivePatientView();
  const patientName = getPatientDisplayName(activePatient);
  const patientAge = getPatientAgeDisplay(activePatient);
  const caregiverName = getCaregiverDisplay(activePatient);
  const caregiverRole = getCaregiverRoleDisplay(activePatient);
  const scrollRef = useRef<ScrollView | null>(null);
  const ehrImportYRef = useRef(0);
  const patientId = useOrchestratorPatientId();
  const { importFHIRBundle, refresh } = usePatientRecord();
  const [importing, setImporting] = useState(false);
  const { settings, setCarePlanMode } = useSettings();

  useEffect(() => {
    if (params.focus !== "ehr-import") return;
    const handle = setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(ehrImportYRef.current - 18, 0),
        animated: true,
      });
    }, 150);
    return () => clearTimeout(handle);
  }, [params.focus]);

  async function handleOpenEHRImport() {
    router.push("/select-fhir-profile" as never);
  }

  async function handleOpenLogs() {
    router.push("/logs" as never);
  }


  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.root}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <MainTabHeader
            title="More"
            eyebrow="Caregiver Concierge"
            subtitle="Profile, preferences, and data-source settings."
            icon="settings"
          />

          <View style={styles.profileCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {getInitials(caregiverName)}
              </Text>
            </View>

            <View style={styles.profileTextBlock}>
              <Text style={styles.profileName}>{caregiverName}</Text>
              <Text style={styles.profileRole}>
                Caregiver {"\u2022"} {caregiverRole}
              </Text>
              <Text style={styles.profilePatient}>
                Caring for {patientName}, {patientAge}
              </Text>
            </View>
          </View>

          <SettingsSection title="Profile">
            <SettingsRow
              icon="profile"
              title="Profiles"
              subtitle="Caregiver and patient details"
              onPress={() => router.push("/profile" as never)}
              accessibilityLabel="Open patient and caregiver profiles"
            />
          </SettingsSection>

          <SettingsSection title="Care plan">
            <CarePlanModeToggle
              mode={settings.carePlanMode ?? 'full'}
              onChange={setCarePlanMode}
            />
          </SettingsSection>

          <SettingsSection title="Preferences">
            <SettingsRow
              icon="settings"
              title="Preferences"
              subtitle="Alerts, reminders, appearance, accessibility, and consent"
              onPress={() => router.push("/settings" as never)}
              accessibilityLabel="Open Preferences"
            />

            <SettingsRow
              emoji={"\u{1F6E0}\u{FE0F}"}
              title="Advanced Developer Settings"
              subtitle="Developer mode, demos, models, API keys, and diagnostics"
              onPress={() => router.push("/advanced-developer-settings" as never)}
              accessibilityLabel="Open Advanced Developer Settings"
            />
          </SettingsSection>

          <SettingsSection title="Communication">
            <SettingsRow
              icon="messages"
              title="Secure Messages"
              subtitle="Prototype care-team messaging scaffold"
              onPress={() => router.push("/secure-messaging" as never)}
              accessibilityLabel="Open secure messaging"
            />
          </SettingsSection>
          <SettingsSection
            title="Future integrations"
            onLayout={(event) => {
              ehrImportYRef.current = event.nativeEvent.layout.y;
            }}
          >
            <SettingsRow
              icon="plus"
              title="Import from health record"
              subtitle={importing ? "Importing health record..." : "Import a FHIR JSON, a single CDA JSON, or a zip of CDA JSONs"}
              onPress={handleOpenEHRImport}
            />

            <SettingsRow
              icon="note"
              title="View Logs"
              subtitle="View app logs for debugging and diagnostics"
              onPress={handleOpenLogs}
            />

            <SettingsRow
              icon="doctor"
              title="Care team and provider settings"
              subtitle={profile.primaryCareProvider.name}
              disabled
            />
          </SettingsSection>

          <SettingsSection title="Your activity">
            <YourDecisionsSection
              patientFirstName={getFirstName(patientName)}
              limit={20}
            />
          </SettingsSection>

          <SettingsSection title="About">
            <View style={styles.aboutContent}>
              <Text style={styles.aboutText}>Caregiver Concierge: ACCESS-DP</Text>
              <Pressable
                onLongPress={() => router.push("/advanced-developer-settings" as never)}
                delayLongPress={3000}
                accessibilityRole="button"
                accessibilityLabel="Hold to open developer tools"
              >
                <Text style={styles.aboutText}>
                  Health Tech Alley {"\u2022"} v1.0.0
                </Text>
                <Text style={styles.aboutMuted}>
                  Press and hold the version number for 3 seconds to open developer tools.
                </Text>
              </Pressable>
              <Text style={styles.aboutMuted}>
                This app is a caregiver support prototype and does not replace
                emergency care or professional medical advice.
              </Text>
            </View>
          </SettingsSection>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function SettingsSection({
  title,
  children,
  onLayout,
}: {
  title: string;
  children: React.ReactNode;
  onLayout?: React.ComponentProps<typeof View>["onLayout"];
}) {
  return (
    <View style={styles.section} onLayout={onLayout}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function SettingsRow({
  icon,
  emoji,
  title,
  subtitle,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  icon?: AppIconName;
  emoji?: string;
  title: string;
  subtitle: string;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      style={[styles.settingsRow, disabled && styles.settingsRowDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={onPress ? subtitle : undefined}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <View style={styles.settingsIconCircle}>
        {emoji ? (
          <Text style={styles.settingsEmojiIcon}>{emoji}</Text>
        ) : icon ? (
          <AppIcon name={icon} size={22} color={AppTheme.colors.brand} />
        ) : null}
      </View>

      <View style={styles.settingsTextBlock}>
        <Text style={styles.settingsTitle}>{title}</Text>
        <Text style={styles.settingsSubtitle}>{subtitle}</Text>
      </View>

      <Text style={styles.chevron}>{disabled ? "Soon" : ">"}</Text>
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

function CarePlanModeToggle({
  mode,
  onChange,
}: {
  mode: 'full' | 'read_only';
  onChange: (next: 'full' | 'read_only') => void;
}) {
  const isFull = mode === 'full';
  return (
    <View
      style={styles.carePlanModeRow}
      accessible
      accessibilityRole="switch"
      accessibilityLabel="Living care plan updates"
      accessibilityState={{ checked: isFull }}
    >
      <View style={styles.carePlanModeText}>
        <Text style={styles.carePlanModeTitle}>Living care plan updates</Text>
        <Text style={styles.carePlanModeSubtitle}>
          {isFull
            ? "Concierge can suggest plan changes for your review."
            : "Care plan stays as imported or last saved. Concierge can still explain using your plan."}
        </Text>
      </View>
      <Switch
        value={isFull}
        onValueChange={(next) => onChange(next ? 'full' : 'read_only')}
        trackColor={{ false: AppTheme.colors.border, true: AppTheme.colors.brand }}
        thumbColor={AppTheme.colors.white}
        accessibilityLabel="Toggle living care plan updates"
      />
    </View>
  );
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
    paddingBottom: 40,
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
  settingsEmojiIcon: {
    fontSize: 22,
    lineHeight: 24,
    includeFontPadding: false,
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
  auditPanel: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.white,
  },
  auditStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  auditPanelTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  auditStatusPill: {
    color: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: "900",
  },
  auditStatusPillWarning: {
    color: AppTheme.colors.danger,
    backgroundColor: "#FEE4E2",
  },
  auditEntryList: {
    gap: 8,
  },
  auditEntry: {
    borderLeftWidth: 2,
    borderLeftColor: AppTheme.colors.border,
    paddingLeft: 10,
  },
  auditEntryTitle: {
    color: AppTheme.colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  auditEntryMeta: {
    color: AppTheme.colors.textSoft,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  auditEmpty: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "700",
  },
  auditError: {
    color: AppTheme.colors.danger,
    fontSize: 13,
    fontWeight: "800",
  },
  aboutContent: {
    width: "100%",
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  aboutText: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "500",
    paddingVertical: 4,
  },
  aboutMuted: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  thresholdBlock: {
    marginTop: 12,
    padding: 12,
    borderRadius: AppTheme.radius.md,
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    gap: 8,
  },
  thresholdTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  thresholdMuted: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 18,
  },
  thresholdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  thresholdTextBlock: {
    flex: 1,
    gap: 2,
  },
  thresholdValue: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  thresholdBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: AppTheme.radius.sm,
  },
  thresholdApplyBtn: {
    backgroundColor: AppTheme.colors.brand,
  },
  thresholdDismissBtn: {
    backgroundColor: AppTheme.colors.chip,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  thresholdBtnText: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: "800",
  },
  carePlanModeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 14,
  },
  carePlanModeText: {
    flex: 1,
  },
  carePlanModeTitle: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  carePlanModeSubtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    marginTop: 4,
  },
});

function getFirstName(name: string): string {
  const firstName = name.trim().split(/\s+/)[0];
  return firstName || name;
}
