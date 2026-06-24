import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { MainTabHeader } from "@/components/MainTabHeader";
import { AppTheme } from "@/constants/theme";
import { useOrchestratorPatientId } from "@/contexts/orchestrator-context";
import { usePatientRecord } from '@/contexts/patient-record-context';
import { useSettings } from "@/contexts/settings-context";
import {
  getPendingThresholdRecommendations,
  updateThresholdRecommendationStatus,
  type ThresholdRecommendation,
} from "@/data";
import {
  audit,
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
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system/next';

import { dispatchImmediate } from '@/services/notifications';
import { useAppDispatch } from '@/store/hooks';
import { addPatient } from '@/store/reducers/patientSlice';


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
  const dispatch = useAppDispatch();
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
  const [thresholdRecs, setThresholdRecs] = useState<ThresholdRecommendation[]>([]);
  const [recVersion, setRecVersion] = useState(0);
  const { importFHIRBundle } = usePatientRecord();
  const [importing, setImporting] = useState(false);

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

  // Load pending threshold personalization recommendations (Developer only).
  useEffect(() => {
    if (!isDeveloper || !patientId) {
      // Defer so setState happens outside the effect body.
      const clear = setTimeout(() => setThresholdRecs([]), 0);
      return () => clearTimeout(clear);
    }

    const handle = setTimeout(() => {
      try {
        setThresholdRecs(getPendingThresholdRecommendations(patientId));
      } catch {
        setThresholdRecs([]);
      }
    }, 0);

    return () => clearTimeout(handle);
  }, [isDeveloper, patientId, recVersion]);

  function handleApplyThresholdRec(recId: string) {
    updateThresholdRecommendationStatus(recId, "applied");
    audit({
      actor: "caregiver",
      action: "apply_threshold_recommendation",
      resourceType: "threshold_recommendation",
      resourceId: recId,
      patientId,
    });
    setRecVersion((version) => version + 1);
  }

  function handleDismissThresholdRec(recId: string) {
    updateThresholdRecommendationStatus(recId, "dismissed");
    audit({
      actor: "caregiver",
      action: "dismiss_threshold_recommendation",
      resourceType: "threshold_recommendation",
      resourceId: recId,
      patientId,
    });
    setRecVersion((version) => version + 1);
  }

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

  async function handleOpenEHRImport() {
    
    // 1. Let user pick a JSON file
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });

    if (result.canceled) return null;

    // 2. Read the file contents
    const fileUri = result.assets[0].uri;
    // const contents = await FileSystem.readAsStringAsync(fileUri);
    const file = new File(fileUri);
    const contents = await file.text();           // ← replaces readAsStringAsync
    // const bundle = JSON.parse(contents);

    // 3. Parse FHIR JSON
    const fhirBundle = JSON.parse(contents);
    console.log("Parsed FHIR bundle:", fhirBundle);
    importFHIRBundle(fhirBundle);
    // wherever you receive the patient data (API response, EHR import, etc.)
    dispatch(addPatient(fhirBundle)); // Dispatch the action to save patient data to Redux store
    await dispatchImmediate({
      patientId: patientId,
      scope: 'anomaly',
      title: "EHR Import",
      body: 'FHIR bundle imported successfully',
      severity: 1,
    });// Schedule a push notification after importing the FHIR bundle
    // scheduleLocalNotification(
    //   {
    //     patientId: 'String(args.patientId)',
    //     scope: 'care_task',
    //     triggerRef: 'args.alertId ? String(args.alertId) : undefined',
    //     title: 'EHR Import',
    //     body: 'FHIR bundle imported successfully',
    //     triggerWhen: new Date(Date.now())
    //   }
    // ); // Emit the event with the FHIR bundle data

    // Emit
    // console.log('Emitting fhirBundleImported event with data: ');
    // DeviceEventEmitter.emit('fhirBundleImported', { fhirBundle: fhirBundle });
    // 4. Pass to your DB layer
    // return fhirBundle;
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
          <MainTabHeader
            title="More"
            eyebrow="Caregiver Concierge"
            subtitle="Profile, device, notification, and data-source settings."
            icon="settings"
          />

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
              onPress={handleOpenEHRImport}
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

                {/* Threshold personalization queue (read-only suggestions) */}
                <View style={styles.thresholdBlock}>
                  <Text style={styles.thresholdTitle}>
                    Threshold personalization
                  </Text>
                  <Text style={styles.thresholdMuted}>
                    Queued anomaly-threshold suggestions. Apply or dismiss —
                    never auto-applied. Applying audits the change.
                  </Text>
                  {thresholdRecs.length === 0 ? (
                    <Text style={styles.thresholdMuted}>
                      No pending recommendations.
                    </Text>
                  ) : (
                    thresholdRecs.map((rec) => (
                      <View key={rec.recommendationId} style={styles.thresholdRow}>
                        <View style={styles.thresholdTextBlock}>
                          <Text style={styles.thresholdValue}>
                            Recommended threshold:{" "}
                            {rec.recommendedThreshold.toFixed(3)}
                            {rec.adjustmentPct !== undefined
                              ? ` (${rec.adjustmentPct > 0 ? "+" : ""}${rec.adjustmentPct.toFixed(1)}%)`
                              : ""}
                          </Text>
                          {rec.reason ? (
                            <Text style={styles.thresholdMuted}>{rec.reason}</Text>
                          ) : null}
                        </View>
                        <Pressable
                          style={[styles.thresholdBtn, styles.thresholdApplyBtn]}
                          onPress={() => handleApplyThresholdRec(rec.recommendationId)}
                        >
                          <Text style={styles.thresholdBtnText}>Apply</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.thresholdBtn, styles.thresholdDismissBtn]}
                          onPress={() => handleDismissThresholdRec(rec.recommendationId)}
                        >
                          <Text style={styles.thresholdBtnText}>Dismiss</Text>
                        </Pressable>
                      </View>
                    ))
                  )}
                </View>
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
});
