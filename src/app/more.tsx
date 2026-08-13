import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { YourDecisionsSection } from "@/components/concierge/YourDecisionsSection";
import { AppTheme } from "@/constants/theme";
import { useSettings } from "@/contexts/settings-context";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/hooks/use-translation";

import { useActivePatientView } from '@/hooks/useActivePatientView';
import {
  getCaregiverDisplay,
  getCaregiverRoleDisplay,
  getPatientAgeDisplay,
  getPatientDisplayName,
} from '@/utils/patientDisplay';

export default function MoreScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ focus?: string }>();
  const activePatient = useActivePatientView();
  const patientName = getPatientDisplayName(activePatient);
  const patientAge = getPatientAgeDisplay(activePatient);
  const caregiverName = getCaregiverDisplay(activePatient);
  const caregiverRole = getCaregiverRoleDisplay(activePatient);
  const scrollRef = useRef<ScrollView | null>(null);
  const ehrImportYRef = useRef(0);
  const [importing] = useState(false);
  const { settings, setCarePlanMode } = useSettings();
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

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
    <SafeAreaView style={[styles.safeArea, themedStyles.screen]} edges={["top", "bottom"]}>
      <View style={[styles.root, themedStyles.screen]}>
        <View style={[styles.topBar, themedStyles.topBar]}>
          <Pressable
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)/dashboard" as never);
            }}
            hitSlop={12}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
          >
            <Text style={styles.backText}>{t("more.back")}</Text>
          </Pressable>
          <Text style={[styles.topTitle, themedStyles.primaryText]}>{t("more.title")}</Text>
          <View style={styles.topBarSpacer} />
        </View>

        <ScrollView
          style={themedStyles.screen}
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <Text style={[styles.screenSubtitle, themedStyles.secondaryText]}>
            {t("more.subtitle")}
          </Text>

          <View style={[styles.profileCard, themedStyles.card]}>
            <View style={[styles.avatar, themedStyles.softSurface]}>
              <Text style={styles.avatarText}>
                {getInitials(caregiverName)}
              </Text>
            </View>

            <View style={styles.profileTextBlock}>
              <Text style={[styles.profileName, themedStyles.primaryText]}>{caregiverName}</Text>
              <Text style={[styles.profileRole, themedStyles.secondaryText]}>
                {t("more.profile.role", { role: caregiverRole })}
              </Text>
              <Text style={styles.profilePatient}>
                {t("more.profile.patient", { patientName, patientAge })}
              </Text>
            </View>
          </View>

          <SettingsSection title={t("more.section.profile")}>
            <SettingsRow
              icon="profile"
              title={t("more.row.profiles.title")}
              subtitle={t("more.row.profiles.subtitle")}
              onPress={() => router.push("/profile" as never)}
              accessibilityLabel={t("more.row.profiles.a11y")}
              soonLabel={t("more.row.soon")}
            />
          </SettingsSection>

          <SettingsSection title={t("more.section.carePlan")}>
            <CarePlanModeToggle
              mode={settings.carePlanMode ?? 'full'}
              onChange={setCarePlanMode}
            />
          </SettingsSection>

          <SettingsSection title={t("more.section.preferences")}>
            <SettingsRow
              icon="settings"
              title={t("more.row.preferences.title")}
              subtitle={t("more.row.preferences.subtitle")}
              onPress={() => router.push("/settings" as never)}
              accessibilityLabel={t("more.row.preferences.a11y")}
              soonLabel={t("more.row.soon")}
            />

            <SettingsRow
              emoji={"\u{1F6E0}\u{FE0F}"}
              title={t("more.row.advanced.title")}
              subtitle={t("more.row.advanced.subtitle")}
              onPress={() => router.push("/advanced-developer-settings" as never)}
              accessibilityLabel={t("more.row.advanced.a11y")}
              soonLabel={t("more.row.soon")}
            />
          </SettingsSection>

          <SettingsSection title={t("more.section.communication")}>
            <SettingsRow
              icon="messages"
              title={t("more.row.secureMessages.title")}
              subtitle={t("more.row.secureMessages.subtitle")}
              onPress={() => router.push("/secure-messaging" as never)}
              accessibilityLabel={t("more.row.secureMessages.a11y")}
              soonLabel={t("more.row.soon")}
            />
          </SettingsSection>
          <SettingsSection
            title={t("more.section.futureIntegrations")}
            onLayout={(event) => {
              ehrImportYRef.current = event.nativeEvent.layout.y;
            }}
          >
            <SettingsRow
              icon="plus"
              title={t("more.row.import.title")}
              subtitle={importing ? t("more.row.import.importing") : t("more.row.import.subtitle")}
              onPress={handleOpenEHRImport}
              soonLabel={t("more.row.soon")}
            />

            <SettingsRow
              icon="note"
              title={t("more.row.logs.title")}
              subtitle={t("more.row.logs.subtitle")}
              onPress={handleOpenLogs}
              soonLabel={t("more.row.soon")}
            />

            <SettingsRow
              icon="doctor"
              title={t("more.row.providerSettings.title")}
              subtitle={t("more.row.providerSettings.subtitle")}
              onPress={() => router.push("/care-providers" as never)}
              accessibilityLabel={t("more.row.providerSettings.a11y")}
              soonLabel={t("more.row.soon")}
            />
          </SettingsSection>

          <SettingsSection title={t("more.section.yourActivity")}>
            <YourDecisionsSection
              patientFirstName={getFirstName(patientName)}
              limit={20}
            />
          </SettingsSection>

          <SettingsSection title={t("more.section.about")}>
            <View style={styles.aboutContent}>
              <Text style={[styles.aboutText, themedStyles.primaryText]}>Caregiver Concierge: ACCESS-DP</Text>
              <Pressable
                onLongPress={() => router.push("/advanced-developer-settings" as never)}
                delayLongPress={3000}
                accessibilityRole="button"
                accessibilityLabel={t("more.about.developerA11y")}
              >
                <Text style={[styles.aboutText, themedStyles.primaryText]}>
                  Health Tech Alley {"\u2022"} v1.0.0
                </Text>
                <Text style={[styles.aboutMuted, themedStyles.secondaryText]}>
                  {t("more.about.developerHint")}
                </Text>
              </Pressable>
              <Text style={[styles.aboutMuted, themedStyles.secondaryText]}>
                {t("more.about.disclaimer")}
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
  const themedStyles = createThemedStyles(useTheme());

  return (
    <View style={styles.section} onLayout={onLayout}>
      <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>{title}</Text>
      <View style={[styles.sectionCard, themedStyles.card]}>{children}</View>
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
  soonLabel,
}: {
  icon?: AppIconName;
  emoji?: string;
  title: string;
  subtitle: string;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  soonLabel?: string;
}) {
  const themedStyles = createThemedStyles(useTheme());

  return (
    <Pressable
      style={[styles.settingsRow, themedStyles.divider, disabled && styles.settingsRowDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={onPress ? subtitle : undefined}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <View style={[styles.settingsIconCircle, themedStyles.softSurface]}>
        {emoji ? (
          <Text style={[styles.settingsEmojiIcon, themedStyles.primaryText]}>{emoji}</Text>
        ) : icon ? (
          <AppIcon name={icon} size={22} color={AppTheme.colors.brand} />
        ) : null}
      </View>

      <View style={styles.settingsTextBlock}>
        <Text style={[styles.settingsTitle, themedStyles.primaryText]}>{title}</Text>
        <Text style={[styles.settingsSubtitle, themedStyles.secondaryText]}>{subtitle}</Text>
      </View>

      <Text style={[styles.chevron, themedStyles.secondaryText]}>{disabled ? soonLabel : ">"}</Text>
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
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = createThemedStyles(theme);

  return (
    <View
      style={styles.carePlanModeRow}
      accessible
      accessibilityRole="switch"
      accessibilityLabel={t("more.carePlan.a11y")}
      accessibilityState={{ checked: isFull }}
    >
      <View style={styles.carePlanModeText}>
        <Text style={[styles.carePlanModeTitle, themedStyles.primaryText]}>{t("more.carePlan.title")}</Text>
        <Text style={[styles.carePlanModeSubtitle, themedStyles.secondaryText]}>
          {isFull
            ? t("more.carePlan.enabled")
            : t("more.carePlan.disabled")}
        </Text>
      </View>
      <Switch
        value={isFull}
        onValueChange={(next) => onChange(next ? 'full' : 'read_only')}
        trackColor={{ false: theme.appBorder, true: AppTheme.colors.brand }}
        thumbColor={isFull ? AppTheme.colors.white : theme.appSurface}
        accessibilityLabel={t("more.carePlan.toggleA11y")}
      />
    </View>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { backgroundColor: theme.appBackground },
    topBar: {
      backgroundColor: theme.appBackground,
      borderBottomColor: theme.appBorder,
    },
    card: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    softSurface: { backgroundColor: theme.appBrandSoftSurface },
    divider: { borderBottomColor: theme.appBorder },
    primaryText: { color: theme.appText },
    secondaryText: { color: theme.appTextSupporting },
    sectionTitle: { color: theme.appSectionText },
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.screen,
  },
  backButton: {
    minWidth: 72,
    paddingVertical: 6,
  },
  backText: {
    color: AppTheme.colors.brand,
    fontSize: 16,
    fontWeight: "800",
  },
  topTitle: {
    color: AppTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  topBarSpacer: {
    minWidth: 72,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  screenSubtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    marginBottom: 18,
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
