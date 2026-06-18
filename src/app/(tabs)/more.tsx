import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import { useOrchestratorPatientId } from "@/contexts/orchestrator-context";
import { useSettings } from "@/contexts/settings-context";
import {
  getAuditLogEntriesForResource,
  verifyAuditLogChain,
  type AuditLogEntrySummary,
} from "@/services/audit/auditService";
import {
  getOnboardingProfile,
  getWearableDeviceDisplay,
} from "@/services/onboarding/onboardingService";
import {
  exportPatientCcda,
  getRecordConsentStatus,
  setRecordConsent,
  type RecordConsentScope,
} from "@/services/records/recordsService";

const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

const CONSENT_OPTIONS: {
  scope: RecordConsentScope;
  emoji: string;
  title: string;
  subtitle: string;
}[] = [
  {
    scope: "ccda_export",
    emoji: "📤",
    title: "C-CDA export consent",
    subtitle: "Allow exporting a C-CDA record for care coordination",
  },
  {
    scope: "fhir-share",
    emoji: "🔗",
    title: "FHIR share consent",
    subtitle: "Allow sharing structured records with approved care systems",
  },
  {
    scope: "pharmacy-communicator",
    emoji: "💊",
    title: "Pharmacy communicator consent",
    subtitle: "Allow medication-related communication with pharmacy tools",
  },
  {
    scope: "provider-message",
    emoji: "💬",
    title: "Provider message consent",
    subtitle: "Allow sending care context to provider messaging tools",
  },
];

const initialConsentState: Record<RecordConsentScope, boolean> = {
  ccda_export: false,
  "fhir-share": false,
  "pharmacy-communicator": false,
  "provider-message": false,
};

