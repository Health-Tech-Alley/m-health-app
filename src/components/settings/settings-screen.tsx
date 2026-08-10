/**
 * Caregiver Preferences plus advanced developer settings.
 *
 * Preferences keeps caregiver-facing controls compact. Advanced Developer
 * Settings keeps demo, model, API, diagnostic, and reset tools behind the
 * existing Developer / Demo Mode switch.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import { ScreenHeader } from '@/components/ui/screen-header';
import { AppTheme } from '@/constants/theme';
import { useSettings } from '@/contexts/settings-context';
import { useSLM } from '@/contexts/slm-context';
import { useOrchestratorPatientId } from '@/contexts/orchestrator-context';
import { usePatientRecord } from '@/contexts/patient-record-context';
import { DEFAULT_SLM_MODEL_ID, MODEL_CATALOG, resolveActiveModelId } from '@/inference/model-catalog';
import { KnowledgePackProgressCard } from '@/components/models/KnowledgePackProgressCard';
import { SlmModelCarousel } from '@/components/models/SlmModelCarousel';
import { useModelDownloadQueue } from '@/hooks/useModelDownloadQueue';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import {
  SUPPORTED_APP_LANGUAGE_PREFERENCES,
  languagePreferenceLabel,
  normalizeSupportedLanguagePreference,
  type SupportedAppLanguagePreference,
  type TranslateFn,
  type TranslationKey,
  type TranslationParams,
} from '@/localization/i18n';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import {
  clearKnowledgeCache,
  clearKnowledgeCacheForPatient,
  deleteKnowledgeChunk,
  deleteKnowledgeChunksBySource,
  DEVELOPMENT_UC3_REHAB_EXERCISES,
  filterCompletedExerciseKeysForAssignments,
  getActiveConsents,
  getAllKnowledgeChunks,
  getKnowledgeChunksForPatient,
  getAuditEntriesForResource,
  getEnrichmentLogForPatient,
  getPendingThresholdRecommendations,
  isUc3DevelopmentExerciseAssignmentEligible,
  removeDemoMedicationConfirmationRequirement,
  resetDatabase,
  replaceRehabExerciseAssignments,
  setDemoMedicationConfirmationRequired,
  updatePatientConditionRoles,
  updateThresholdRecommendationStatus,
  verifyAuditChain,
  type AuditLogEntry,
  type ConsentToken,
  type KnowledgeChunk,
  type PatientEnrichmentLogEntry,
  type PatientCondition,
  type PatientConditionRole,
  type PatientRecordSnapshot,
  type RehabExerciseKey,
  type ThresholdRecommendation,
} from '@/data';
import { importCdaJsonString, importCdaZip } from '@/data/cda';
import { redownloadForChunk, redownloadAllForPatient } from '@/clinical-evidence/re-download';
import { audit } from '@/services/audit/auditService';
import { grantConsent, revokeConsentAndAudit } from '@/services/consent/consentGate';
import { ensureDefaultAdcpBackupConsent } from '@/services/consent/defaultConsents';
import { getNcbiApiKey, setNcbiApiKey, clearNcbiApiKey } from '@/services/ncbi-token-store';
import { getOpenFdaApiKey, setOpenFdaApiKey, clearOpenFdaApiKey } from '@/services/openfda-token-store';
import { beginOnboardingRerun } from '@/services/onboarding/onboardingService';
import {
  exportPatientCcda,
  getRecordConsentStatus,
  setRecordConsent,
  type RecordConsentScope,
} from '@/services/records/recordsService';
import { evaluateAndPersistUc3Trajectory } from '@/services/uc3/uc3EvaluationService';
import {
  createManualUc3EvaluationKey,
  describeUc3DeveloperEvaluationResult,
  type Uc3DeveloperEvaluationStatus,
} from '@/services/uc3/uc3DeveloperEvaluationPresenter';
import { evaluateAndPersistUc4Priorities } from '@/services/uc4/uc4EvaluationService';
import { isNativeMemoryAvailable, useMemoryInfo } from '@/services/device-memory';

const teal = '#0E6F68';
const darkText = '#123433';
const mutedText = '#526866';
const borderColor = '#D9E7E5';
const dangerRed = '#B42318';

const RECORD_CONSENT_OPTIONS: {
  scope: RecordConsentScope;
  emoji: string;
  titleKey: TranslationKey;
  subtitleKey: TranslationKey;
}[] = [
  {
    scope: 'ccda_export',
    emoji: '📤',
    titleKey: 'settings.consent.healthExport.title',
    subtitleKey: 'settings.consent.healthExport.subtitle',
  },
  {
    scope: 'fhir-share',
    emoji: '🔗',
    titleKey: 'settings.consent.healthShare.title',
    subtitleKey: 'settings.consent.healthShare.subtitle',
  },
  {
    scope: 'pharmacy-communicator',
    emoji: '💊',
    titleKey: 'settings.consent.pharmacy.title',
    subtitleKey: 'settings.consent.pharmacy.subtitle',
  },
  {
    scope: 'provider-message',
    emoji: '💬',
    titleKey: 'settings.consent.providerMessage.title',
    subtitleKey: 'settings.consent.providerMessage.subtitle',
  },
];

const ADCP_BACKUP_CONSENT = {
  scope: 'adcp_backup' as const,
  emoji: '💾',
  titleKey: 'settings.consent.carePlanBackup.title' as const,
  subtitleKey: 'settings.consent.carePlanBackup.subtitle' as const,
};

const initialRecordConsentState: Record<RecordConsentScope | 'adcp_backup', boolean> = {
  ccda_export: false,
  'fhir-share': false,
  'pharmacy-communicator': false,
  'provider-message': false,
  // Care plan backup consent is on by default (auto-granted per patient).
  adcp_backup: true,
};

const EMPTY_CONDITIONS: PatientCondition[] = [];
const SETTINGS_LANGUAGE_OPTIONS = SUPPORTED_APP_LANGUAGE_PREFERENCES;
type LocalizedMessage =
  | { key: TranslationKey; params?: TranslationParams }
  | { text: string };

type ExpandableId =
  | 'anomaly'
  | 'medication'
  | 'appointment'
  | 'care-task'
  | 'timing'
  | 'appearance'
  | 'language'
  | 'accessibility'
  | 'consent'
  | 'developer-mode'
  | 'dynamic-slm-loading'
  | 'concierge-reasoning'
  | 'nlu-development-fallback'
  | 'evidence-development-fallback'
  | 'knowledge-graph-expansion'
  | 'knowledge-pack-runner'
  | 'live-clinical-fetch'
  | 'consent-adcp_backup'
  | 'healthkit-integration'
  | 'simulate-missing-optional-features';

export function SettingsScreen() {
  return <PreferencesScreen />;
}

export function PreferencesScreen() {
  const router = useRouter();
  const {
    settings,
    setTheme,
    setHealthKitIntegrationEnabled,
    setLanguagePreference,
  } = useSettings();
  const theme = useTheme();
  const { locale, t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const patientId = useOrchestratorPatientId();
  const { refresh: refreshPatientRecord } = usePatientRecord();
  const [expandedId, setExpandedId] = useState<ExpandableId | null>(null);
  const [recordConsentGranted, setRecordConsentGranted] =
    useState<Record<RecordConsentScope, boolean>>(initialRecordConsentState);
  const [recordExportStatus, setRecordExportStatus] = useState<LocalizedMessage>({
    key: 'settings.status.consentRequiredBeforeExport',
  });
  const [adcpBackupStatus, setAdcpBackupStatus] = useState<LocalizedMessage>({
    key: 'settings.status.backupConsentDefault',
  });

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/more' as never);
  }, [router]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (patientId) {
        ensureDefaultAdcpBackupConsent(patientId);
      }
      const nextConsentState: Record<RecordConsentScope | 'adcp_backup', boolean> = {
        ...initialRecordConsentState,
      };
      for (const option of RECORD_CONSENT_OPTIONS) {
        nextConsentState[option.scope] = getRecordConsentStatus(
          option.scope,
          patientId,
        ).granted;
      }
      nextConsentState.adcp_backup = patientId
        ? getRecordConsentStatus('adcp_backup', patientId).granted
        : true;

      setRecordConsentGranted(nextConsentState);
      setRecordExportStatus(
        nextConsentState.ccda_export
          ? { key: 'settings.status.consentGrantedForExport' }
          : { key: 'settings.status.consentRequiredBeforeExport' },
      );
      setAdcpBackupStatus(
        nextConsentState.adcp_backup
          ? { key: 'settings.status.backupConsentEnabled' }
          : { key: 'settings.status.consentRequiredBeforeBackup' },
      );
    }, 0);

    return () => clearTimeout(handle);
  }, [patientId]);

  const toggleExpanded = useCallback((id: ExpandableId) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  const selectedLanguagePreference = normalizeSupportedLanguagePreference(
    settings.languagePreference,
  );

  const handleLanguagePreferenceChange = useCallback((nextPreference: SupportedAppLanguagePreference) => {
    setLanguagePreference(normalizeSupportedLanguagePreference(nextPreference));
  }, [
    setLanguagePreference,
  ]);

  const handleRecordConsentToggle = useCallback((scope: RecordConsentScope) => {
    const nextGranted = !recordConsentGranted[scope];
    const consent = setRecordConsent(scope, nextGranted, patientId);
    const nextConsentState = {
      ...recordConsentGranted,
      [scope]: consent.granted,
    };

    setRecordConsentGranted(nextConsentState);

    if (scope === 'ccda_export') {
      setRecordExportStatus(
        consent.granted
          ? { key: 'settings.status.consentGrantedForExport' }
          : { key: 'settings.status.consentRequiredBeforeExport' },
      );
    }
  }, [patientId, recordConsentGranted]);

  const handlePatientCcdaExport = useCallback(() => {
    const result = exportPatientCcda(patientId);

    if (result.status === 'queued') {
      setRecordExportStatus({ key: 'settings.status.healthRecordExportQueued' });
      Alert.alert(t('settings.alert.exportQueued'), result.message);
      return;
    }

    if (result.status === 'denied') {
      setRecordConsentGranted((current) => ({
        ...current,
        ccda_export: false,
      }));
      setRecordExportStatus({ key: 'settings.status.consentRequiredBeforeExport' });
      Alert.alert(
        t('settings.alert.consentRequired'),
        t('settings.alert.enableRecordExportConsent'),
      );
      return;
    }

    setRecordExportStatus({ key: 'settings.status.healthRecordExportFailed' });
    Alert.alert(t('settings.alert.exportFailed'), result.message);
  }, [patientId, t]);

  // ADCP plan backup handlers (planning/39 §7.5 P5)
  // -------------------------------------------------------------------------
  // Imports are deliberately dynamic so Track A dev-builds without
  // expo-sharing / expo-document-picker can still render the screen.
  const handleAdcpBundleExport = useCallback(async () => {
    try {
      const [{ snapshot }, { exportAdcpBundle }] = await Promise.all([
        import('@/data/repositories/patientRecordRepository').then((m) => ({
          snapshot: m.getPatientRecordSnapshot(patientId),
        })),
        import('@/services/carePlan/adcpExportService').then((m) => ({
          exportAdcpBundle: m.exportAdcpBundle,
        })),
      ]);
      // Consent-gated path (adcp_backup). autoGrant when toggle already on.
      const result = exportAdcpBundle({
        snapshot,
        autoGrantConsent: recordConsentGranted.adcp_backup,
      });
      if (!result.ok || !result.json || !result.filename) {
        if (result.consentRequired) {
          setAdcpBackupStatus({ key: 'settings.status.consentRequiredBeforeBackup' });
          Alert.alert(t('settings.alert.consentRequired'), t('settings.alert.enableBackupConsent'));
          return;
        }
        setAdcpBackupStatus({ key: 'settings.status.nothingToExport' });
        Alert.alert(t('settings.alert.noPlanToExport'), result.reason ?? t('settings.alert.noActiveCarePlan'));
        return;
      }
      setAdcpBackupStatus({
        key: 'settings.status.backupReady',
        params: { bytes: result.bundleSize ?? 0 },
      });

      // Prefer Share on devices; fall back to in-app preview only.
      try {
        const Sharing = await import('expo-sharing');
        const { File, Paths } = await import('expo-file-system');
        const tmpDir = Paths.cache?.uri ?? Paths.document?.uri ?? '';
        const tmpPath = `${tmpDir.replace(/\/$/, '')}/${result.filename}`;
        const file = new File(tmpPath);
        await file.create();
        await file.write(result.json);
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: t('settings.action.exportCarePlanBackup'),
        });
        setAdcpBackupStatus({
          key: 'settings.status.exportedBackup',
          params: { filename: result.filename, bytes: result.bundleSize ?? 0 },
        });
      } catch (shareErr) {
        // Expo Go (Track A) lacks `expo-sharing`; surface as preview only.
        console.warn('[adcpExport] share unavailable, preview only:', shareErr);
        setAdcpBackupStatus({
          key: 'settings.status.backupPreview',
          params: { filename: result.filename, bytes: result.bundleSize ?? 0 },
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAdcpBackupStatus({ key: 'settings.status.exportFailed', params: { message: msg } });
      Alert.alert(t('settings.alert.exportFailed'), msg);
    }
  }, [patientId, recordConsentGranted.adcp_backup, t]);

  const handleAdcpBundleRestore = useCallback(async () => {
    try {
      const DocumentPicker = await import('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'public.json', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || result.assets.length === 0) {
        return;
      }
      const asset = result.assets[0];
      if (!asset?.uri) {
        Alert.alert(t('settings.alert.restoreFailed'), t('settings.alert.noFileUri'));
        return;
      }

      const [{ File }] = await Promise.all([
        import('expo-file-system').then((m) => ({ File: m.File })),
      ]);
      const file = new File(asset.uri);
      const jsonText = await file.text();

      const [{ importAdcpBundleFromJsonText }] = await Promise.all([
        import('@/services/carePlan/adcpImportService').then((m) => ({
          importAdcpBundleFromJsonText: m.importAdcpBundleFromJsonText,
        })),
      ]);
      const outcome = importAdcpBundleFromJsonText({
        jsonText,
        activePatientId: patientId,
      });

      if (outcome.ok) {
        const restoredVersion = outcome.newPlanVersion ?? '';
        setAdcpBackupStatus({
          key: 'settings.status.restoreComplete',
          params: { version: restoredVersion },
        });
        refreshPatientRecord();
        Alert.alert(
          t('settings.alert.restoreComplete'),
          t('settings.alert.restoreCompleteBody', { version: restoredVersion }),
        );
      } else {
        setAdcpBackupStatus({
          key: 'settings.status.restoreRejected',
          params: { reason: outcome.reason ?? t('settings.alert.bundleInvalid') },
        });
        Alert.alert(t('settings.alert.restoreRejected'), outcome.reason ?? t('settings.alert.bundleInvalid'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAdcpBackupStatus({ key: 'settings.status.restoreFailed', params: { message: msg } });
      Alert.alert(t('settings.alert.restoreFailed'), msg);
    }
  }, [patientId, refreshPatientRecord, t]);

  /** P5b — lossy FHIR Bundle share (dev / handoff demo). */
  const handleAdcpFhirExport = useCallback(async () => {
    try {
      const [
        { getPatientRecordSnapshot },
        { getActiveAdcpRevisionForPatient },
        { projectAdcpToFhirBundle, isAdcpFhirProjectionEnabled },
      ] = await Promise.all([
        import('@/data/repositories/patientRecordRepository'),
        import('@/data/repositories/adcpRepository'),
        import('@/data/fhir/adcp-to-fhir-bundle'),
      ]);
      if (!isAdcpFhirProjectionEnabled(true)) {
        Alert.alert('Unavailable', 'FHIR care plan projection is disabled in this build.');
        return;
      }
      const snapshot = getPatientRecordSnapshot(patientId);
      const plan = getActiveAdcpRevisionForPatient(patientId);
      if (!plan) {
        Alert.alert('No plan', 'No active care plan revision to project.');
        return;
      }
      const { bundle, warningCount } = projectAdcpToFhirBundle({
        patientId,
        plan,
        snapshot,
      });
      const json = JSON.stringify(bundle, null, 2);
      const filename = `adcp-fhir-${patientId}-v${plan.identity.version}.json`;
      try {
        const Sharing = await import('expo-sharing');
        const { File, Paths } = await import('expo-file-system');
        const tmpDir = Paths.cache?.uri ?? Paths.document?.uri ?? '';
        const tmpPath = `${tmpDir.replace(/\/$/, '')}/${filename}`;
        const file = new File(tmpPath);
        await file.create();
        await file.write(json);
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/fhir+json',
          dialogTitle: 'Care plan FHIR Bundle',
        });
        setAdcpBackupStatus({
          text: `FHIR Bundle shared (${json.length} bytes)${warningCount ? ` · ${warningCount} warnings` : ''}.`,
        });
      } catch (shareErr) {
        console.warn('[adcpFhirExport] share unavailable:', shareErr);
        setAdcpBackupStatus({
          text: `FHIR Bundle ready (${json.length} bytes) — share unavailable on Track A.`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAdcpBackupStatus({ text: `FHIR export failed: ${msg}` });
      Alert.alert('FHIR export failed', msg);
    }
  }, [patientId]);

  return (
    <SafeAreaView style={[styles.safeArea, themedStyles.safeArea]} edges={['top', 'bottom']}>
      <ScrollView style={themedStyles.safeArea} contentContainerStyle={[styles.content, themedStyles.content]}>
        <View style={styles.topBar}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t('settings.backToMenuA11y')}>
            <Text style={styles.backText}>{t('settings.backToMenu')}</Text>
          </Pressable>
          <View style={styles.topBarSpacer} />
        </View>

        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Image
              source={require('@/assets/images/hta-logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.headerTextBlock}>
            <Text style={styles.headerEyebrow}>{t('settings.eyebrow')}</Text>
            <Text style={[styles.headerTitle, themedStyles.headerText]}>{t('settings.title.preferences')}</Text>
          </View>
        </View>

        <Section title={`🔔 ${t('settings.section.notifications')}`}>
          <CompactActionRow
            id="timing"
            emoji="⏰"
            label={t('settings.notifications.label')}
            expanded={expandedId === 'timing'}
            explanation={t('settings.notifications.explanation')}
            onToggleExpand={toggleExpanded}
            localizeAccessibility
          >
            <Pressable
              style={styles.actionButton}
              onPress={() => router.push('/notifications-reminders')}
              accessibilityRole="button"
              accessibilityLabel={t('settings.notifications.openA11y')}>
              <Text style={styles.actionButtonText}>{t('settings.notifications.open')}</Text>
            </Pressable>
          </CompactActionRow>
        </Section>

        <Section title={`🎨 ${t('settings.section.appearance')}`}>
          <CompactActionRow
            id="appearance"
            emoji="🎨"
            label={t('settings.appearance.label')}
            expanded={expandedId === 'appearance'}
            explanation={t('settings.appearance.explanation')}
            onToggleExpand={toggleExpanded}
            localizeAccessibility
          >
            <View style={[styles.segmented, themedStyles.segmented]}>
              {(['light', 'dark', 'system'] as const).map((themeOption) => {
                const label =
                  themeOption === 'light'
                    ? t('onboarding.appearance.light')
                    : themeOption === 'dark'
                      ? t('onboarding.appearance.dark')
                      : t('onboarding.appearance.system');
                return (
                <Pressable
                  key={themeOption}
                  style={[
                    styles.segButton,
                    themedStyles.segment,
                    settings.theme === themeOption && styles.segButtonActive,
                  ]}
                  onPress={() => setTheme(themeOption)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.appearance.useTheme', { label })}
                  accessibilityState={{ selected: settings.theme === themeOption }}>
                  <Text style={[styles.segText, themedStyles.secondaryText, settings.theme === themeOption && styles.segTextActive]}>
                    {label}
                  </Text>
                </Pressable>
                );
              })}
            </View>
          </CompactActionRow>
        </Section>

        <Section title={`🌐 ${t('settings.section.language')}`}>
          <CompactActionRow
            id="language"
            emoji="🌐"
            label={t('settings.language.label')}
            expanded={expandedId === 'language'}
            explanation={t('settings.language.explanation')}
            onToggleExpand={toggleExpanded}
            localizeAccessibility
          >
            <View style={[styles.segmented, themedStyles.segmented]}>
              {SETTINGS_LANGUAGE_OPTIONS.map((languageOption) => {
                const label = languagePreferenceLabel(languageOption, t);
                const selected = selectedLanguagePreference === languageOption;
                return (
                  <Pressable
                    key={languageOption}
                    style={[
                      styles.segButton,
                      themedStyles.segment,
                      selected && styles.segButtonActive,
                    ]}
                    onPress={() => handleLanguagePreferenceChange(languageOption)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.language.useLanguage', { label })}
                    accessibilityHint={t('settings.language.hint')}
                    accessibilityState={{ selected }}>
                    <Text style={[styles.segText, themedStyles.secondaryText, selected && styles.segTextActive]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </CompactActionRow>
        </Section>

        <Section title={`♿ ${t('settings.section.accessibility')}`}>
          <CompactActionRow
            id="accessibility"
            emoji="♿"
            label={t('settings.accessibility.label')}
            expanded={expandedId === 'accessibility'}
            explanation={t('settings.accessibility.explanation')}
            onToggleExpand={toggleExpanded}
            localizeAccessibility
          />
        </Section>

        <Section title={`⌚ ${t('settings.section.wearables')}`}>
          <CompactToggleRow
            id="healthkit-integration"
            emoji="❤️"
            label={t('settings.wearables.appleHealth')}
            value={settings.healthKitIntegrationEnabled !== false}
            expanded={expandedId === 'healthkit-integration'}
            explanation={t('settings.wearables.appleHealthExplanation')}
            onToggleExpand={toggleExpanded}
            onValueChange={(enabled) => setHealthKitIntegrationEnabled(enabled)}
            accessibilityLabel={t('settings.wearables.appleHealth')}
            accessibilityHint={t('settings.wearables.appleHealthExplanation')}
            localizeAccessibility
          />
        </Section>

        <Section title={`🛡️ ${t('settings.section.privacyConsent')}`}>
          <CompactActionRow
            id="consent"
            emoji="🛡️"
            label={t('settings.privacy.consentManager')}
            expanded={expandedId === 'consent'}
            explanation={t('settings.privacy.consentExplanation')}
            onToggleExpand={toggleExpanded}
            localizeAccessibility
          >
            <View style={styles.subsection}>
              <Text style={[styles.subsectionTitle, themedStyles.primaryText]}>{t('settings.privacy.recordSharing')}</Text>
              {RECORD_CONSENT_OPTIONS.map((option) => (
                <View key={option.scope}>
                  <CompactToggleRow
                    id={`consent-${option.scope}` as ExpandableId}
                    emoji={option.emoji}
                    label={t(option.titleKey)}
                    value={recordConsentGranted[option.scope]}
                    expanded={false}
                    onToggleExpand={() => {}}
                    onValueChange={() => handleRecordConsentToggle(option.scope)}
                    accessibilityLabel={t(option.titleKey)}
                    accessibilityHint={t(option.subtitleKey)}
                    localizeAccessibility
                  />

                  {option.scope === 'ccda_export' && recordConsentGranted.ccda_export ? (
                    <PlainActionRow
                      emoji="📄"
                      label={t('settings.action.exportHealthRecord')}
                      description={formatLocalizedMessage(recordExportStatus, t)}
                      onPress={handlePatientCcdaExport}
                      accessibilityLabel={t('settings.action.exportHealthRecord')}
                    />
                  ) : null}
                </View>
              ))}

              {/* ADCP plan backup consent (planning/39 §7.5 P5) */}
              <View key="adcp-backup">
                <CompactToggleRow
                  id="consent-adcp_backup"
                  emoji={ADCP_BACKUP_CONSENT.emoji}
                  label={t(ADCP_BACKUP_CONSENT.titleKey)}
                  value={recordConsentGranted.adcp_backup}
                  expanded={false}
                  onToggleExpand={() => {}}
                  onValueChange={() => handleRecordConsentToggle(ADCP_BACKUP_CONSENT.scope)}
                  accessibilityLabel={t(ADCP_BACKUP_CONSENT.titleKey)}
                  accessibilityHint={t(ADCP_BACKUP_CONSENT.subtitleKey)}
                  localizeAccessibility
                />

                {recordConsentGranted.adcp_backup ? (
                  <PlainActionRow
                    emoji="💾"
                    label={t('settings.action.exportCarePlanBackup')}
                    description={formatLocalizedMessage(adcpBackupStatus, t)}
                    onPress={handleAdcpBundleExport}
                    accessibilityLabel={t('settings.action.exportCarePlanBackup')}
                  />
                ) : null}

                {recordConsentGranted.adcp_backup ? (
                  <PlainActionRow
                    emoji="📥"
                    label={t('settings.action.restoreCarePlanBackup')}
                    description={t('settings.action.restoreCarePlanBackupDescription')}
                    onPress={handleAdcpBundleRestore}
                    accessibilityLabel={t('settings.action.restoreCarePlanBackup')}
                  />
                ) : null}

                {__DEV__ && recordConsentGranted.adcp_backup ? (
                  <PlainActionRow
                    emoji="🏥"
                    label="Export care plan as FHIR Bundle (dev)"
                    description="Lossy US Core–style CarePlan Bundle for handoff demos."
                    onPress={handleAdcpFhirExport}
                    accessibilityLabel="Export care plan FHIR Bundle"
                  />
                ) : null}
              </View>
            </View>

            <View style={styles.subsection}>
              <Text style={[styles.subsectionTitle, themedStyles.primaryText]}>{t('settings.privacy.consentTokens')}</Text>
              <ConsentManagement patientId={patientId} />
            </View>
          </CompactActionRow>
        </Section>

        <YourDecisionsSection patientId={patientId} locale={locale} />
      </ScrollView>
    </SafeAreaView>
  );
}

export function AdvancedDeveloperSettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const developerPlaceholderColor =
    theme.appBackground === '#000000' ? theme.appTextMuted : mutedText;
  const {
    settings,
    isDeveloper,
    toggleMode,
    setDemoDefaultModelId,
    setDynamicSlmLoading,
    setConciergeReasoning,
    setNluDevelopmentFallback,
    setEvidenceDevelopmentFallback,
    setKnowledgeGraphExpansion,
    setLiveClinicalFetch,
    setSimulateMissingOptionalFeatures,
  } = useSettings();
  const slm = useSLM();
  const modelQueue = useModelDownloadQueue();
  // Effective default — a single installed model is always the default.
  const effectiveDefaultModelId = resolveActiveModelId(settings.demoDefaultModelId, (id) =>
    modelQueue.rows.some((r) => r.id === id && r.status === 'installed'),
  );
  const memoryInfo = useMemoryInfo(2000);
  const hasNativeMemory = isNativeMemoryAvailable();
  const patientId = useOrchestratorPatientId();
  const {
    patientId: patientRecordPatientId,
    snapshot,
    refresh,
    mutatePatientRecord,
  } = usePatientRecord();
  const [expandedId, setExpandedId] = useState<ExpandableId | null>(null);
  const [ncbiKeyInput, setNcbiKeyInput] = useState('');
  const [openfdaKeyInput, setOpenfdaKeyInput] = useState('');
  const [ncbiKeyStored, setNcbiKeyStored] = useState(false);
  const [openfdaKeyStored, setOpenfdaKeyStored] = useState(false);

  const refreshKeyStatus = useCallback(async () => {
    setNcbiKeyStored(Boolean(await getNcbiApiKey()));
    setOpenfdaKeyStored(Boolean(await getOpenFdaApiKey()));
  }, []);

  // On mount, read the secure-store to show stored/empty badges for each key.
  // This is a legit external-system sync (expo-secure-store), not a cascading render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshKeyStatus(); }, [refreshKeyStatus]);

  useEffect(() => {
    const tag = 'settings-downloads';
    if (modelQueue.anyDownloading) {
      void activateKeepAwakeAsync(tag).catch(() => undefined);
    } else {
      void deactivateKeepAwake(tag).catch(() => undefined);
    }
    return () => {
      void deactivateKeepAwake(tag).catch(() => undefined);
    };
  }, [modelQueue.anyDownloading]);

  const [thresholdRecs, setThresholdRecs] = useState<ThresholdRecommendation[]>([]);
  const [recVersion, setRecVersion] = useState(0);
  const [rerunningDemo, setRerunningDemo] = useState(false);
  const [runningUc3Evaluation, setRunningUc3Evaluation] = useState(false);
  const [uc3EvaluationStatus, setUc3EvaluationStatus] =
    useState<Uc3DeveloperEvaluationStatus | null>(null);
  const [runningUc4Evaluation, setRunningUc4Evaluation] = useState(false);
  const [uc4EvaluationStatus, setUc4EvaluationStatus] =
    useState<Uc3DeveloperEvaluationStatus | null>(null);
  const [importingEhr, setImportingEhr] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const activeCarePlan = snapshot?.carePlan ?? null;
  const rehabExerciseAssignments = useMemo(
    () => snapshot?.rehabExerciseAssignments ?? [],
    [snapshot?.rehabExerciseAssignments],
  );
  const uc3ExerciseAssignmentEligible =
    __DEV__ &&
    isUc3DevelopmentExerciseAssignmentEligible(snapshot?.conditions ?? EMPTY_CONDITIONS, activeCarePlan);
  const assignedExerciseKeySet = useMemo(
    () =>
      new Set(
        rehabExerciseAssignments
          .filter((assignment) => assignment.active)
          .map((assignment) => assignment.exerciseKey),
      ),
    [rehabExerciseAssignments],
  );

  const handleUc3ExerciseAssignmentToggle = useCallback((exerciseKey: RehabExerciseKey) => {
    if (!patientRecordPatientId || !activeCarePlan || !uc3ExerciseAssignmentEligible) return;

    let nextKeys: RehabExerciseKey[] = [];
    let carePlanId = activeCarePlan.planId;
    void mutatePatientRecord((latestSnapshot) => {
      if (latestSnapshot.patient?.patientId !== patientRecordPatientId) {
        throw new Error(`Cannot update exercise assignments for inactive patient: ${patientRecordPatientId}`);
      }
      carePlanId = latestSnapshot.carePlan?.planId ?? carePlanId;
      const keySet = new Set(latestSnapshot.rehabExerciseAssignments.map((assignment) => assignment.exerciseKey));
      keySet.has(exerciseKey) ? keySet.delete(exerciseKey) : keySet.add(exerciseKey);
      nextKeys = DEVELOPMENT_UC3_REHAB_EXERCISES
        .map((exercise) => exercise.key)
        .filter((key) => keySet.has(key));
      return patchRehabAssignments(latestSnapshot, carePlanId, nextKeys);
    }, () => {
      replaceRehabExerciseAssignments({ patientId: patientRecordPatientId, carePlanId, exerciseKeys: nextKeys });
    }).catch(reportAdvancedSettingsSaveFailure);
  }, [
    activeCarePlan,
    mutatePatientRecord,
    patientRecordPatientId,
    uc3ExerciseAssignmentEligible,
  ]);

  const handleRunUc3Evaluation = useCallback(() => {
    if (!snapshot?.patient) {
      setUc3EvaluationStatus({
        title: 'UC3 evaluation not ready',
        lines: ['No active patient selected.'],
      });
      return;
    }

    const now = new Date();
    const evaluationKey = createManualUc3EvaluationKey(now);
    setRunningUc3Evaluation(true);
    try {
      const result = evaluateAndPersistUc3Trajectory(snapshot, {
        evaluationKey,
        now,
      });
      setUc3EvaluationStatus(describeUc3DeveloperEvaluationResult(result));
      if (result.status === 'success') {
        refresh();
      }
    } finally {
      setRunningUc3Evaluation(false);
    }
  }, [refresh, snapshot]);

  const handleRunUc4Evaluation = useCallback(() => {
    if (!snapshot?.patient) {
      setUc4EvaluationStatus({
        title: 'UC4 evaluation not ready',
        lines: ['No active patient selected.'],
      });
      return;
    }

    setRunningUc4Evaluation(true);
    try {
      const result = evaluateAndPersistUc4Priorities(snapshot);
      if (result.status === 'success') {
        setUc4EvaluationStatus({
          title: 'UC4 evaluation saved',
          lines: [
            `Run: ${result.runId}`,
            `Status: ${result.runStatus}`,
            `Cards: ${result.cards.length}`,
            result.pauseReason ? `Pause reason: ${result.pauseReason}` : '',
          ].filter(Boolean),
        });
        refresh();
      } else if (result.status === 'not_ready') {
        setUc4EvaluationStatus({
          title: 'UC4 evaluation not ready',
          lines: result.errors.map((item) => `${item.code}: ${item.message}`),
        });
      } else {
        setUc4EvaluationStatus({
          title: `UC4 ${result.status.replace(/_/g, ' ')}`,
          lines: [result.message],
        });
      }
    } finally {
      setRunningUc4Evaluation(false);
    }
  }, [refresh, snapshot]);

  const handleRerunElenaDemo = useCallback(() => {
    setRerunningDemo(true);
    try {
      // Clear completion gate + active patient, queue Elena preset, open wizard.
      beginOnboardingRerun({ demoProfileId: 'elena-gracia' });
      router.replace('/onboarding');
    } catch (err) {
      Alert.alert(
        'Failed to open onboarding',
        err instanceof Error ? err.message : String(err),
      );
      setRerunningDemo(false);
    }
  }, [router]);

  const handleImportEhrZip = useCallback(async () => {
    setImportingEhr(true);
    setImportProgress({ done: 0, total: 0 });
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'public.zip-archive', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const fileUri = result.assets[0].uri;
      const fileName = result.assets[0].name ?? 'ehr.zip';
      const summary = await importCdaZip(fileUri, {
        patientId: patientId ?? 'default-patient',
        isNewPatient: true,
        onProgress: (done, total) => setImportProgress({ done, total }),
      });
      refresh();
      audit({
        actor: 'caregiver',
        action: 'cda_zip_import',
        resourceType: 'cda_import',
        resourceId: fileName,
        patientId,
        payload: {
          filesDiscovered: summary.filesDiscovered,
          filesImported: summary.filesImported,
          filesSkipped: summary.filesSkipped,
          totalConditions: summary.totalConditions,
          totalMedications: summary.totalMedications,
          totalVitals: summary.totalVitals,
          totalNarrativeChunks: summary.totalNarrativeChunks,
          elapsedMs: summary.elapsedMs,
        },
      });
      const errorTail = summary.errors.length
        ? `\n\n${summary.errors.length} file(s) failed:\n${summary.errors
            .slice(0, 3)
            .map((e) => `• ${e.file}: ${e.message}`)
            .join('\n')}${summary.errors.length > 3 ? `\n…and ${summary.errors.length - 3} more` : ''}`
        : '';
      Alert.alert(
        'EHR Import Complete',
        `Discovered ${summary.filesDiscovered} CDA documents.\n` +
          `Imported ${summary.filesImported} (skipped ${summary.filesSkipped}).\n\n` +
          `Conditions: ${summary.totalConditions}\n` +
          `Medications: ${summary.totalMedications}\n` +
          `Vitals: ${summary.totalVitals}\n` +
          `Narrative chunks: ${summary.totalNarrativeChunks}\n` +
          `Care plan activities: ${summary.totalCarePlanActivities}\n` +
          `Longitudinal observations: ${summary.totalLongitudinalObservations}\n` +
          `Appointments: ${summary.totalAppointments}\n\n` +
          `Elapsed: ${(summary.elapsedMs / 1000).toFixed(1)}s` +
          errorTail,
      );
    } catch (err) {
      Alert.alert(
        'EHR Import Failed',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setImportingEhr(false);
      setImportProgress({ done: 0, total: 0 });
    }
  }, [patientId, refresh]);

  const handleImportEhrSingleFile = useCallback(async () => {
    setImportingEhr(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const fileUri = result.assets[0].uri;
      const file = new File(fileUri);
      const contents = await file.text();
      const summary = importCdaJsonString(contents, {
        patientId: patientId ?? 'default-patient',
        isNewPatient: true,
      });
      refresh();
      audit({
        actor: 'caregiver',
        action: 'cda_single_import',
        resourceType: 'cda_import',
        resourceId: summary.docId,
        patientId,
        payload: {
          conditions: summary.conditions,
          medications: summary.medications,
          vitals: summary.vitals,
          narrativeChunks: summary.narrativeChunks,
        },
      });
      Alert.alert(
        'CDA Document Imported',
        `${summary.docId}\n\n` +
          `Conditions: ${summary.conditions}\n` +
          `Medications: ${summary.medications}\n` +
          `Vitals: ${summary.vitals}\n` +
          `Narrative chunks: ${summary.narrativeChunks}\n` +
          `Care plan activities: ${summary.carePlanActivities}\n` +
          `Longitudinal observations: ${summary.longitudinalObservations}\n` +
          `Appointments: ${summary.appointments}` +
          (summary.warnings.length ? `\n\nWarnings:\n${summary.warnings.join('\n')}` : ''),
      );
    } catch (err) {
      Alert.alert(
        'CDA Import Failed',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setImportingEhr(false);
    }
  }, [patientId, refresh]);

  const toggleExpanded = useCallback((id: ExpandableId) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/more' as never);
  }, [router]);

  useEffect(() => {
    if (!isDeveloper || !patientId) {
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

  const handleApplyThresholdRec = useCallback((recId: string) => {
    updateThresholdRecommendationStatus(recId, 'applied');
    audit({
      actor: 'caregiver',
      action: 'apply_threshold_recommendation',
      resourceType: 'threshold_recommendation',
      resourceId: recId,
      patientId,
    });
    setRecVersion((version) => version + 1);
  }, [patientId]);

  const handleDismissThresholdRec = useCallback((recId: string) => {
    updateThresholdRecommendationStatus(recId, 'dismissed');
    audit({
      actor: 'caregiver',
      action: 'dismiss_threshold_recommendation',
      resourceType: 'threshold_recommendation',
      resourceId: recId,
      patientId,
    });
    setRecVersion((version) => version + 1);
  }, [patientId]);

  const handleDeleteAll = useCallback(() => {
    const installed = modelQueue.rows.filter((r) => r.status === 'installed');
    if (installed.length === 0) return;
    Alert.alert(
      'Delete All Models',
      `This will remove all ${installed.length} downloaded model(s). ` +
        'At least one Concierge model must stay on this device, so you will need to re-download one before Concierge can run.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: () => {
            if (slm.currentModelId) {
              slm.unloadModel();
            }
            const count = modelQueue.clearAll();
            setDemoDefaultModelId(DEFAULT_SLM_MODEL_ID);
            Alert.alert('Complete', `Removed ${count} model${count !== 1 ? 's' : ''}. Re-download a Concierge model to keep Concierge available.`);
          },
        },
      ],
    );
  }, [slm, modelQueue, setDemoDefaultModelId]);

  return (
    <SafeAreaView style={[styles.safeArea, themedStyles.safeArea]} edges={['top', 'bottom']}>
      <ScrollView
        style={themedStyles.safeArea}
        contentContainerStyle={[styles.content, themedStyles.content]}
      >
        <View style={styles.topBar}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back to settings menu">
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
          <View style={styles.topBarSpacer} />
        </View>

        <ScreenHeader eyebrow="Caregiver Concierge" title="Advanced Developer Settings" />

        <Section title="Existing demo controls">
          <CompactToggleRow
            id="developer-mode"
            emoji="🛠️"
            label="Developer / Demo Mode"
            value={isDeveloper}
            expanded={expandedId === 'developer-mode'}
            explanation="Developer mode reveals diagnostics, model controls, API configuration, and demo routes. Turn it off to return to the caregiver-facing app surface."
            onToggleExpand={toggleExpanded}
            onValueChange={toggleMode}
            accessibilityLabel="Developer or demo mode"
          />

          {isDeveloper ? (
            <View style={styles.devSection}>
              <Text style={[styles.devLabel, themedStyles.devLabel]}>Concierge Management</Text>
              <Text style={[styles.devInfo, themedStyles.devInfo]}>
                Policy: {slm.policy} - Status: {slm.loadStatus}
                {slm.currentModelId ? ` - Model: ${slm.currentModelId}` : ''}
                {slm.modelSizeGB != null ? ` - Size: ${slm.modelSizeGB.toFixed(2)} GB` : ''}
              </Text>
              {slm.loadError ? (
                <Text style={[styles.devInfo, themedStyles.devInfo]}>Load error: {slm.loadError}</Text>
              ) : null}
              <SlmModelCarousel showDelete />
              <View style={styles.modelActions}>
                {MODEL_CATALOG.map((m) => {
                  const row = modelQueue.rows.find((r) => r.id === m.id);
                  const installed = row?.status === 'installed';
                  return (
                    <Pressable
                      key={`load-${m.id}`}
                      style={[styles.smallButton, !installed && styles.disabledButton]}
                      disabled={!installed || slm.loadStatus === 'loading'}
                      onPress={() => slm.loadModel(m.id)}>
                      <Text style={styles.smallButtonText}>Load {m.displayName}</Text>
                    </Pressable>
                  );
                })}
                <Pressable style={[styles.smallButton, styles.dangerSmallButton]} onPress={handleDeleteAll}>
                  <Text style={styles.smallButtonText}>Delete all models</Text>
                </Pressable>
              </View>

              <Text style={[styles.devLabel, themedStyles.devLabel, { marginTop: 8 }]}>Default Concierge model (Demo auto-load)</Text>
              <Text style={[styles.devInfo, themedStyles.devInfo]}>
                The model auto-loaded when a transient task acquires a lease in Demo
                mode. A single installed model is always the default. Currently:{' '}
                {effectiveDefaultModelId}
              </Text>
              <View style={styles.modelActions}>
                {MODEL_CATALOG.map((m) => {
                  const active = effectiveDefaultModelId === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      style={[styles.smallButton, !active && styles.disabledButton]}
                      onPress={() => setDemoDefaultModelId(m.id)}>
                      <Text style={styles.smallButtonText}>
                        {active ? '✓ ' : ''}{m.displayName}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.devLabel, themedStyles.devLabel, { marginTop: 12 }]}>Runtime gates</Text>
              <CompactToggleRow
                id="dynamic-slm-loading"
                emoji=""
                label="Dynamic SLM loading"
                value={settings.dynamicSlmLoading !== false}
                expanded={expandedId === 'dynamic-slm-loading'}
                explanation="Loads Concierge only while a chat, explanation, or warmup lease needs it, then releases the model after the task window."
                onToggleExpand={toggleExpanded}
                onValueChange={setDynamicSlmLoading}
                accessibilityLabel="Dynamic SLM loading"
              />
              <CompactToggleRow
                id="concierge-reasoning"
                emoji=""
                label="Concierge reasoning"
                value={settings.conciergeReasoning !== 'off'}
                expanded={expandedId === 'concierge-reasoning'}
                explanation="ON: the NLU decides per turn — simple intents answer directly (no-think), clinical or uncertain turns reason first (LFM2.5 / Bonsai get a no-think chat template on fast turns; Gemma toggles its think channel). OFF: force direct answers on every turn — faster, but lower quality on complex clinical questions."
                onToggleExpand={toggleExpanded}
                onValueChange={(enabled) => setConciergeReasoning(enabled ? 'auto' : 'off')}
                accessibilityLabel="Concierge reasoning"
              />
              <CompactToggleRow
                id="nlu-development-fallback"
                emoji=""
                label="Development NLU fallback"
                value={settings.nluDevelopmentFallback === true}
                expanded={expandedId === 'nlu-development-fallback'}
                explanation="__DEV__ only. Allows synthetic hash embeddings and keyword intent fallback when native NLU assets are absent; production treats NLU as unavailable."
                onToggleExpand={toggleExpanded}
                onValueChange={setNluDevelopmentFallback}
                accessibilityLabel="Development NLU fallback"
              />
              <CompactToggleRow
                id="evidence-development-fallback"
                emoji=""
                label="Development evidence fixtures"
                value={settings.evidenceDevelopmentFallback === true}
                expanded={expandedId === 'evidence-development-fallback'}
                explanation="__DEV__ only. Includes bundled synthetic evidence fixtures in the retrieval index for local development; normal retrieval uses persisted or live-approved evidence."
                onToggleExpand={toggleExpanded}
                onValueChange={setEvidenceDevelopmentFallback}
                accessibilityLabel="Development evidence fixtures"
              />
              <CompactToggleRow
                id="simulate-missing-optional-features"
                emoji=""
                label="Simulate missing Concierge / knowledge"
                value={settings.simulateMissingOptionalFeatures === true}
                expanded={expandedId === 'simulate-missing-optional-features'}
                explanation="Synthetically reports the on-device Concierge model and clinical knowledge cache as not downloaded, so the optional-feature prompt and greyed-out surfaces can be tested without removing any downloads."
                onToggleExpand={toggleExpanded}
                onValueChange={setSimulateMissingOptionalFeatures}
                accessibilityLabel="Simulate missing Concierge and knowledge"
              />
              <CompactToggleRow
                id="knowledge-graph-expansion"
                emoji=""
                label="Evidence graph expansion"
                value={settings.knowledgeGraphExpansion === true}
                expanded={expandedId === 'knowledge-graph-expansion'}
                explanation="Adds one-hop evidence-graph neighbors into retrieval ranking over the on-device pack and patient overlay. Defaults on with the knowledge pack."
                onToggleExpand={toggleExpanded}
                onValueChange={setKnowledgeGraphExpansion}
                accessibilityLabel="Evidence graph expansion"
              />
              <CompactToggleRow
                id="live-clinical-fetch"
                emoji=""
                label="Live clinical evidence (NLM)"
                value={settings.liveClinicalFetch !== false}
                expanded={expandedId === 'live-clinical-fetch'}
                explanation="Default on. Knowledge pack install (including first onboarding Device setup) hits live MedlinePlus, DailyMed, RxNorm, and PubMed lit_lite when online; layers soft-fall back to offline digests on failure. Wi‑Fi recommended. Optional NCBI key below raises PubMed rate limits. After changing, tap Redownload on Clinical knowledge."
                onToggleExpand={toggleExpanded}
                onValueChange={setLiveClinicalFetch}
                accessibilityLabel="Live clinical evidence NLM fetch"
              />

              <Pressable
                style={[styles.actionButton, styles.unloadButton, !slm.currentModelId && styles.disabledActionButton, !slm.currentModelId && themedStyles.disabledActionButton]}
                disabled={!slm.currentModelId}
                onPress={() => slm.unloadModel()}>
                <Text style={styles.actionButtonText}>Unload Model</Text>
              </Pressable>

              <Pressable
                style={[styles.actionButton, styles.dangerButton]}
                onPress={handleDeleteAll}>
                <Text style={styles.actionButtonText}>Delete All Models</Text>
              </Pressable>

              <View style={styles.ramBlock}>
                <Text style={[styles.devLabel, themedStyles.devLabel]}>Device RAM</Text>
                {hasNativeMemory && memoryInfo ? (
                  <>
                    <Text style={[styles.devInfo, themedStyles.devInfo]}>
                      {memoryInfo.usedMB.toFixed(0)} / {memoryInfo.totalMB.toFixed(0)} MB used
                      {' · '}Free: {memoryInfo.freeMB.toFixed(0)} MB
                      {' · '}App: {memoryInfo.appMB.toFixed(0)} MB
                      {slm.modelSizeGB != null
                        ? ` · Model: ${slm.modelSizeGB.toFixed(2)} GB`
                        : ''}
                    </Text>
                    <View style={[styles.progressBar, themedStyles.progressBar]}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${Math.min((memoryInfo.usedMB / memoryInfo.totalMB) * 100, 100)}%`,
                          },
                          memoryInfo.usedMB / memoryInfo.totalMB > 0.8 && styles.progressFillHot,
                        ]}
                      />
                    </View>
                  </>
                ) : (
                  <Text style={[styles.devInfo, themedStyles.devInfo]}>
                    RAM measurement unavailable in this build. Concierge loads on demand with
                    conservative cleanup.
                  </Text>
                )}
              </View>

              <Pressable
                style={styles.actionButton}
                onPress={() => router.push('/performance')}>
                <Text style={styles.actionButtonText}>Performance / RAM Dashboard</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={() => router.push('/care-management')}>
                <Text style={styles.actionButtonText}>Developer: ML Care Analysis</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={() => router.push('/acute-anomaly')}>
                <Text style={styles.actionButtonText}>Developer: Acute Anomaly Demo</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={() => router.push('/health-monitor-demo')}>
                <Text style={styles.actionButtonText}>Developer: Health Monitor Playground</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={() => router.push('/messaging-demo')}>
                <Text style={styles.actionButtonText}>Messaging Demo</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={() => router.push('/slm')}>
                <Text style={styles.actionButtonText}>Raw Concierge Chat</Text>
              </Pressable>

              <Text style={[styles.devLabel, themedStyles.devLabel, { marginTop: 16 }]}>Clinical Evidence API Keys</Text>
              <Text style={[styles.devInfo, themedStyles.devInfo]}>
                Optional. PubMed uses an NCBI key for higher rate limits. OpenFDA
                uses a key for higher rate limits.
              </Text>

              <View style={styles.keyLabelRow}>
                <Text style={[styles.devLabel, themedStyles.devLabel, { marginTop: 8 }]}>NCBI API Key (PubMed)</Text>
                <Text style={[styles.keyStatusBadge, ncbiKeyStored ? styles.keyStatusStored : styles.keyStatusEmpty, ncbiKeyStored ? themedStyles.keyStatusStored : themedStyles.keyStatusEmpty]}>
                  {ncbiKeyStored ? 'stored' : 'empty'}
                </Text>
              </View>
              <View style={styles.modelRow}>
                <View style={[styles.modelItem, themedStyles.modelItem]}>
                  <TextInput
                    style={[styles.ncbiInput, themedStyles.ncbiInput]}
                    value={ncbiKeyInput}
                    onChangeText={setNcbiKeyInput}
                    placeholder="Enter NCBI API key..."
                    placeholderTextColor={developerPlaceholderColor}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <View style={styles.modelActions}>
                    <Pressable
                      style={styles.smallButton}
                      onPress={async () => {
                        await setNcbiApiKey(ncbiKeyInput.trim());
                        setNcbiKeyInput('');
                        await refreshKeyStatus();
                        Alert.alert('Saved', 'NCBI API key stored securely.');
                      }}>
                      <Text style={styles.smallButtonText}>Save Key</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.smallButton, styles.dangerSmallButton]}
                      onPress={async () => {
                        await clearNcbiApiKey();
                        setNcbiKeyInput('');
                        await refreshKeyStatus();
                        Alert.alert('Cleared', 'NCBI API key removed.');
                      }}>
                      <Text style={styles.smallButtonText}>Clear</Text>
                    </Pressable>
                  </View>
                </View>
              </View>

              <View style={styles.keyLabelRow}>
                <Text style={[styles.devLabel, themedStyles.devLabel, { marginTop: 8 }]}>OpenFDA API Key</Text>
                <Text style={[styles.keyStatusBadge, openfdaKeyStored ? styles.keyStatusStored : styles.keyStatusEmpty, openfdaKeyStored ? themedStyles.keyStatusStored : themedStyles.keyStatusEmpty]}>
                  {openfdaKeyStored ? 'stored' : 'empty'}
                </Text>
              </View>
              <View style={styles.modelRow}>
                <View style={[styles.modelItem, themedStyles.modelItem]}>
                  <TextInput
                    style={[styles.ncbiInput, themedStyles.ncbiInput]}
                    value={openfdaKeyInput}
                    onChangeText={setOpenfdaKeyInput}
                    placeholder="Enter OpenFDA API key..."
                    placeholderTextColor={developerPlaceholderColor}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <View style={styles.modelActions}>
                    <Pressable
                      style={styles.smallButton}
                      onPress={async () => {
                        await setOpenFdaApiKey(openfdaKeyInput.trim());
                        setOpenfdaKeyInput('');
                        await refreshKeyStatus();
                        Alert.alert('Saved', 'OpenFDA API key stored securely.');
                      }}>
                      <Text style={styles.smallButtonText}>Save Key</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.smallButton, styles.dangerSmallButton]}
                      onPress={async () => {
                        await clearOpenFdaApiKey();
                        setOpenfdaKeyInput('');
                        await refreshKeyStatus();
                        Alert.alert('Cleared', 'OpenFDA API key removed.');
                      }}>
                      <Text style={styles.smallButtonText}>Clear</Text>
                    </Pressable>
                  </View>
                </View>
              </View>

              <Text style={[styles.devLabel, themedStyles.devLabel, { marginTop: 16 }]}>Clinical knowledge</Text>
              <Text style={[styles.devInfo, themedStyles.devInfo]}>
                Device pack is global (one copy). Patient overlay holds CDA/ADCP/on-demand
                meds only and is never wiped by pack reset.
              </Text>
              <KnowledgePackProgressCard
                showUpdateReset
                runnerOptions={{
                  conditions: (snapshot?.conditions ?? [])
                    .map((c) => c.name)
                    .filter(Boolean),
                  medications: (snapshot?.medications ?? [])
                    .map((m) => m.name)
                    .filter(Boolean),
                  location: snapshot?.patient?.location,
                }}
              />
              <Text style={[styles.devInfo, themedStyles.devInfo]}>
                Patient overlay chunks: {snapshot?.knowledgeStats.total ?? 0}
                {snapshot && snapshot.knowledgeStats.total > 0
                  ? Object.entries(snapshot.knowledgeStats.bySource)
                    .map(([src, count]) => `\n  ${src}: ${count}`)
                    .join('')
                  : ''}
              </Text>
              {patientId && (snapshot?.knowledgeStats.total ?? 0) > 0 ? (
                <Pressable
                  style={[styles.actionButton, styles.dangerButton]}
                  onPress={() => {
                    const n = clearKnowledgeCacheForPatient(patientId);
                    refresh();
                    Alert.alert(
                      'Cleared patient overlay',
                      `Removed ${n} overlay chunk${n === 1 ? '' : 's'} for this patient. Device pack unchanged.`,
                    );
                  }}>
                  <Text style={styles.actionButtonText}>
                    Clear patient evidence overlay
                  </Text>
                </Pressable>
              ) : null}
              {__DEV__ ? (
                <Pressable
                  style={[styles.actionButton, styles.dangerButton]}
                  onPress={() => {
                    Alert.alert(
                      'Clear ALL patients’ overlays?',
                      'Wipes every profile’s knowledge_cache overlay. Does not delete the device clinical pack.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Clear all overlays',
                          style: 'destructive',
                          onPress: () => {
                            clearKnowledgeCache();
                            refresh();
                            Alert.alert('Cleared', 'All patients’ knowledge overlays wiped.');
                          },
                        },
                      ],
                    );
                  }}>
                  <Text style={styles.actionButtonText}>
                    Clear ALL patient overlays (dev)
                  </Text>
                </Pressable>
              ) : null}

              <KnowledgeCacheViewer patientId={patientId} />

              <View style={[styles.thresholdBlock, themedStyles.thresholdBlock]}>
                <Text style={[styles.thresholdTitle, themedStyles.thresholdTitle]}>
                  Threshold personalization
                </Text>
                <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>
                  Queued anomaly-threshold suggestions. Apply or dismiss;
                  applying audits the change.
                </Text>
                {thresholdRecs.length === 0 ? (
                  <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>
                    No pending recommendations.
                  </Text>
                ) : (
                  thresholdRecs.map((rec) => (
                    <View key={rec.recommendationId} style={styles.thresholdRow}>
                      <View style={styles.thresholdTextBlock}>
                        <Text style={[styles.thresholdValue, themedStyles.thresholdValue]}>
                          Recommended threshold:{' '}
                          {rec.recommendedThreshold.toFixed(3)}
                          {rec.adjustmentPct !== undefined
                            ? ` (${rec.adjustmentPct > 0 ? '+' : ''}${rec.adjustmentPct.toFixed(1)}%)`
                            : ''}
                        </Text>
                        {rec.reason ? (
                          <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>{rec.reason}</Text>
                        ) : null}
                      </View>
                      <Pressable
                        style={[styles.thresholdBtn, styles.thresholdApplyBtn]}
                        onPress={() => handleApplyThresholdRec(rec.recommendationId)}
                      >
                        <Text style={styles.thresholdBtnText}>Apply</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.thresholdBtn, styles.thresholdDismissBtn, themedStyles.thresholdDismissBtn]}
                        onPress={() => handleDismissThresholdRec(rec.recommendationId)}
                      >
                        <Text style={styles.thresholdBtnText}>Dismiss</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </View>

              <Text style={[styles.devLabel, themedStyles.devLabel, { marginTop: 16 }]}>Import Record</Text>
              <Text style={[styles.devInfo, themedStyles.devInfo]}>
                Import a zip of standardized CDA JSON files (the
                Sahlin longitudinal EHR dataset), a single CDA JSON, or a
                FHIR JSON bundle. Conditions are SNOMED-coded and
                cross-walked to ICD-10; narrative sections become
                SLM-retrievable knowledge chunks. See planning/33 for the
                full pipeline.
              </Text>
              <Pressable
                style={[styles.actionButton, importingEhr && styles.disabledActionButton, importingEhr && themedStyles.disabledActionButton]}
                disabled={importingEhr}
                onPress={handleImportEhrZip}>
                <Text style={styles.actionButtonText}>
                  {importingEhr
                    ? `Importing EHR… ${importProgress.done}/${importProgress.total}`
                    : 'Import EHR (zip of CDA JSON)'}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, importingEhr && styles.disabledActionButton, importingEhr && themedStyles.disabledActionButton]}
                disabled={importingEhr}
                onPress={handleImportEhrSingleFile}>
                <Text style={styles.actionButtonText}>
                  {importingEhr ? 'Importing…' : 'Import single CDA JSON'}
                </Text>
              </Pressable>

              <Text style={[styles.devLabel, themedStyles.devLabel, { marginTop: 16 }]}>Demo Data</Text>
              <Text style={[styles.devInfo, themedStyles.devInfo]}>
                Re-open the onboarding wizard with Elena (ST-03: COPD + TBI)
                pre-selected. Clears the completed-onboarding gate so the
                wizard shows again; finish Device setup to seed Home.
              </Text>
              <Pressable
                style={[styles.actionButton, rerunningDemo && styles.disabledActionButton, rerunningDemo && themedStyles.disabledActionButton]}
                disabled={rerunningDemo}
                onPress={handleRerunElenaDemo}
              >
                <Text style={styles.actionButtonText}>
                  {rerunningDemo ? 'Opening onboarding…' : 'Re-run onboarding with Elena Garcia demo'}
                </Text>
              </Pressable>

              <Pressable
                style={[styles.actionButton, styles.dangerButton]}
                onPress={() => {
                  Alert.alert(
                    'Reset All Data',
                    'This will erase patient data, alerts, medications, and settings. Continue?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Reset',
                        style: 'destructive',
                        onPress: () => {
                          resetDatabase();
                          Alert.alert('Reset Complete', 'All data has been erased.');
                        },
                      },
                    ],
                  );
                }}>
                <Text style={styles.actionButtonText}>Reset All Data</Text>
              </Pressable>

              <AuditViewer patientId={patientId} />
            </View>
          ) : null}
        </Section>

        {__DEV__ && isDeveloper ? (
          <Section title="UC3 exercise assignment">
            <View style={styles.devSection}>
              {!patientRecordPatientId || !snapshot?.patient ? (
                <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>No active patient selected.</Text>
              ) : !activeCarePlan ? (
                <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>No active CarePlan available.</Text>
              ) : !uc3ExerciseAssignmentEligible ? (
                <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>
                  Active patient is not eligible for UC3 stroke rehabilitation exercise assignment.
                </Text>
              ) : (
                <>
                  <Text style={[styles.devInfo, themedStyles.devInfo]}>
                    Development-only assignments for the active patient and active CarePlan.
                  </Text>
                  {DEVELOPMENT_UC3_REHAB_EXERCISES.map((exercise) => (
                    <View key={exercise.key} style={styles.inlineControlRow}>
                      <Text style={[styles.inlineControlLabel, themedStyles.inlineControlLabel]}>{exercise.label}</Text>
                      <Switch
                        value={assignedExerciseKeySet.has(exercise.key)}
                        onValueChange={() => handleUc3ExerciseAssignmentToggle(exercise.key)}
                        trackColor={{ false: theme.appBorder, true: AppTheme.colors.brandSoft }}
                        thumbColor={
                          assignedExerciseKeySet.has(exercise.key)
                            ? AppTheme.colors.brand
                            : theme.appSurface
                        }
                        accessibilityRole="switch"
                        accessibilityLabel={exercise.label}
                        accessibilityState={{ checked: assignedExerciseKeySet.has(exercise.key) }}
                      />
                    </View>
                  ))}
                </>
              )}
              <Pressable
                style={[
                  styles.actionButton,
                  runningUc3Evaluation && styles.disabledActionButton,
                  runningUc3Evaluation && themedStyles.disabledActionButton,
                ]}
                onPress={handleRunUc3Evaluation}
                disabled={runningUc3Evaluation}
                accessibilityRole="button"
                accessibilityLabel="Run UC3 evaluation"
              >
                <Text style={styles.actionButtonText}>Run UC3 evaluation</Text>
              </Pressable>
              {uc3EvaluationStatus ? (
                <View style={[styles.uc3EvaluationStatusCard, themedStyles.uc3EvaluationStatusCard]}>
                  <Text style={[styles.uc3EvaluationStatusTitle, themedStyles.uc3EvaluationStatusTitle]}>
                    {uc3EvaluationStatus.title}
                  </Text>
                  {uc3EvaluationStatus.lines.map((line) => (
                    <Text key={line} style={[styles.uc3EvaluationStatusLine, themedStyles.uc3EvaluationStatusLine]}>
                      {line}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          </Section>
        ) : null}

        {__DEV__ && isDeveloper ? (
          <Section title="UC4 priority evaluation">
            <View style={styles.devSection}>
              <Text style={[styles.devInfo, themedStyles.devInfo]}>
                Development-only manual run for the active patient. UC4 cards stay separate from emergency alerts.
              </Text>
              <Pressable
                style={[
                  styles.actionButton,
                  runningUc4Evaluation && styles.disabledActionButton,
                  runningUc4Evaluation && themedStyles.disabledActionButton,
                ]}
                onPress={handleRunUc4Evaluation}
                disabled={runningUc4Evaluation}
                accessibilityRole="button"
                accessibilityLabel="Run UC4 evaluation"
              >
                <Text style={styles.actionButtonText}>Run UC4 evaluation</Text>
              </Pressable>
              {uc4EvaluationStatus ? (
                <View style={[styles.uc3EvaluationStatusCard, themedStyles.uc3EvaluationStatusCard]}>
                  <Text style={[styles.uc3EvaluationStatusTitle, themedStyles.uc3EvaluationStatusTitle]}>
                    {uc4EvaluationStatus.title}
                  </Text>
                  {uc4EvaluationStatus.lines.map((line) => (
                    <Text key={line} style={[styles.uc3EvaluationStatusLine, themedStyles.uc3EvaluationStatusLine]}>
                      {line}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          </Section>
        ) : null}

        {isDeveloper ? (
          <Section title="Diagnosis curation">
            <DiagnosisCurationSettings
              patientId={patientRecordPatientId ?? ''}
              snapshot={snapshot}
              mutatePatientRecord={mutatePatientRecord}
            />
          </Section>
        ) : null}

        {isDeveloper ? (
          <Section title="Simulate care-team-required confirmation">
            <DemoMedicationConfirmationSettings
              patientId={patientRecordPatientId ?? ''}
              snapshot={snapshot}
              mutatePatientRecord={mutatePatientRecord}
            />
          </Section>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DiagnosisCurationSettings({
  patientId,
  snapshot,
  mutatePatientRecord,
}: {
  patientId: string;
  snapshot: ReturnType<typeof usePatientRecord>['snapshot'];
  mutatePatientRecord: ReturnType<typeof usePatientRecord>['mutatePatientRecord'];
}) {
  const conditions = snapshot?.conditions ?? EMPTY_CONDITIONS;
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const [primaryConditionId, setPrimaryConditionId] = useState<string | null>(null);
  const [activeConditionIds, setActiveConditionIds] = useState<string[]>([]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setPrimaryConditionId(
        conditions.find((condition) => condition.conditionRole === 'primary_diagnosis')?.conditionId ??
          snapshot?.primaryCondition?.conditionId ??
          null,
      );
      setActiveConditionIds(
        conditions
          .filter((condition) => condition.conditionRole === 'active_comorbidity')
          .map((condition) => condition.conditionId),
      );
    }, 0);

    return () => clearTimeout(handle);
  }, [conditions, snapshot?.primaryCondition?.conditionId]);

  if (!patientId || !snapshot?.patient) {
    return (
      <View style={styles.devSection}>
        <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>No active patient selected.</Text>
      </View>
    );
  }

  const toggleActiveCondition = (conditionId: string) => {
    setActiveConditionIds((current) => {
      if (current.includes(conditionId)) {
        return current.filter((id) => id !== conditionId);
      }
      return [...current, conditionId].filter((id) => id !== primaryConditionId);
    });
  };

  const handlePrimaryChange = (conditionId: string) => {
    setPrimaryConditionId(conditionId);
    setActiveConditionIds((current) => current.filter((id) => id !== conditionId));
  };

  const applyMikePreset = () => {
    const primary = conditions.find((condition) => condition.name === 'Cerebral Palsy');
    const activeNames = new Set([
      'Contracture',
      'Scoliosis',
      'Constipation',
      'Dysphagia',
      'Esophagitis',
      'Epilepsy',
    ]);
    setPrimaryConditionId(primary?.conditionId ?? null);
    setActiveConditionIds(
      conditions
        .filter((condition) => activeNames.has(condition.name))
        .map((condition) => condition.conditionId),
    );
  };

  const handleSave = () => {
    if (!primaryConditionId) {
      Alert.alert('Primary diagnosis required', 'Choose one primary diagnosis before saving.');
      return;
    }

    const activeIds = activeConditionIds.filter((id) => id !== primaryConditionId);
    const rolesByConditionId = conditions.reduce<Record<string, PatientConditionRole>>(
      (roles, condition) => {
        roles[condition.conditionId] = 'history_context';
        return roles;
      },
      {},
    );
    rolesByConditionId[primaryConditionId] = 'primary_diagnosis';
    for (const conditionId of activeIds) {
      rolesByConditionId[conditionId] = 'active_comorbidity';
    }

    void mutatePatientRecord((latestSnapshot) => {
      if (latestSnapshot.patient?.patientId !== patientId) {
        throw new Error(`Cannot update diagnosis roles for inactive patient: ${patientId}`);
      }
      return patchConditionRoles(latestSnapshot, rolesByConditionId);
    }, () => {
      updatePatientConditionRoles(patientId, rolesByConditionId);
    }).then(() => {
      Alert.alert('Saved', 'Diagnosis roles updated for the active patient.');
    }).catch(reportAdvancedSettingsSaveFailure);
  };

  return (
    <View style={styles.devSection}>
      <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>
        Choose the app-level primary diagnosis and active comorbidities. Unselected conditions are saved as history context.
      </Text>

      {conditions.length === 0 ? (
        <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>No conditions available.</Text>
      ) : (
        <>
          <View style={styles.modelActions}>
            <Pressable style={styles.smallButton} onPress={applyMikePreset}>
              <Text style={styles.smallButtonText}>Apply Mike suggestion</Text>
            </Pressable>
            <Pressable style={styles.smallButton} onPress={handleSave}>
              <Text style={styles.smallButtonText}>Save diagnosis roles</Text>
            </Pressable>
          </View>

          {conditions.map((condition) => {
            const sourceSummary = formatConditionSourceSummary(condition);
            const isPrimary = primaryConditionId === condition.conditionId;
            const isActive = activeConditionIds.includes(condition.conditionId);

            return (
              <View key={condition.conditionId} style={[styles.conditionRoleRow, themedStyles.conditionRoleRow]}>
                <View style={styles.thresholdTextBlock}>
                  <Text style={[styles.thresholdValue, themedStyles.thresholdValue]}>{condition.name}</Text>
                  <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>
                    {sourceSummary || 'Source timing unavailable'}
                  </Text>
                </View>
                <View style={styles.conditionRoleActions}>
                  <Pressable
                    style={[styles.roleButton, themedStyles.roleButton, isPrimary && styles.roleButtonActive]}
                    onPress={() => handlePrimaryChange(condition.conditionId)}
                  >
                    <Text style={[styles.roleButtonText, themedStyles.roleButtonText, isPrimary && styles.roleButtonTextActive]}>
                      Primary
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.roleButton,
                      themedStyles.roleButton,
                      isActive && styles.roleButtonActive,
                      isPrimary && styles.disabledButton,
                    ]}
                    disabled={isPrimary}
                    onPress={() => toggleActiveCondition(condition.conditionId)}
                  >
                    <Text style={[styles.roleButtonText, themedStyles.roleButtonText, isActive && styles.roleButtonTextActive]}>
                      Active
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

function formatConditionSourceSummary(condition: PatientCondition): string | null {
  const references = condition.sourceReferences ?? [];
  const source = references.reduce<NonNullable<PatientCondition['sourceReferences']>[number] | null>(
    (latest, reference) => {
      if (!latest) return reference;
      return (reference.daysFromFirstVisit ?? -1) > (latest.daysFromFirstVisit ?? -1)
        ? reference
        : latest;
    },
    null,
  );
  if (!source) return null;

  return [
    source.sourceFile,
    source.visitIndex !== undefined ? `visit ${source.visitIndex}` : null,
    source.daysBeforeLatestVisit !== undefined
      ? `${source.daysBeforeLatestVisit} days before latest`
      : null,
  ].filter(Boolean).join(' - ');
}

function reportAdvancedSettingsSaveFailure(error: unknown): void {
  console.error('[AdvancedSettings] Patient selection update failed:', error);
  Alert.alert('Save failed', error instanceof Error ? error.message : String(error));
}

function patchMedicationRequirement(snapshot: PatientRecordSnapshot, medicationId: string, enabled: boolean): PatientRecordSnapshot {
  const requirements = { ...snapshot.medicationConfirmationRequirements };
  if (!enabled) delete requirements[medicationId];
  else {
    const now = new Date().toISOString();
    requirements[medicationId] = {
      patientId: snapshot.patient?.patientId ?? '', medicationId, confirmationRequirement: 'required',
      requirementSource: 'demo_override', createdAt: requirements[medicationId]?.createdAt ?? now, updatedAt: now,
    };
  }
  return { ...snapshot, medicationConfirmationRequirements: requirements };
}

function patchConditionRoles(snapshot: PatientRecordSnapshot, rolesByConditionId: Record<string, PatientConditionRole>): PatientRecordSnapshot {
  const conditions = snapshot.conditions.map((condition) => {
    const conditionRole = rolesByConditionId[condition.conditionId] ?? 'history_context';
    return { ...condition, conditionRole, isPrimary: conditionRole === 'primary_diagnosis' };
  });
  const primaryCondition = conditions.find((condition) => condition.conditionRole === 'primary_diagnosis') ?? null;
  const activeOrder = ['contracture', 'scoliosis', 'constipation', 'dysphagia', 'esophagitis', 'epilepsy'];
  const comorbidities = conditions
    .filter((condition) => condition.conditionRole === 'active_comorbidity')
    .sort((a, b) => (activeOrder.indexOf(a.name.toLowerCase()) + 1 || Number.MAX_SAFE_INTEGER) -
      (activeOrder.indexOf(b.name.toLowerCase()) + 1 || Number.MAX_SAFE_INTEGER));
  const pendingReviewConditions = conditions.filter((condition) =>
    condition.needsReview && condition.conditionId !== primaryCondition?.conditionId);
  return { ...snapshot, conditions, primaryCondition, comorbidities, pendingReviewConditions };
}

function patchRehabAssignments(snapshot: PatientRecordSnapshot, carePlanId: string, activeKeys: readonly RehabExerciseKey[]): PatientRecordSnapshot {
  const now = new Date().toISOString();
  const existingAssignments = new Map(
    snapshot.rehabExerciseAssignments.map((assignment) => [assignment.exerciseKey, assignment]),
  );
  const rehabExerciseAssignments = DEVELOPMENT_UC3_REHAB_EXERCISES
    .filter((exercise) => activeKeys.includes(exercise.key))
    .map((exercise) => {
      const existing = existingAssignments.get(exercise.key);
      return {
        patientId: snapshot.patient?.patientId ?? '', carePlanId, exerciseKey: exercise.key, active: true,
        source: existing?.source ?? 'developer_uc3_v2' as const, createdAt: existing?.createdAt ?? now, updatedAt: now,
      };
    });
  const todayDailyCareEntry = snapshot.todayDailyCareEntry
    ? {
        ...snapshot.todayDailyCareEntry,
        completedExerciseKeys: filterCompletedExerciseKeysForAssignments(
          snapshot.todayDailyCareEntry.completedExerciseKeys,
          rehabExerciseAssignments,
        ),
      }
    : null;
  return {
    ...snapshot,
    rehabExerciseAssignments,
    todayDailyCareEntry,
    rehabDailyEntries: todayDailyCareEntry
      ? snapshot.rehabDailyEntries.map((entry) =>
          entry.entryDate === todayDailyCareEntry.entryDate ? todayDailyCareEntry : entry,
        )
      : snapshot.rehabDailyEntries,
  };
}

function DemoMedicationConfirmationSettings({
  patientId,
  snapshot,
  mutatePatientRecord,
}: {
  patientId: string;
  snapshot: ReturnType<typeof usePatientRecord>['snapshot'];
  mutatePatientRecord: ReturnType<typeof usePatientRecord>['mutatePatientRecord'];
}) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  if (!patientId || !snapshot?.patient) {
    return (
      <View style={styles.devSection}>
        <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>
          For demonstration only. Select medications that should behave as if confirmation was required by the patient&apos;s care team.
        </Text>
        <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>No active patient selected</Text>
      </View>
    );
  }

  const requirements = snapshot.medicationConfirmationRequirements;
  if (!requirements) {
    return (
      <View style={styles.devSection}>
        <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>
          For demonstration only. Select medications that should behave as if confirmation was required by the patient&apos;s care team.
        </Text>
        <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>Medication confirmation requirements unavailable</Text>
      </View>
    );
  }

  const importedMedications = snapshot.medications.filter((medication) => medication.source === 'fhir');

  const handleToggle = (medicationId: string, enabled: boolean) => {
    void mutatePatientRecord((latestSnapshot) => {
      if (latestSnapshot.patient?.patientId !== patientId) {
        throw new Error(`Cannot update medication confirmation for inactive patient: ${patientId}`);
      }
      return patchMedicationRequirement(latestSnapshot, medicationId, enabled);
    }, () => {
      if (enabled) setDemoMedicationConfirmationRequired(patientId, medicationId);
      else removeDemoMedicationConfirmationRequirement(patientId, medicationId);
    }).catch(reportAdvancedSettingsSaveFailure);
  };

  return (
    <View style={styles.devSection}>
      <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>
        For demonstration only. Select medications that should behave as if confirmation was required by the patient&apos;s care team.
      </Text>
      {importedMedications.length === 0 ? (
        <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>No medications provided</Text>
      ) : (
        importedMedications.map((medication) => {
          const requirement = requirements[medication.medicationId];
          const isRequired = requirement?.confirmationRequirement === 'required';
          const isDemoOverride = requirement?.requirementSource === 'demo_override';
          const lockedByNonDemoSource = Boolean(requirement?.requirementSource && !isDemoOverride);
          const detail = [medication.dosage, medication.frequency].filter(Boolean).join(' - ');

          return (
            <View key={medication.medicationId} style={styles.medRequirementRow}>
              <View style={styles.thresholdTextBlock}>
                <Text style={[styles.thresholdValue, themedStyles.thresholdValue]}>{medication.name}</Text>
                <Text style={[styles.thresholdMuted, themedStyles.thresholdMuted]}>
                  {detail || 'Medication details not provided'}
                </Text>
              </View>
              <Switch
                value={isRequired}
                disabled={lockedByNonDemoSource}
                onValueChange={(enabled) => handleToggle(medication.medicationId, enabled)}
                trackColor={{ false: theme.appBorder, true: AppTheme.colors.brandSoft }}
                thumbColor={isRequired ? AppTheme.colors.brand : theme.appSurface}
                accessibilityRole="switch"
                accessibilityLabel={`Simulate care-team-required confirmation for ${medication.name}`}
                accessibilityState={{ checked: isRequired, disabled: lockedByNonDemoSource }}
              />
            </View>
          );
        })
      )}
    </View>
  );
}

function ConsentManagement({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const [consents, setConsents] = useState<ConsentToken[]>(() => getActiveConsents(patientId));
  const consentScopes = ['location_access'] as const;

  const handleToggle = useCallback((scope: string, granted: boolean) => {
    if (granted) {
      grantConsent(patientId, scope as any);
    } else {
      revokeConsentAndAudit(patientId, scope as any);
    }
    setConsents(getActiveConsents(patientId));
  }, [patientId]);

  return (
    <View>
      {consentScopes.map((scope) => {
        const active = consents.some((c) => c.scope === scope);
        return (
          <CompactToggleRow
            key={scope}
            id={`consent-${scope}` as ExpandableId}
            emoji="📍"
            label={t('settings.consent.locationAccess')}
            value={active}
            expanded={false}
            onToggleExpand={() => {}}
            onValueChange={(v) => handleToggle(scope, v)}
            accessibilityHint={t('settings.consent.locationAccessHint')}
            localizeAccessibility
          />
        );
      })}
    </View>
  );
}

function formatLocalizedMessage(message: LocalizedMessage, t: TranslateFn): string {
  if ('text' in message) return message.text;
  return t(message.key, message.params);
}

function YourDecisionsSection({ patientId, locale }: { patientId: string; locale: string }) {
  const themedStyles = createThemedStyles(useTheme());
  const { t } = useTranslation();
  const [decisions, setDecisions] = useState<AuditLogEntry[]>(() => {
    if (!patientId) return [];
    try {
      return getAuditEntriesForResource('caregiver_action', patientId, 10);
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (!patientId) return;
    const handle = setTimeout(() => {
      try {
        const entries = getAuditEntriesForResource('caregiver_action', patientId, 10);
        setDecisions(entries);
      } catch {
        // ignore — audit may not be initialized
      }
    }, 0);
    return () => clearTimeout(handle);
  }, [patientId]);

  if (decisions.length === 0) return null;

  return (
    <Section title={t('settings.decisions.title')}>
      <View style={styles.subsection}>
        {decisions.map((d, i) => (
          <View key={`${d.resourceId ?? d.auditId}-${i}`} style={[styles.decisionRow, themedStyles.divider]}>
            <Text style={[styles.decisionAction, themedStyles.primaryText]}>
              {d.action === 'override'
                ? t('settings.decisions.youOverrode')
                : d.action === 'confirm'
                  ? t('settings.decisions.youConfirmed')
                  : t('settings.decisions.youAction', { action: d.action })}
            </Text>
            <Text style={[styles.decisionTime, themedStyles.secondaryText]}>
              {d.createdAt
                ? new Date(d.createdAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
                : ''}
            </Text>
          </View>
        ))}
      </View>
    </Section>
  );
}

function AuditViewer({ patientId }: { patientId: string }) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<{ auditId: string; actor: string; action: string; resourceType: string; createdAt: string; hashChain: string }[]>([]);
  const [chainOk, setChainOk] = useState<boolean | null>(null);

  const loadEntries = useCallback(() => {
    const result = verifyAuditChain();
    setChainOk(result.ok);
    const rows = getAuditEntriesForResource('alert', undefined, 50).map((e) => ({
      auditId: e.auditId,
      actor: e.actor,
      action: e.action,
      resourceType: e.resourceType,
      createdAt: e.createdAt,
      hashChain: e.hashChain,
    }));
    setEntries(rows);
    setExpanded(true);
  }, []);

  const closeViewer = useCallback(() => {
    setExpanded(false);
    setEntries([]);
    setChainOk(null);
  }, []);

  return (
    <View>
      {!expanded ? (
        <Pressable style={styles.actionButton} onPress={loadEntries}>
          <Text style={styles.actionButtonText}>View Audit Log</Text>
        </Pressable>
      ) : (
        <Pressable style={[styles.actionButton, styles.closeButton]} onPress={closeViewer}>
          <Text style={styles.actionButtonText}>Close Audit Log</Text>
        </Pressable>
      )}
      {chainOk !== null ? (
        <Text style={[styles.chainStatus, chainOk ? styles.chainOk : styles.chainBroken, chainOk && themedStyles.chainOk]}>
          Hash chain: {chainOk ? 'Intact' : 'Broken'}
        </Text>
      ) : null}
      {expanded && entries.length > 0 ? (
        <View style={styles.auditList}>
          {entries.map((e) => (
            <View key={e.auditId} style={[styles.auditEntry, themedStyles.auditEntry]}>
              <Text style={[styles.auditText, themedStyles.auditText]}>
                {e.createdAt.slice(11, 19)} - {e.actor} - {e.action} - {e.resourceType}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {expanded && entries.length === 0 ? (
        <Text style={[styles.devInfo, themedStyles.devInfo]}>No audit entries found.</Text>
      ) : null}
    </View>
  );
}

function KnowledgeCacheViewer({ patientId }: { patientId: string }) {
  const { refresh: refreshSnapshot } = usePatientRecord();
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const [loaded, setLoaded] = useState(false);
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [showAllPatients, setShowAllPatients] = useState(false);
  const [expandedChunkId, setExpandedChunkId] = useState<string | null>(null);
  // Source groups are collapsed by default; this set tracks which are expanded.
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exportingZip, setExportingZip] = useState(false);
  const [enrichmentLogOpen, setEnrichmentLogOpen] = useState(false);
  const [enrichmentLog, setEnrichmentLog] = useState<PatientEnrichmentLogEntry[]>([]);
  const [redownloadProgress, setRedownloadProgress] = useState<{
    phase: string;
    progress: number;
    completedSteps: number;
    totalSteps: number;
    chunksAdded: number;
  } | null>(null);

  const loadChunkList = useCallback(() => {
    if (showAllPatients) {
      // Dev-only cross-patient dump — never used by retrieval.
      setChunks(getAllKnowledgeChunks());
    } else {
      setChunks(getKnowledgeChunksForPatient(patientId));
    }
  }, [patientId, showAllPatients]);

  const loadChunks = useCallback(() => {
    loadChunkList();
    setEnrichmentLog(getEnrichmentLogForPatient(patientId, 20));
    setLoaded(true);
  }, [patientId, loadChunkList]);

  // Refresh both the local chunk list AND the patient-record snapshot so the
  // Knowledge Cache stats counts + bundleStatus at the top of the block update
  // (they read from snapshot.knowledgeStats, which only changes on snapshot refresh).
  const refresh = useCallback(() => {
    loadChunkList();
    setEnrichmentLog(getEnrichmentLogForPatient(patientId, 20));
    refreshSnapshot();
  }, [patientId, refreshSnapshot, loadChunkList]);

  const closeViewer = useCallback(() => {
    setLoaded(false);
    setChunks([]);
    setExpandedChunkId(null);
    setExpandedSources(new Set());
    setEnrichmentLogOpen(false);
  }, []);

  const toggleSource = useCallback((source: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  const handleCopy = useCallback((chunk: KnowledgeChunk) => {
    try {
      // Lazy import to avoid a top-level dependency on the deprecated
      // RN Clipboard for callers that don't use the viewer.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Clipboard = require('react-native').Clipboard;
      if (Clipboard?.setString) {
        Clipboard.setString(`${chunk.chunkId}\n\n${chunk.text}`);
        Alert.alert('Copied', `${chunk.chunkId} copied to clipboard.`);
      }
    } catch (err) {
      Alert.alert('Copy failed', err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleDelete = useCallback((chunk: KnowledgeChunk) => {
    Alert.alert(
      'Delete chunk?',
      `${chunk.chunkId} will be removed from the knowledge cache. The SLM will re-fetch it next time if needed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteKnowledgeChunk(chunk.chunkId);
            refresh();
          },
        },
      ],
    );
  }, [refresh]);

  const handleRedownload = useCallback(async (chunk: KnowledgeChunk) => {
    setBusyId(chunk.chunkId);
    try {
      const result = await redownloadForChunk(chunk.chunkId, patientId);
      if (result.success) {
        Alert.alert(
          'Re-downloaded',
          `Replaced ${chunk.chunkId} with ${result.newChunkIds.length} new chunk${result.newChunkIds.length === 1 ? '' : 's'}.`,
        );
      } else {
        Alert.alert('Re-download failed', result.error ?? 'Unknown error');
      }
    } finally {
      setBusyId(null);
      refresh();
    }
  }, [patientId, refresh]);

  const handleDeleteBySource = useCallback((source: string) => {
    Alert.alert(
      `Delete "${source}" chunks for this patient?`,
      showAllPatients
        ? `Cross-patient mode: removes every chunk with source="${source}" across all patients.`
        : `Removes this patient's chunks with source="${source}". Other profiles are untouched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const removed = showAllPatients
              ? deleteKnowledgeChunksBySource(source)
              : deleteKnowledgeChunksBySource(source, patientId);
            refresh();
            Alert.alert('Deleted', `${removed} ${source} chunk${removed === 1 ? '' : 's'} removed.`);
          },
        },
      ],
    );
  }, [refresh, patientId, showAllPatients]);

  const handleRedownloadAll = useCallback(async () => {
    setBusyId('__all__');
    setRedownloadProgress({
      phase: 'Starting clinical knowledge download',
      progress: 0,
      completedSteps: 0,
      totalSteps: 1,
      chunksAdded: 0,
    });
    try {
      const result = await redownloadAllForPatient(patientId, {
        onProgress: (update) => {
          setRedownloadProgress({
            phase: update.phase,
            progress: update.progress,
            completedSteps: update.completedSteps,
            totalSteps: update.totalSteps,
            chunksAdded: update.chunksAdded,
          });
          // Keep chunk list live while downloading.
          loadChunkList();
        },
      });
      refresh();
      if (result.errors.length === 0) {
        Alert.alert('Re-downloaded', 'Knowledge cache rebuilt from current patient record.');
      } else {
        Alert.alert('Re-download completed with errors', result.errors.join('\n'));
      }
    } finally {
      setBusyId(null);
      setRedownloadProgress(null);
    }
  }, [patientId, refresh, loadChunkList]);

  // Export the full knowledge cache as a single zip archive. Each chunk
  // is written as a sanitized .txt file inside a per-source folder, plus a
  // manifest.json with chunk metadata. Written to Paths.document so the
  // file persists across app sessions and is reachable via iTunes File
  // Sharing / the Files app on iOS. The URI is surfaced via Alert so the
  // user can copy/paste it or AirDrop the file.
  const handleExportZip = useCallback(async () => {
    if (chunks.length === 0) {
      Alert.alert('Nothing to export', 'The knowledge cache is empty.');
      return;
    }
    setExportingZip(true);
    try {
      // Lazy-require JSZip so callers that never open the viewer don't pay
      // the parse cost. (jszip is already a dependency — added in the plan
      // implementation for the CDA zip import path.)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const JSZip = require('jszip');
      const zip = new JSZip();

      const manifest: {
        exportedAt: string;
        patientId: string;
        totalChunks: number;
        sources: { source: string; count: number }[];
        chunks: {
          chunkId: string;
          source: string;
          conditions: string | null;
          retrievedAt: string;
          useCount: number;
          documentType?: string | null;
          lengthTier?: string | null;
          file: string;
        }[];
      } = {
        exportedAt: new Date().toISOString(),
        patientId: patientId ?? 'default-patient',
        totalChunks: chunks.length,
        sources: [],
        chunks: [],
      };

      // Group by source so each source lives in its own folder.
      const bySource: Record<string, KnowledgeChunk[]> = {};
      for (const c of chunks) {
        const key = c.source || 'unknown';
        if (!bySource[key]) bySource[key] = [];
        bySource[key].push(c);
      }

      // Sanitize a chunk id into a filesystem-safe filename. Strips path
      // separators and other chars that break iOS/Android filenames.
      const safeName = (id: string): string =>
        id.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);

      for (const [source, srcChunks] of Object.entries(bySource)) {
        manifest.sources.push({ source, count: srcChunks.length });
        const folder = zip.folder(source);
        if (!folder) continue;
        for (const c of srcChunks) {
          const fname = `${safeName(c.chunkId)}.txt`;
          const fpath = `${source}/${fname}`;
          // Chunk body: the text + a small header block with the metadata
          // so the file is self-describing if extracted individually.
          const header = [
            `chunkId: ${c.chunkId}`,
            `source: ${c.source}`,
            `conditions: ${c.conditions ?? ''}`,
            `retrievedAt: ${c.retrievedAt}`,
            `useCount: ${c.useCount}`,
            c.documentType ? `documentType: ${c.documentType}` : null,
            c.lengthTier ? `lengthTier: ${c.lengthTier}` : null,
            '---',
          ].filter(Boolean).join('\n');
          folder.file(fname, `${header}\n${c.text}`);
          manifest.chunks.push({
            chunkId: c.chunkId,
            source: c.source,
            conditions: c.conditions ?? null,
            retrievedAt: c.retrievedAt,
            useCount: c.useCount,
            documentType: c.documentType ?? null,
            lengthTier: c.lengthTier ?? null,
            file: fpath,
          });
        }
      }

      zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      const buf = await zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      // Write to the app's document directory (persists across sessions,
      // reachable from Files app on iOS).
      const fileName = `knowledge-cache-${Date.now()}.zip`;
      const outFile = new File(Paths.document, fileName);
      outFile.write(buf as unknown as string);

      audit({
        actor: 'caregiver',
        action: 'export',
        resourceType: 'knowledge_cache',
        resourceId: fileName,
        patientId: patientId ?? undefined,
        payload: { totalChunks: chunks.length, sources: manifest.sources.length, fileName },
      });

      // Open the OS share sheet so the caregiver can AirDrop, email, save
      // to Files, or send via Messages — without leaving the app. Falls
      // back to an Alert with the URI if sharing is unavailable (rare:
      // simulator without share extension, or an unsupported file type).
      let shared = false;
      try {
        if (await Sharing.isAvailableAsync()) {
          // Copy to the cache directory first so the URI scheme is
          // writable-share-compatible (Sharing prefers file:// uris under
          // Paths.cache on iOS).
          const cacheFile = new File(Paths.cache, fileName);
          cacheFile.write(buf as unknown as string);
          await Sharing.shareAsync(cacheFile.uri, {
            mimeType: 'application/zip',
            dialogTitle: 'Share Knowledge Cache Export',
            UTI: 'public.zip-archive',
          });
          shared = true;
        }
      } catch (shareErr) {
        // Share sheet cancelled or failed — fall through to the URI alert
        // so the caregiver still knows where the file lives.
        console.warn('[KnowledgeCacheViewer] Sharing.shareAsync failed:', shareErr);
      }

      if (!shared) {
        Alert.alert(
          'Knowledge cache exported',
          `${chunks.length} chunk${chunks.length === 1 ? '' : 's'} (${manifest.sources.length} source${manifest.sources.length === 1 ? '' : 's'}) written to:\n\n${outFile.uri}\n\nOn iOS, find it in the Files app under this app's container; on Android, use a file manager or `+ '`adb pull`' +`.`,
        );
      }
    } catch (err) {
      Alert.alert(
        'Export failed',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setExportingZip(false);
    }
  }, [chunks, patientId]);

  if (!loaded) {
    return (
      <Pressable style={styles.actionButton} onPress={loadChunks}>
        <Text style={styles.actionButtonText}>View Cached Chunks</Text>
      </Pressable>
    );
  }

  const bySource: Record<string, KnowledgeChunk[]> = {};
  for (const c of chunks) {
    if (!bySource[c.source]) bySource[c.source] = [];
    bySource[c.source].push(c);
  }
  const sources = Object.keys(bySource).sort();

  return (
    <View style={styles.cacheViewerWrap}>
      <View style={styles.cacheViewerActions}>
        <Pressable style={[styles.actionButton, styles.closeButton]} onPress={closeViewer}>
          <Text style={styles.actionButtonText}>Close</Text>
        </Pressable>
        <Pressable
          style={styles.actionButton}
          onPress={() => {
            if (!showAllPatients) {
              Alert.alert(
                'Show all patients?',
                'Cross-patient dump is for debugging only. Retrieval never uses this view.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Show all',
                    onPress: () => {
                      setShowAllPatients(true);
                      setTimeout(() => refresh(), 0);
                    },
                  },
                ],
              );
            } else {
              setShowAllPatients(false);
              setTimeout(() => refresh(), 0);
            }
          }}
        >
          <Text style={styles.actionButtonText}>
            {showAllPatients ? 'Showing: ALL patients' : 'Showing: this patient'}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.actionButton, busyId === '__all__' && styles.disabledActionButton, busyId === '__all__' && themedStyles.disabledActionButton]}
          onPress={handleRedownloadAll}
          disabled={busyId === '__all__'}
        >
          <Text style={styles.actionButtonText}>
            {busyId === '__all__' ? 'Re-downloading…' : 'Re-download all (this patient)'}
          </Text>
        </Pressable>
        {redownloadProgress ? (
          <View style={[styles.knowledgeProgressWrap, themedStyles.knowledgeProgressWrap]}>
            <Text style={[styles.devInfo, themedStyles.devInfo]} numberOfLines={2}>
              {redownloadProgress.phase}
            </Text>
            <View style={[styles.knowledgeProgressTrack, themedStyles.knowledgeProgressTrack]}>
              <View
                style={[
                  styles.knowledgeProgressFill,
                  {
                    width: `${Math.round(
                      Math.min(1, Math.max(0.05, redownloadProgress.progress)) * 100,
                    )}%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.devInfo, themedStyles.devInfo]}>
              {redownloadProgress.completedSteps}/{redownloadProgress.totalSteps || 1} steps
              {redownloadProgress.chunksAdded > 0
                ? ` · ${redownloadProgress.chunksAdded} chunks`
                : ''}
            </Text>
          </View>
        ) : null}
        <Pressable
          style={[styles.actionButton, (exportingZip || chunks.length === 0) && styles.disabledActionButton, (exportingZip || chunks.length === 0) && themedStyles.disabledActionButton]}
          onPress={() => void handleExportZip()}
          disabled={exportingZip || chunks.length === 0}
        >
          <Text style={styles.actionButtonText}>
            {exportingZip ? 'Exporting…' : 'Export as ZIP'}
          </Text>
        </Pressable>
      </View>

      {chunks.length === 0 ? (
        <Text style={[styles.devInfo, themedStyles.devInfo]}>
          {showAllPatients
            ? 'No knowledge chunks in the database.'
            : 'No knowledge chunks for this patient yet. They populate after onboarding / re-download for this profile only.'}
        </Text>
      ) : (
        sources.map((src) => {
          const isSourceExpanded = expandedSources.has(src);
          return (
          <View key={src} style={styles.cacheSourceGroup}>
            <View style={styles.cacheSourceHeader}>
              <Pressable
                style={styles.cacheSourceToggle}
                onPress={() => toggleSource(src)}
            >
                <Text style={[styles.cacheSourceCaret, themedStyles.cacheSourceCaret]}>
                  {isSourceExpanded ? '▾' : '▸'}
                </Text>
                <Text style={[styles.cacheSourceLabel, themedStyles.cacheSourceLabel]}>
                  {src} ({bySource[src].length})
                </Text>
              </Pressable>
              <View style={styles.cacheSourceHeaderActions}>
                <Pressable
                  style={[styles.smallButton]}
                  onPress={() => toggleSource(src)}
                >
                  <Text style={styles.smallButtonText}>
                    {isSourceExpanded ? 'Collapse' : 'Expand'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.smallButton, styles.dangerSmallButton]}
                  onPress={() => handleDeleteBySource(src)}
                >
                  <Text style={styles.smallButtonText}>Delete all</Text>
                </Pressable>
              </View>
            </View>
            {isSourceExpanded ? bySource[src].map((chunk) => {
              const isOpen = expandedChunkId === chunk.chunkId;
              const isBusy = busyId === chunk.chunkId;
              return (
                <View key={chunk.chunkId} style={[styles.cacheChunkRow, themedStyles.cacheChunkRow]}>
                  <Pressable onPress={() => setExpandedChunkId(isOpen ? null : chunk.chunkId)}>
                    <Text style={[styles.cacheChunkId, themedStyles.cacheChunkId]}>{chunk.chunkId}</Text>
                    <Text style={[styles.cacheChunkMeta, themedStyles.cacheChunkMeta]}>
                      {chunk.conditions ? `conditions: ${chunk.conditions}` : 'no conditions'}
                      {' · '}uses: {chunk.useCount}
                      {chunk.documentType ? ` · ${chunk.documentType}` : ''}
                    </Text>
                    {isOpen ? (
                      <Text style={[styles.cacheChunkText, themedStyles.cacheChunkText]}>{chunk.text}</Text>
                    ) : (
                      <Text style={[styles.cacheChunkPreview, themedStyles.cacheChunkPreview]} numberOfLines={2}>
                        {chunk.text}
                      </Text>
                    )}
                  </Pressable>
                  <View style={styles.cacheChunkActions}>
                    <Pressable
                      style={[styles.smallButton, isBusy && styles.disabledButton]}
                      onPress={() => void handleRedownload(chunk)}
                      disabled={isBusy}
                    >
                      <Text style={styles.smallButtonText}>
                        {isBusy ? '…' : 'Re-download'}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.smallButton]}
                      onPress={() => handleCopy(chunk)}
                    >
                      <Text style={styles.smallButtonText}>Copy</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.smallButton, styles.dangerSmallButton]}
                      onPress={() => handleDelete(chunk)}
                    >
                      <Text style={styles.smallButtonText}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              );
            }) : null}
          </View>
        );
      })
      )}

      {/* Enrichment log viewer (planning/32 §13.4) */}
      <View style={[styles.enrichmentLogBlock, themedStyles.enrichmentLogBlock]}>
        <Pressable
          style={styles.enrichmentLogHeader}
          onPress={() => setEnrichmentLogOpen((v) => !v)}
        >
          <Text style={[styles.devLabel, themedStyles.devLabel]}>
            {enrichmentLogOpen ? '▾' : '▸'} Enrichment log ({enrichmentLog.length} entries)
          </Text>
        </Pressable>
        {enrichmentLogOpen ? (
          enrichmentLog.length === 0 ? (
            <Text style={[styles.devInfo, themedStyles.devInfo]}>No enrichment entries yet.</Text>
          ) : (
            enrichmentLog.map((entry) => (
              <View key={entry.logId} style={styles.enrichmentLogRow}>
                <Text style={[styles.enrichmentLogMeta, themedStyles.enrichmentLogMeta]}>
                  {entry.createdAt.slice(0, 19).replace('T', ' ')} · {entry.source} · {entry.action}
                  {entry.resultCount !== undefined ? ` · ${entry.resultCount} chunks` : ''}
                  {entry.latencyMs !== undefined ? ` · ${entry.latencyMs}ms` : ''}
                </Text>
                {entry.deidentifiedQuery ? (
                  <Text style={[styles.enrichmentLogQuery, themedStyles.enrichmentLogQuery]}>{entry.deidentifiedQuery}</Text>
                ) : null}
              </View>
            ))
          )
        ) : null}
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const themedStyles = createThemedStyles(useTheme());

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>{title}</Text>
      <View style={[styles.card, themedStyles.card]}>{children}</View>
    </View>
  );
}

function CompactToggleRow({
  id,
  emoji,
  label,
  value,
  expanded,
  explanation,
  onToggleExpand,
  onValueChange,
  accessibilityLabel,
  accessibilityHint,
  localizeAccessibility = false,
}: {
  id: ExpandableId;
  emoji: string;
  label: string;
  value: boolean;
  expanded: boolean;
  explanation?: string;
  onToggleExpand: (id: ExpandableId) => void;
  onValueChange: (v: boolean) => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  localizeAccessibility?: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = createThemedStyles(theme);
  const effectiveLabel = accessibilityLabel ?? label;

  return (
    <View style={[styles.compactWrap, themedStyles.divider]}>
      <View style={styles.compactRow}>
        <Pressable
          style={styles.compactPressArea}
          onPress={() => onToggleExpand(id)}
          accessibilityRole="button"
          accessibilityLabel={
            localizeAccessibility
              ? t('settings.a11y.details', { label: effectiveLabel })
              : `${effectiveLabel} details`
          }
          accessibilityHint={
            expanded
              ? localizeAccessibility
                ? t('settings.a11y.collapseExplanation')
                : 'Collapse explanation'
              : accessibilityHint ??
                (localizeAccessibility
                  ? t('settings.a11y.expandExplanation')
                  : 'Expand explanation')
          }
          accessibilityState={{ expanded }}
        >
          {emoji ? (
            <Text style={[styles.rowEmoji, themedStyles.primaryText]} accessibilityElementsHidden importantForAccessibility="no">
              {emoji}
            </Text>
          ) : null}
          <Text style={[styles.rowLabel, themedStyles.primaryText]}>{label}</Text>
        </Pressable>
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: theme.appBorder, true: AppTheme.colors.brandSoft }}
          thumbColor={value ? AppTheme.colors.brand : theme.appSurface}
          accessibilityRole="switch"
          accessibilityLabel={effectiveLabel}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ checked: value }}
        />
      </View>
      {expanded && explanation ? (
        <View style={styles.explanation}>
          <Text style={[styles.explanationText, themedStyles.secondaryText]}>{explanation}</Text>
          <Pressable
            style={[styles.closeExplanation, themedStyles.softSurface]}
            onPress={() => onToggleExpand(id)}
            accessibilityRole="button"
            accessibilityLabel={
              localizeAccessibility
                ? t('settings.a11y.closeExplanation', { label })
                : `Close ${label} explanation`
            }
          >
            <Text style={[styles.closeExplanationText, themedStyles.secondaryText]}>
              {localizeAccessibility ? t('common.close') : 'Close'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function CompactActionRow({
  id,
  emoji,
  label,
  expanded,
  explanation,
  onToggleExpand,
  children,
  localizeAccessibility = false,
}: {
  id: ExpandableId;
  emoji: string;
  label: string;
  expanded: boolean;
  explanation?: string;
  onToggleExpand: (id: ExpandableId) => void;
  children?: React.ReactNode;
  localizeAccessibility?: boolean;
}) {
  const { t } = useTranslation();
  const themedStyles = createThemedStyles(useTheme());

  return (
    <View style={[styles.compactWrap, themedStyles.divider]}>
      <Pressable
        style={styles.actionCompactRow}
        onPress={() => onToggleExpand(id)}
        accessibilityRole="button"
        accessibilityLabel={
          localizeAccessibility
            ? t('settings.a11y.details', { label })
            : `${label} details`
        }
        accessibilityHint={
          expanded
            ? localizeAccessibility
              ? t('settings.a11y.collapseDetails')
              : 'Collapse details'
            : localizeAccessibility
              ? t('settings.a11y.expandDetails')
              : 'Expand details'
        }
        accessibilityState={{ expanded }}
      >
        <Text style={[styles.rowEmoji, themedStyles.primaryText]} accessibilityElementsHidden importantForAccessibility="no">
          {emoji}
        </Text>
        <Text style={[styles.rowLabel, themedStyles.primaryText]}>{label}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.explanation}>
          {explanation ? <Text style={[styles.explanationText, themedStyles.secondaryText]}>{explanation}</Text> : null}
          {children}
          <Pressable
            style={[styles.closeExplanation, themedStyles.softSurface]}
            onPress={() => onToggleExpand(id)}
            accessibilityRole="button"
            accessibilityLabel={
              localizeAccessibility
                ? t('settings.a11y.closeDetails', { label })
                : `Close ${label} details`
            }
          >
            <Text style={[styles.closeExplanationText, themedStyles.secondaryText]}>
              {localizeAccessibility ? t('common.close') : 'Close'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function PlainActionRow({
  emoji,
  label,
  description,
  onPress,
  accessibilityLabel,
}: {
  emoji: string;
  label: string;
  description: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const themedStyles = createThemedStyles(useTheme());

  return (
    <Pressable
      style={styles.actionCompactRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={description}
    >
      <Text style={[styles.rowEmoji, themedStyles.primaryText]} accessibilityElementsHidden importantForAccessibility="no">
        {emoji}
      </Text>
      <View style={styles.rowTextBlock}>
        <Text style={[styles.rowLabel, themedStyles.primaryText]}>{label}</Text>
        <Text style={[styles.rowDescription, themedStyles.secondaryText]}>{description}</Text>
      </View>
    </Pressable>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';
  const accent = isDark ? AppTheme.colors.brand : teal;

  return StyleSheet.create({
    safeArea: { backgroundColor: theme.appBackground },
    content: { backgroundColor: theme.appBackground },
    sectionTitle: { color: theme.appSectionText },
    card: { backgroundColor: theme.appSurface, borderColor: theme.appBorder },
    divider: { borderBottomColor: theme.appBorder },
    primaryText: { color: theme.appText },
    secondaryText: { color: theme.appTextSupporting },
    headerText: { color: theme.appHeaderText },
    softSurface: { backgroundColor: theme.appControlSurface },
    segmented: { borderColor: theme.appBorder },
    segment: { backgroundColor: theme.appSurface },
    devLabel: { color: isDark ? theme.appText : darkText },
    devInfo: { color: isDark ? theme.appTextSupporting : mutedText },
    inlineControlLabel: { color: theme.appText },
    disabledActionButton: { backgroundColor: isDark ? '#4B5563' : '#D1D5DB' },
    progressBar: { backgroundColor: isDark ? theme.appBorder : borderColor },
    modelItem: {
      backgroundColor: isDark ? theme.appSurface : 'transparent',
      borderColor: isDark ? theme.appBorder : borderColor,
    },
    ncbiInput: {
      backgroundColor: isDark ? theme.appInputBackground : 'transparent',
      borderColor: isDark ? theme.appBorder : borderColor,
      color: isDark ? theme.appText : darkText,
    },
    keyStatusStored: {
      backgroundColor: isDark ? theme.appBrandSoftSurface : '#DCFCE7',
      color: isDark ? AppTheme.colors.brand : '#0F7A4A',
    },
    keyStatusEmpty: {
      backgroundColor: isDark ? theme.appControlSurface : '#F3F4F6',
      color: isDark ? theme.appTextMuted : '#9CA3AF',
    },
    thresholdBlock: {
      backgroundColor: isDark ? theme.appControlSurface : AppTheme.colors.softSurface,
      borderColor: theme.appBorder,
    },
    thresholdTitle: { color: theme.appText },
    thresholdMuted: { color: isDark ? theme.appTextSupporting : AppTheme.colors.textSoft },
    thresholdValue: { color: theme.appText },
    thresholdDismissBtn: {
      backgroundColor: isDark ? theme.appControlSurface : AppTheme.colors.chip,
      borderColor: theme.appBorder,
    },
    conditionRoleRow: { borderTopColor: theme.appBorder },
    roleButton: {
      backgroundColor: isDark ? theme.appControlSurface : AppTheme.colors.softSurface,
      borderColor: theme.appBorder,
    },
    roleButtonText: { color: isDark ? theme.appTextSupporting : AppTheme.colors.textSoft },
    uc3EvaluationStatusCard: {
      backgroundColor: isDark ? theme.appControlSurface : AppTheme.colors.softSurface,
      borderColor: isDark ? theme.appBorder : borderColor,
    },
    uc3EvaluationStatusTitle: { color: isDark ? theme.appText : darkText },
    uc3EvaluationStatusLine: { color: isDark ? theme.appTextSupporting : mutedText },
    auditEntry: { borderLeftColor: isDark ? theme.appBorder : borderColor },
    auditText: { color: isDark ? theme.appTextMuted : mutedText },
    chainOk: { color: accent },
    knowledgeProgressWrap: {
      backgroundColor: isDark ? theme.appControlSurface : AppTheme.colors.softSurface,
      borderColor: theme.appBorder,
    },
    knowledgeProgressTrack: {
      backgroundColor: isDark ? theme.appBorder : AppTheme.colors.chip,
    },
    cacheSourceCaret: { color: accent },
    cacheSourceLabel: { color: accent },
    cacheChunkRow: {
      backgroundColor: isDark ? theme.appControlSurface : 'transparent',
      borderColor: isDark ? theme.appBorder : borderColor,
    },
    cacheChunkId: { color: isDark ? theme.appText : darkText },
    cacheChunkMeta: { color: isDark ? theme.appTextMuted : mutedText },
    cacheChunkPreview: { color: isDark ? theme.appTextMuted : mutedText },
    cacheChunkText: { color: isDark ? theme.appText : darkText },
    enrichmentLogBlock: { borderTopColor: isDark ? theme.appBorder : borderColor },
    enrichmentLogMeta: { color: isDark ? theme.appTextMuted : mutedText },
    enrichmentLogQuery: { color: isDark ? theme.appText : darkText },
  });
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AppTheme.colors.screen },
  content: { padding: 24, paddingBottom: 40, gap: 18 },
  topBar: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topBarSpacer: { width: 72 },
  backButton: { minHeight: 44, justifyContent: 'center', paddingRight: 12 },
  backText: { color: teal, fontSize: 14, fontWeight: '900' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  logoCircle: { width: 48, height: 48, borderRadius: 14, backgroundColor: teal, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoImage: { width: 36, height: 36 },
  headerTextBlock: { flex: 1 },
  headerEyebrow: { color: teal, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  headerTitle: { fontSize: 28, fontWeight: '900', color: darkText, marginTop: 2 },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: AppTheme.colors.sectionText,
  },
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    overflow: 'hidden',
    ...AppTheme.shadow,
  },
  compactWrap: {
    borderBottomWidth: 1,
    borderBottomColor: AppTheme.colors.border,
  },
  compactRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  compactPressArea: {
    minHeight: 44,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionCompactRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rowEmoji: {
    width: 28,
    color: AppTheme.colors.text,
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
    includeFontPadding: false,
  },
  rowTextBlock: {
    flex: 1,
  },
  rowLabel: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  rowDescription: {
    marginTop: 3,
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  explanation: {
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingLeft: 54,
  },
  explanationText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  closeExplanation: {
    alignSelf: 'flex-start',
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: AppTheme.radius.sm,
    backgroundColor: AppTheme.colors.softSurface,
  },
  closeExplanationText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '900',
  },
  inlineControlRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  inlineControlLabel: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  segmented: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: AppTheme.radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  segButton: {
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppTheme.colors.white,
  },
  segButtonActive: { backgroundColor: AppTheme.colors.brand },
  segText: { fontSize: 13, color: AppTheme.colors.textSoft, fontWeight: '800' },
  segTextActive: { color: AppTheme.colors.white },
  numInput: {
    width: 72,
    minHeight: 40,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: AppTheme.radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 15,
    color: AppTheme.colors.text,
    textAlign: 'center',
    backgroundColor: AppTheme.colors.softSurface,
    fontWeight: '800',
  },
  subsection: {
    gap: 8,
    paddingTop: 2,
  },
  subsectionTitle: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  actionButton: {
    backgroundColor: teal,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  dangerButton: { backgroundColor: dangerRed },
  unloadButton: { backgroundColor: '#6B7280' },
  disabledActionButton: { backgroundColor: '#D1D5DB', opacity: 0.7 },
  devSection: { gap: 12, marginTop: 8, paddingHorizontal: 16, paddingBottom: 16 },
  devLabel: { fontSize: 14, fontWeight: '700', color: darkText },
  devInfo: { fontSize: 12, color: mutedText, lineHeight: 17 },
  uc3EvaluationStatusCard: {
    borderWidth: 1,
    borderColor,
    borderRadius: 10,
    backgroundColor: AppTheme.colors.softSurface,
    padding: 10,
    gap: 4,
  },
  uc3EvaluationStatusTitle: {
    color: darkText,
    fontSize: 13,
    fontWeight: '900',
  },
  uc3EvaluationStatusLine: {
    color: mutedText,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  keyLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  keyStatusBadge: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  keyStatusStored: {
    color: '#0F7A4A',
    backgroundColor: '#DCFCE7',
  },
  keyStatusEmpty: {
    color: '#9CA3AF',
    backgroundColor: '#F3F4F6',
  },
  modelRow: { gap: 8 },
  modelItem: {
    borderWidth: 1,
    borderColor,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  modelName: { fontSize: 14, fontWeight: '700', color: darkText },
  modelStatus: { fontSize: 12, color: mutedText },
  modelActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  smallButton: {
    backgroundColor: teal,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  smallButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  ncbiInput: {
    borderWidth: 1,
    borderColor,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: darkText,
    marginBottom: 8,
  },
  disabledButton: { opacity: 0.4 },
  dangerSmallButton: { backgroundColor: dangerRed },
  auditList: { marginTop: 8, gap: 4 },
  auditEntry: { paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: borderColor },
  auditText: { fontSize: 11, color: mutedText, fontFamily: 'monospace' },
  chainStatus: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  chainOk: { color: teal },
  chainBroken: { color: dangerRed },
  closeButton: { backgroundColor: '#6B7280' },
  cacheViewerWrap: { gap: 8, marginTop: 8 },
  knowledgeProgressWrap: {
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
    padding: 10,
    borderRadius: 10,
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  knowledgeProgressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: AppTheme.colors.chip,
    overflow: 'hidden',
  },
  knowledgeProgressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: AppTheme.colors.brand,
  },
  cacheSourceGroup: { gap: 4, marginTop: 8 },
  cacheSourceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cacheSourceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  cacheSourceCaret: {
    fontSize: 14,
    fontWeight: '900',
    color: teal,
    width: 14,
  },
  cacheSourceHeaderActions: {
    flexDirection: 'row',
    gap: 6,
    flexShrink: 0,
  },
  cacheSourceLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: teal,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cacheChunkRow: {
    borderWidth: 1,
    borderColor,
    borderRadius: 8,
    padding: 10,
    gap: 6,
  },
  cacheChunkId: {
    fontSize: 12,
    fontWeight: '700',
    color: darkText,
    fontFamily: 'monospace',
  },
  cacheChunkMeta: {
    fontSize: 11,
    color: mutedText,
  },
  cacheChunkPreview: {
    fontSize: 12,
    color: mutedText,
    lineHeight: 17,
  },
  cacheChunkText: {
    fontSize: 12,
    color: darkText,
    lineHeight: 18,
    marginTop: 4,
  },
  cacheChunkActions: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 6,
  },
  cacheViewerActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  enrichmentLogBlock: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: borderColor,
  },
  enrichmentLogHeader: {
    paddingVertical: 4,
  },
  enrichmentLogRow: {
    paddingVertical: 4,
    gap: 2,
  },
  enrichmentLogMeta: {
    fontSize: 11,
    color: mutedText,
    fontFamily: 'monospace',
  },
  enrichmentLogQuery: {
    fontSize: 11,
    color: darkText,
    fontStyle: 'italic',
    paddingLeft: 8,
  },
  progressBar: {
    height: 4,
    backgroundColor: borderColor,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 4,
  },
  progressFill: {
    height: '100%',
    backgroundColor: teal,
    borderRadius: 2,
  },
  progressFillHot: {
    backgroundColor: '#B42318',
  },
  ramBlock: {
    marginTop: 12,
    marginBottom: 4,
  },
  thresholdBlock: {
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
    fontWeight: '800',
  },
  thresholdMuted: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 18,
  },
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  medRequirementRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  conditionRoleRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
  },
  conditionRoleActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  roleButton: {
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: AppTheme.radius.sm,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 10,
  },
  roleButtonActive: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brand,
  },
  roleButtonText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  roleButtonTextActive: {
    color: AppTheme.colors.white,
  },
  thresholdTextBlock: {
    flex: 1,
    gap: 2,
  },
  thresholdValue: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '700',
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
    fontWeight: '800',
  },
  decisionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderColor: AppTheme.colors.border,
  },
  decisionAction: {
    fontSize: 14,
    color: AppTheme.colors.text,
    fontWeight: '600',
  },
  decisionTime: {
    fontSize: 12,
    color: AppTheme.colors.textMuted,
  },
});