export default function MoreScreen() {
  const router = useRouter();
  const profile = getOnboardingProfile();
  const {
    settings,
    isDeveloper,
    setTheme,
    toggleMode,
    setNotificationPreferences,
  } = useSettings();
  const patientId = useOrchestratorPatientId();
  const [consentGranted, setConsentGranted] =
    useState<Record<RecordConsentScope, boolean>>(initialConsentState);
  const [recordExportStatus, setRecordExportStatus] = useState(
    "Consent required before export",
  );
  const [auditLogExpanded, setAuditLogExpanded] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntrySummary[]>([]);
  const [auditChainOk, setAuditChainOk] = useState<boolean | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      const nextConsentState = CONSENT_OPTIONS.reduce(
        (next, option) => ({
          ...next,
          [option.scope]: getRecordConsentStatus(option.scope, patientId)
            .granted,
        }),
        initialConsentState,
      );
      setConsentGranted(nextConsentState);
      setRecordExportStatus(
        nextConsentState.ccda_export
          ? "Consent granted for C-CDA export"
          : "Consent required before export",
      );
    }, 0);
    return () => clearTimeout(handle);
  }, [patientId]);

  function handleConsentToggle(scope: RecordConsentScope) {
    const nextGranted = !consentGranted[scope];
    const consent = setRecordConsent(scope, nextGranted, patientId);
    const nextConsentState = {
      ...consentGranted,
      [scope]: consent.granted,
    };

    setConsentGranted(nextConsentState);

    if (scope !== "ccda_export") {
      return;
    }

    setRecordExportStatus(
      consent.granted
        ? "Consent granted for C-CDA export"
        : "Consent required before export",
    );
  }

  function handleCcdaExport() {
    const result = exportPatientCcda(patientId);

    if (result.status === "queued") {
      setRecordExportStatus("C-CDA export queued for sync");
      Alert.alert("Export queued", result.message);
      return;
    }

    if (result.status === "denied") {
      setConsentGranted((current) => ({
        ...current,
        ccda_export: false,
      }));
      setRecordExportStatus("Consent required before export");
      Alert.alert(
        "Consent required",
        "Please turn on record export consent before exporting a C-CDA record.",
      );
      return;
    }

    setRecordExportStatus("C-CDA export failed");
    Alert.alert("Export failed", result.message);
  }

  function handleToggleAuditLog() {
    if (auditLogExpanded) {
      setAuditLogExpanded(false);
      return;
    }

    try {
      const chain = verifyAuditLogChain();
      const entries = getAuditLogEntriesForResource(undefined, undefined, 8);
      setAuditChainOk(chain.ok);
      setAuditEntries(entries);
      setAuditError(null);
    } catch (error) {
      setAuditChainOk(null);
      setAuditEntries([]);
      setAuditError(
        error instanceof Error
          ? error.message
          : "Unable to read the audit log right now",
      );
    }

    setAuditLogExpanded(true);
  }

  function updateAppointmentLeadTime(delta: number) {
    const current = settings.notifications.appointmentLeadTimeMin ?? 0;
    const next = Math.max(0, current + delta);
    setNotificationPreferences({ appointmentLeadTimeMin: next });
  }

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
                Caregiver {"\u2022"} {profile.caregiver.relationship}
              </Text>
              <Text style={styles.profilePatient}>
                Caring for {profile.patient.name}, {profile.patient.age}
              </Text>
            </View>
          </View>

          <SettingsSection title="Profile">
            <SettingsRow
              icon="profile"
              title="Profiles"
              subtitle="Caregiver and patient details"
              onPress={() => router.push("/profile" as never)}
            />
          </SettingsSection>

          <SettingsSection title="Appearance">
            <ThemeSettingsRow
              selectedTheme={settings.theme}
              onSelectTheme={setTheme}
            />
          </SettingsSection>

          <SettingsSection title="Notification & Preferences">
            <SettingsToggleRow
              icon="alert"
              title="Anomaly alerts"
              subtitle="Notify when vitals or behavior need attention"
              value={settings.notifications.anomaly}
              onValueChange={() =>
                setNotificationPreferences({
                  anomaly: !settings.notifications.anomaly,
                })
              }
            />

            <SettingsToggleRow
              icon="pill"
              title="Medication reminders"
              subtitle="Remind caregivers about medication timing"
              value={settings.notifications.medication}
              onValueChange={() =>
                setNotificationPreferences({
                  medication: !settings.notifications.medication,
                })
              }
            />

            <SettingsToggleRow
              icon="schedule"
              title="Appointment reminders"
              subtitle="Remind caregivers before scheduled visits"
              value={settings.notifications.appointment}
              onValueChange={() =>
                setNotificationPreferences({
                  appointment: !settings.notifications.appointment,
                })
              }
            />

            {settings.notifications.appointment ? (
              <SettingsStepperRow
                emoji="⏱️"
                title="Appointment lead time"
                subtitle="Minutes before appointment reminders"
                value={`${settings.notifications.appointmentLeadTimeMin ?? 0} min`}
                onDecrease={() => updateAppointmentLeadTime(-5)}
                onIncrease={() => updateAppointmentLeadTime(5)}
              />
            ) : null}

            <SettingsToggleRow
              icon="care"
              title="Care task reminders"
              subtitle="Remind caregivers about routine care tasks"
              value={settings.notifications.careTask}
              onValueChange={() =>
                setNotificationPreferences({
                  careTask: !settings.notifications.careTask,
                })
              }
            />
            <SettingsRow
              icon="device"
              title="Device and baseline"
              subtitle={getWearableDeviceDisplay(profile.patient)}
              disabled
            />
          </SettingsSection>

          <SettingsSection title="Communication">
            <SettingsRow
              icon="messages"
              title="Secure Messages"
              subtitle="Care team messaging coming soon"
              disabled
            />
          </SettingsSection>
          <SettingsSection title="Consent Manager">
            <SettingsRow
              emoji="🗂️"
              title="Data source status"
              subtitle="Onboarding data - EHR import coming soon"
              disabled
            />

            {CONSENT_OPTIONS.map((option) => (
              <View key={option.scope}>
                <SettingsToggleRow
                  emoji={option.emoji}
                  title={option.title}
                  subtitle={option.subtitle}
                  value={consentGranted[option.scope]}
                  onValueChange={() => handleConsentToggle(option.scope)}
                />

                {option.scope === "ccda_export" &&
                consentGranted.ccda_export ? (
                  <SettingsRow
                    emoji="📤"
                    title="Export C-CDA"
                    subtitle={recordExportStatus}
                    onPress={handleCcdaExport}
                  />
                ) : null}
              </View>
            ))}
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
            <SettingsToggleRow
              icon="developer"
              title="Developer mode"
              subtitle={
                isDeveloper
                  ? "Demo tools and diagnostics are visible"
                  : "Demo tools and diagnostics are hidden"
              }
              value={isDeveloper}
              onValueChange={toggleMode}
            />

            {isDeveloper ? (
              <>
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
                  icon="performance"
                  title="Performance"
                  subtitle="Device memory and SLM attribution"
                  onPress={() => router.push("/performance")}
                />

                <SettingsRow
                  icon="assistant"
                  title="Raw SLM chat"
                  subtitle="Direct model prompt testing"
                  onPress={() => router.push("/slm")}
                />

                <SettingsRow
                  icon="settings"
                  title="Advanced developer settings"
                  subtitle="SLM management, API keys, knowledge cache, data reset"
                  onPress={() => router.push("/settings" as never)}
                />

                <SettingsRow
                  emoji="🧾"
                  title="View audit log"
                  subtitle={
                    auditLogExpanded
                      ? "Hide recent audited events"
                      : "Verify chain and view recent events"
                  }
                  onPress={handleToggleAuditLog}
                />

                {auditLogExpanded ? (
                  <AuditLogPanel
                    chainOk={auditChainOk}
                    entries={auditEntries}
                    error={auditError}
                  />
                ) : null}
              </>
            ) : null}
          </SettingsSection>

          <SettingsSection title="About">
            <View style={styles.aboutContent}>
              <Text style={styles.aboutText}>Caregiver Concierge: ACCESS-DP</Text>
              <Text style={styles.aboutText}>
                Health Tech Alley {"\u2022"} v1.0.0
              </Text>
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

function ThemeSettingsRow({
  selectedTheme,
  onSelectTheme,
}: {
  selectedTheme: (typeof THEME_OPTIONS)[number]["value"];
  onSelectTheme: (theme: (typeof THEME_OPTIONS)[number]["value"]) => void;
}) {
  return (
    <View style={styles.settingsRow}>
      <View style={styles.settingsIconCircle}>
        <AppIcon name="appearance" size={22} color={AppTheme.colors.brand} />
      </View>

      <View style={styles.settingsTextBlock}>
        <Text style={styles.settingsTitle}>Theme</Text>
        <View style={styles.segmentedControl}>
          {THEME_OPTIONS.map((option) => {
            const selected = option.value === selectedTheme;

            return (
              <Pressable
                key={option.value}
                style={[
                  styles.segmentButton,
                  selected && styles.segmentButtonActive,
                ]}
                onPress={() => onSelectTheme(option.value)}
              >
                <Text
                  style={[
                    styles.segmentLabel,
                    selected && styles.segmentLabelActive,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
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

function SettingsToggleRow({
  icon,
  emoji,
  title,
  subtitle,
  value,
  onValueChange,
}: {
  icon?: AppIconName;
  emoji?: string;
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: () => void;
}) {
  return (
    <View style={styles.settingsRow}>
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

      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{
          false: AppTheme.colors.border,
          true: AppTheme.colors.brandSoft,
        }}
        thumbColor={value ? AppTheme.colors.brand : AppTheme.colors.white}
      />
    </View>
  );
}

function SettingsStepperRow({
  icon,
  emoji,
  title,
  subtitle,
  value,
  onDecrease,
  onIncrease,
}: {
  icon?: AppIconName;
  emoji?: string;
  title: string;
  subtitle: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <View style={styles.settingsRow}>
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

      <View style={styles.stepperControl}>
        <Pressable style={styles.stepperButton} onPress={onDecrease}>
          <Text style={styles.stepperButtonText}>-</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{value}</Text>
        <Pressable style={styles.stepperButton} onPress={onIncrease}>
          <Text style={styles.stepperButtonText}>+</Text>
        </Pressable>
      </View>
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
}: {
  icon?: AppIconName;
  emoji?: string;
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

      <Text style={styles.chevron}>{disabled ? "Soon" : "›"}</Text>
    </Pressable>
  );
}

function AuditLogPanel({
  chainOk,
  entries,
  error,
}: {
  chainOk: boolean | null;
  entries: AuditLogEntrySummary[];
  error: string | null;
}) {
  return (
    <View style={styles.auditPanel}>
      <View style={styles.auditStatusRow}>
        <Text style={styles.auditPanelTitle}>Audit status</Text>
        <Text
          style={[
            styles.auditStatusPill,
            chainOk === false && styles.auditStatusPillWarning,
          ]}
        >
          {chainOk === null
            ? "Unavailable"
            : chainOk
              ? "Verified"
              : "Issue detected"}
        </Text>
      </View>

      {error ? (
        <Text style={styles.auditError}>{error}</Text>
      ) : entries.length === 0 ? (
        <Text style={styles.auditEmpty}>No recent audit entries yet.</Text>
      ) : (
        <View style={styles.auditEntryList}>
          {entries.map((entry) => (
            <View key={entry.auditId} style={styles.auditEntry}>
              <Text style={styles.auditEntryTitle}>
                {entry.actor} {"\u2022"} {entry.action} {"\u2022"}{" "}
                {entry.resourceType}
              </Text>
              <Text style={styles.auditEntryMeta}>
                {formatAuditTimestamp(entry.createdAt)}
                {entry.resourceId ? ` \u2022 ${entry.resourceId}` : ""}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function formatAuditTimestamp(value: string): string {
  return value.replace("T", " ").slice(0, 16);
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
    paddingBottom: 40,
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
  stepperControl: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: 14,
    backgroundColor: AppTheme.colors.softSurface,
    overflow: "hidden",
    marginLeft: 12,
  },
  stepperButton: {
    minWidth: 34,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppTheme.colors.white,
  },
  stepperButtonText: {
    color: AppTheme.colors.brand,
    fontSize: 18,
    fontWeight: "900",
  },
  stepperValue: {
    minWidth: 58,
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
    paddingHorizontal: 10,
  },
  chevron: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
    marginLeft: 12,
  },
  segmentedControl: {
    alignSelf: "flex-start",
    flexDirection: "row",
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: 12,
    overflow: "hidden",
    marginTop: 10,
  },
  segmentButton: {
    minWidth: 70,
    minHeight: 34,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppTheme.colors.white,
  },
  segmentButtonActive: {
    backgroundColor: AppTheme.colors.brand,
  },
  segmentLabel: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "900",
  },
  segmentLabelActive: {
    color: AppTheme.colors.white,
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
});
