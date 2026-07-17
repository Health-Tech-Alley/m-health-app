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
import { DEFAULT_SLM_MODEL_ID, MODEL_CATALOG, type ModelEntry } from '@/inference/model-catalog';
import { isModelInstalled, deleteModel, clearAllModels } from '@/services/model-storage';
import { downloadModel } from '@/services/model-download';
import {
  clearKnowledgeCache,
  deleteKnowledgeChunk,
  deleteKnowledgeChunksBySource,
  DEVELOPMENT_UC3_REHAB_EXERCISES,
  getActiveConsents,
  getAllKnowledgeChunks,
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
  type RehabExerciseKey,
  type ThresholdRecommendation,
} from '@/data';
import { importCdaJsonString, importCdaZip } from '@/data/cda';
import { redownloadForChunk, redownloadAllForPatient } from '@/clinical-evidence/re-download';
import { audit } from '@/services/audit/auditService';
import { grantConsent, revokeConsentAndAudit } from '@/services/consent/consentGate';
import { getNcbiApiKey, setNcbiApiKey, clearNcbiApiKey } from '@/services/ncbi-token-store';
import { getOpenFdaApiKey, setOpenFdaApiKey, clearOpenFdaApiKey } from '@/services/openfda-token-store';
import { getUmlsApiKey, setUmlsApiKey, clearUmlsApiKey } from '@/services/umls-token-store';
import { applyElenaGarciaDemoProfile } from '@/services/onboarding/fhirDemoImport';
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

const teal = '#0E6F68';
const darkText = '#123433';
const mutedText = '#526866';
const borderColor = '#D9E7E5';
const dangerRed = '#B42318';

const RECORD_CONSENT_OPTIONS: {
  scope: RecordConsentScope;
  emoji: string;
  title: string;
  subtitle: string;
}[] = [
  {
    scope: 'ccda_export',
    emoji: '📤',
    title: 'Health record export consent',
    subtitle: 'Allow exporting a care summary for care coordination.',
  },
  {
    scope: 'fhir-share',
    emoji: '🔗',
    title: 'Health record share consent',
    subtitle: 'Allow sharing structured records with approved care systems.',
  },
  {
    scope: 'pharmacy-communicator',
    emoji: '💊',
    title: 'Pharmacy communicator consent',
    subtitle: 'Allow medication-related communication with pharmacy tools.',
  },
  {
    scope: 'provider-message',
    emoji: '💬',
    title: 'Provider message consent',
    subtitle: 'Allow sending care context to provider messaging tools.',
  },
];

const initialRecordConsentState: Record<RecordConsentScope, boolean> = {
  ccda_export: false,
  'fhir-share': false,
  'pharmacy-communicator': false,
  'provider-message': false,
};

const EMPTY_CONDITIONS: PatientCondition[] = [];

type ExpandableId =
  | 'anomaly'
  | 'medication'
  | 'appointment'
  | 'care-task'
  | 'timing'
  | 'appearance'
  | 'accessibility'
  | 'consent'
  | 'developer-mode';

export function SettingsScreen() {
  return <PreferencesScreen />;
}

export function PreferencesScreen() {
  const router = useRouter();
  const { settings, setTheme } = useSettings();
  const patientId = useOrchestratorPatientId();
  const [expandedId, setExpandedId] = useState<ExpandableId | null>(null);
  const [recordConsentGranted, setRecordConsentGranted] =
    useState<Record<RecordConsentScope, boolean>>(initialRecordConsentState);
  const [recordExportStatus, setRecordExportStatus] = useState(
    'Consent required before export',
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      const nextConsentState = RECORD_CONSENT_OPTIONS.reduce(
        (next, option) => ({
          ...next,
          [option.scope]: getRecordConsentStatus(option.scope, patientId).granted,
        }),
        initialRecordConsentState,
      );

      setRecordConsentGranted(nextConsentState);
      setRecordExportStatus(
        nextConsentState.ccda_export
          ? 'Consent granted for health record export'
          : 'Consent required before export',
      );
    }, 0);

    return () => clearTimeout(handle);
  }, [patientId]);

  const toggleExpanded = useCallback((id: ExpandableId) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

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
          ? 'Consent granted for health record export'
          : 'Consent required before export',
      );
    }
  }, [patientId, recordConsentGranted]);

  const handlePatientCcdaExport = useCallback(() => {
    const result = exportPatientCcda(patientId);

    if (result.status === 'queued') {
      setRecordExportStatus('Health record export queued for sync');
      Alert.alert('Export queued', result.message);
      return;
    }

    if (result.status === 'denied') {
      setRecordConsentGranted((current) => ({
        ...current,
        ccda_export: false,
      }));
      setRecordExportStatus('Consent required before export');
      Alert.alert(
        'Consent required',
        'Please turn on record export consent before exporting a health record.',
      );
      return;
    }

    setRecordExportStatus('Health record export failed');
    Alert.alert('Export failed', result.message);
  }, [patientId]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="Caregiver Concierge" title="Preferences" />

        <Section title="🔔 Notifications">
          <CompactActionRow
            id="timing"
            emoji="⏰"
            label="Notifications & reminders"
            expanded={expandedId === 'timing'}
            explanation="Manage alert, medication, appointment, and care-task reminder delivery preferences."
            onToggleExpand={toggleExpanded}
          >
            <Pressable
              style={styles.actionButton}
              onPress={() => router.push('/notifications-reminders')}
              accessibilityRole="button"
              accessibilityLabel="Open Notifications and reminders">
              <Text style={styles.actionButtonText}>Open Notifications & reminders</Text>
            </Pressable>
          </CompactActionRow>
        </Section>

        <Section title="🎨 Appearance">
          <CompactActionRow
            id="appearance"
            emoji="🎨"
            label="Appearance"
            expanded={expandedId === 'appearance'}
            explanation="Choose whether the app uses light, dark, or system display preference."
            onToggleExpand={toggleExpanded}
          >
            <View style={styles.segmented}>
              {(['light', 'dark', 'system'] as const).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.segButton, settings.theme === t && styles.segButtonActive]}
                  onPress={() => setTheme(t)}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${t} theme`}
                  accessibilityState={{ selected: settings.theme === t }}>
                  <Text style={[styles.segText, settings.theme === t && styles.segTextActive]}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </CompactActionRow>
        </Section>

        <Section title="♿ Accessibility">
          <CompactActionRow
            id="accessibility"
            emoji="♿"
            label="Accessibility"
            expanded={expandedId === 'accessibility'}
            explanation="Rows, controls, and labels are designed for large touch targets and screen-reader clarity. Emoji are decorative and are not the only label."
            onToggleExpand={toggleExpanded}
          />
        </Section>

        <Section title="🛡️ Privacy & Consent">
          <CompactActionRow
            id="consent"
            emoji="🛡️"
            label="Consent Manager"
            expanded={expandedId === 'consent'}
            explanation="Review record-sharing permissions and consent tokens used by care workflows."
            onToggleExpand={toggleExpanded}
          >
            <View style={styles.subsection}>
              <Text style={styles.subsectionTitle}>Record sharing</Text>
              {RECORD_CONSENT_OPTIONS.map((option) => (
                <View key={option.scope}>
                  <CompactToggleRow
                    id={`consent-${option.scope}` as ExpandableId}
                    emoji={option.emoji}
                    label={option.title}
                    value={recordConsentGranted[option.scope]}
                    expanded={false}
                    onToggleExpand={() => {}}
                    onValueChange={() => handleRecordConsentToggle(option.scope)}
                    accessibilityLabel={option.title}
                    accessibilityHint={option.subtitle}
                  />

                  {option.scope === 'ccda_export' && recordConsentGranted.ccda_export ? (
                    <PlainActionRow
                      emoji="📄"
                      label="Export health record"
                      description={recordExportStatus}
                      onPress={handlePatientCcdaExport}
                      accessibilityLabel="Export health record"
                    />
                  ) : null}
                </View>
              ))}
            </View>

            <View style={styles.subsection}>
              <Text style={styles.subsectionTitle}>Consent tokens</Text>
              <ConsentManagement patientId={patientId} />
            </View>
          </CompactActionRow>
        </Section>

        <YourDecisionsSection patientId={patientId} />
      </ScrollView>
    </SafeAreaView>
  );
}

export function AdvancedDeveloperSettingsScreen() {
  const router = useRouter();
  const {
    settings,
    isDeveloper,
    toggleMode,
    setDemoDefaultModelId,
  } = useSettings();
  const slm = useSLM();
  const patientId = useOrchestratorPatientId();
  const {
    patientId: patientRecordPatientId,
    snapshot,
    refresh,
  } = usePatientRecord();
  const [expandedId, setExpandedId] = useState<ExpandableId | null>(null);
  const [ncbiKeyInput, setNcbiKeyInput] = useState('');
  const [openfdaKeyInput, setOpenfdaKeyInput] = useState('');
  const [umlsKeyInput, setUmlsKeyInput] = useState('');
  const [ncbiKeyStored, setNcbiKeyStored] = useState(false);
  const [openfdaKeyStored, setOpenfdaKeyStored] = useState(false);
  const [umlsKeyStored, setUmlsKeyStored] = useState(false);

  const refreshKeyStatus = useCallback(async () => {
    setNcbiKeyStored(Boolean(await getNcbiApiKey()));
    setOpenfdaKeyStored(Boolean(await getOpenFdaApiKey()));
    setUmlsKeyStored(Boolean(await getUmlsApiKey()));
  }, []);

  // On mount, read the secure-store to show stored/empty badges for each key.
  // This is a legit external-system sync (expo-secure-store), not a cascading render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshKeyStatus(); }, [refreshKeyStatus]);
  const [downloads, setDownloads] = useState<Map<string, { progress: number; cancel: () => void }>>(new Map());
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
  const rehabExerciseAssignments = snapshot?.rehabExerciseAssignments ?? [];
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

    const nextKeys = new Set(assignedExerciseKeySet);
    if (nextKeys.has(exerciseKey)) {
      nextKeys.delete(exerciseKey);
    } else {
      nextKeys.add(exerciseKey);
    }

    replaceRehabExerciseAssignments({
      patientId: patientRecordPatientId,
      carePlanId: activeCarePlan.planId,
      exerciseKeys: Array.from(nextKeys),
    });
    refresh();
  }, [
    activeCarePlan,
    assignedExerciseKeySet,
    patientRecordPatientId,
    refresh,
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

  const handleRerunElenaDemo = useCallback(async () => {
    setRerunningDemo(true);
    try {
      const patientId = await applyElenaGarciaDemoProfile();
      refresh();
      Alert.alert(
        'Demo persona loaded',
        'Elena Garcia (COPD + TBI) onboarding data has been saved and seeded. Open the Dashboard to view.',
      );
      void patientId;
    } catch (err) {
      Alert.alert(
        'Failed to load demo',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setRerunningDemo(false);
    }
  }, [refresh]);

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

  const handleDownload = useCallback((entry: ModelEntry) => {
    const handle = downloadModel(entry, null, {
      onProgress: (bytesWritten, totalBytes) => {
        const progress = totalBytes > 0 ? bytesWritten / totalBytes : 0;
        setDownloads((prev) => {
          const next = new Map(prev);
          next.set(entry.id, { progress, cancel: handle.cancel });
          return next;
        });
      },
      onComplete: () => {
        setDownloads((prev) => {
          const next = new Map(prev);
          next.delete(entry.id);
          return next;
        });
        Alert.alert('Download Complete', `${entry.displayName} is ready to use.`);
      },
      onError: (error) => {
        setDownloads((prev) => {
          const next = new Map(prev);
          next.delete(entry.id);
          return next;
        });
        Alert.alert('Download Failed', error);
      },
    });
    setDownloads((prev) => {
      const next = new Map(prev);
      next.set(entry.id, { progress: 0, cancel: handle.cancel });
      return next;
    });
  }, []);

  const handleDelete = useCallback((entry: ModelEntry) => {
    Alert.alert(
      'Remove Model',
      `Remove ${entry.displayName}? You'll need to download it again to use it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            if (slm.currentModelId === entry.id) {
              slm.unloadModel();
            }
            deleteModel(entry);
          },
        },
      ],
    );
  }, [slm]);

  const handleDeleteAll = useCallback(() => {
    Alert.alert(
      'Delete All Models',
      'This will remove all downloaded models. You\'ll need to download them again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: () => {
            if (slm.currentModelId) {
              slm.unloadModel();
            }
            const count = clearAllModels();
            Alert.alert('Complete', `Removed ${count} model${count !== 1 ? 's' : ''}.`);
          },
        },
      ],
    );
  }, [slm]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
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
              <Text style={styles.devLabel}>Concierge Management</Text>
              <Text style={styles.devInfo}>
                Policy: {slm.policy} - Status: {slm.loadStatus}
                {slm.currentModelId ? ` - Model: ${slm.currentModelId}` : ''}
              </Text>
              <View style={styles.modelRow}>
                {MODEL_CATALOG.map((m) => {
                  const installed = isModelInstalled(m);
                  const isActive = slm.currentModelId === m.id;
                  const download = downloads.get(m.id);
                  const isDownloading = !!download;
                  return (
                    <View key={m.id} style={styles.modelItem}>
                      <Text style={styles.modelName}>{m.displayName}</Text>
                      <Text style={styles.modelStatus}>
                        {isDownloading
                          ? `Downloading... ${Math.round(download.progress * 100)}%`
                          : installed
                            ? 'Installed'
                            : 'Not installed'}
                        {isActive ? ' - Active' : ''}
                      </Text>
                      {isDownloading ? (
                        <View style={styles.progressBar}>
                          <View
                            style={[
                              styles.progressFill,
                              { width: `${Math.round(download.progress * 100)}%` },
                            ]}
                          />
                        </View>
                      ) : null}
                      <View style={styles.modelActions}>
                        {!installed && !isDownloading ? (
                          <Pressable
                            style={styles.smallButton}
                            onPress={() => handleDownload(m)}>
                            <Text style={styles.smallButtonText}>Download</Text>
                          </Pressable>
                        ) : null}
                        {isDownloading ? (
                          <Pressable
                            style={[styles.smallButton, styles.dangerSmallButton]}
                            onPress={() => download.cancel()}>
                            <Text style={styles.smallButtonText}>Cancel</Text>
                          </Pressable>
                        ) : null}
                        {installed ? (
                          <>
                            <Pressable
                              style={[styles.smallButton, !installed && styles.disabledButton]}
                              disabled={!installed || slm.loadStatus === 'loading'}
                              onPress={() => slm.loadModel(m.id)}>
                              <Text style={styles.smallButtonText}>Load</Text>
                            </Pressable>
                            <Pressable
                              style={[styles.smallButton, styles.dangerSmallButton]}
                              onPress={() => handleDelete(m)}>
                              <Text style={styles.smallButtonText}>Remove</Text>
                            </Pressable>
                          </>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>

              <Text style={[styles.devLabel, { marginTop: 8 }]}>Default Concierge model (Demo auto-load)</Text>
              <Text style={styles.devInfo}>
                The model auto-loaded when a transient task acquires a lease in Demo
                mode. Currently: {settings.demoDefaultModelId ?? DEFAULT_SLM_MODEL_ID}
              </Text>
              <View style={styles.modelActions}>
                {MODEL_CATALOG.map((m) => {
                  const active = (settings.demoDefaultModelId ?? DEFAULT_SLM_MODEL_ID) === m.id;
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

              <Pressable
                style={[styles.actionButton, styles.unloadButton, !slm.currentModelId && styles.disabledActionButton]}
                disabled={!slm.currentModelId}
                onPress={() => slm.unloadModel()}>
                <Text style={styles.actionButtonText}>Unload Model</Text>
              </Pressable>

              <Pressable
                style={[styles.actionButton, styles.dangerButton]}
                onPress={handleDeleteAll}>
                <Text style={styles.actionButtonText}>Delete All Models</Text>
              </Pressable>

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

              <Text style={[styles.devLabel, { marginTop: 16 }]}>Clinical Evidence API Keys</Text>
              <Text style={styles.devInfo}>
                Optional. PubMed uses an NCBI key for higher rate limits. OpenFDA
                uses a key for higher rate limits.
              </Text>

              <View style={styles.keyLabelRow}>
                <Text style={[styles.devLabel, { marginTop: 8 }]}>NCBI API Key (PubMed)</Text>
                <Text style={[styles.keyStatusBadge, ncbiKeyStored ? styles.keyStatusStored : styles.keyStatusEmpty]}>
                  {ncbiKeyStored ? 'stored' : 'empty'}
                </Text>
              </View>
              <View style={styles.modelRow}>
                <View style={styles.modelItem}>
                  <TextInput
                    style={styles.ncbiInput}
                    value={ncbiKeyInput}
                    onChangeText={setNcbiKeyInput}
                    placeholder="Enter NCBI API key..."
                    placeholderTextColor={mutedText}
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
                <Text style={[styles.devLabel, { marginTop: 8 }]}>OpenFDA API Key</Text>
                <Text style={[styles.keyStatusBadge, openfdaKeyStored ? styles.keyStatusStored : styles.keyStatusEmpty]}>
                  {openfdaKeyStored ? 'stored' : 'empty'}
                </Text>
              </View>
              <View style={styles.modelRow}>
                <View style={styles.modelItem}>
                  <TextInput
                    style={styles.ncbiInput}
                    value={openfdaKeyInput}
                    onChangeText={setOpenfdaKeyInput}
                    placeholder="Enter OpenFDA API key..."
                    placeholderTextColor={mutedText}
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

              <View style={styles.keyLabelRow}>
                <Text style={[styles.devLabel, { marginTop: 8 }]}>UMLS API Key (Terminology Mapping)</Text>
                <Text style={[styles.keyStatusBadge, umlsKeyStored ? styles.keyStatusStored : styles.keyStatusEmpty]}>
                  {umlsKeyStored ? 'stored' : 'empty'}
                </Text>
              </View>
              <View style={styles.modelRow}>
                <View style={styles.modelItem}>
                  <TextInput
                    style={styles.ncbiInput}
                    value={umlsKeyInput}
                    onChangeText={setUmlsKeyInput}
                    placeholder="Enter UMLS API key..."
                    placeholderTextColor={mutedText}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <View style={styles.modelActions}>
                    <Pressable
                      style={styles.smallButton}
                      onPress={async () => {
                        await setUmlsApiKey(umlsKeyInput.trim());
                        setUmlsKeyInput('');
                        await refreshKeyStatus();
                        Alert.alert('Saved', 'UMLS API key stored securely.');
                      }}>
                      <Text style={styles.smallButtonText}>Save Key</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.smallButton, styles.dangerSmallButton]}
                      onPress={async () => {
                        await clearUmlsApiKey();
                        setUmlsKeyInput('');
                        await refreshKeyStatus();
                        Alert.alert('Cleared', 'UMLS API key removed.');
                      }}>
                      <Text style={styles.smallButtonText}>Clear</Text>
                    </Pressable>
                  </View>
                </View>
              </View>

              <Text style={[styles.devLabel, { marginTop: 16 }]}>Knowledge Cache</Text>
              <Text style={styles.devInfo}>
                Bundle status: {snapshot?.bundleStatus.state ?? 'unknown'}
                {snapshot?.bundleStatus.state === 'complete'
                  ? ` - ${snapshot.bundleStatus.chunksAdded} chunks added`
                  : ''}
                {snapshot?.bundleStatus.state === 'failed' && snapshot.bundleStatus.error
                  ? ` - ${snapshot.bundleStatus.error}`
                  : ''}
                {snapshot?.bundleStatus.updatedAt
                  ? `\nLast updated: ${snapshot.bundleStatus.updatedAt}`
                  : ''}
              </Text>
              <Text style={styles.devInfo}>
                Total chunks: {snapshot?.knowledgeStats.total ?? 0}
                {snapshot && snapshot.knowledgeStats.total > 0
                  ? Object.entries(snapshot.knowledgeStats.bySource)
                    .map(([src, count]) => `\n  ${src}: ${count}`)
                    .join('')
                  : ''}
              </Text>
              {snapshot && snapshot.knowledgeStats.total > 0 ? (
                <Pressable
                  style={[styles.actionButton, styles.dangerButton]}
                  onPress={() => {
                    clearKnowledgeCache();
                    refresh();
                    Alert.alert('Cleared', 'Knowledge cache cleared.');
                  }}>
                  <Text style={styles.actionButtonText}>Clear Knowledge Cache</Text>
                </Pressable>
              ) : null}

              <KnowledgeCacheViewer patientId={patientId} />

              <View style={styles.thresholdBlock}>
                <Text style={styles.thresholdTitle}>
                  Threshold personalization
                </Text>
                <Text style={styles.thresholdMuted}>
                  Queued anomaly-threshold suggestions. Apply or dismiss;
                  applying audits the change.
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
                          Recommended threshold:{' '}
                          {rec.recommendedThreshold.toFixed(3)}
                          {rec.adjustmentPct !== undefined
                            ? ` (${rec.adjustmentPct > 0 ? '+' : ''}${rec.adjustmentPct.toFixed(1)}%)`
                            : ''}
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

              <Text style={[styles.devLabel, { marginTop: 16 }]}>Import Record</Text>
              <Text style={styles.devInfo}>
                Import a zip of standardized CDA JSON files (the
                Sahlin longitudinal EHR dataset), a single CDA JSON, or a
                FHIR JSON bundle. Conditions are SNOMED-coded and
                cross-walked to ICD-10; narrative sections become
                SLM-retrievable knowledge chunks. See planning/33 for the
                full pipeline.
              </Text>
              <Pressable
                style={[styles.actionButton, importingEhr && styles.disabledActionButton]}
                disabled={importingEhr}
                onPress={handleImportEhrZip}>
                <Text style={styles.actionButtonText}>
                  {importingEhr
                    ? `Importing EHR… ${importProgress.done}/${importProgress.total}`
                    : 'Import EHR (zip of CDA JSON)'}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, importingEhr && styles.disabledActionButton]}
                disabled={importingEhr}
                onPress={handleImportEhrSingleFile}>
                <Text style={styles.actionButtonText}>
                  {importingEhr ? 'Importing…' : 'Import single CDA JSON'}
                </Text>
              </Pressable>

              <Text style={[styles.devLabel, { marginTop: 16 }]}>Demo Data</Text>
              <Text style={styles.devInfo}>
                Re-run onboarding with the pre-populated Elena Garcia demo
                bundle (ST-03: COPD + TBI). Saves the profile, seeds the
                database, and fires the clinical-evidence bundler.
              </Text>
              <Pressable
                style={[styles.actionButton, rerunningDemo && styles.disabledActionButton]}
                disabled={rerunningDemo}
                onPress={handleRerunElenaDemo}
              >
                <Text style={styles.actionButtonText}>
                  {rerunningDemo ? 'Loading Elena Garcia demo…' : 'Re-run onboarding with Elena Garcia demo'}
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
                <Text style={styles.thresholdMuted}>No active patient selected.</Text>
              ) : !activeCarePlan ? (
                <Text style={styles.thresholdMuted}>No active CarePlan available.</Text>
              ) : !uc3ExerciseAssignmentEligible ? (
                <Text style={styles.thresholdMuted}>
                  Active patient is not eligible for UC3 stroke rehabilitation exercise assignment.
                </Text>
              ) : (
                <>
                  <Text style={styles.devInfo}>
                    Development-only assignments for the active patient and active CarePlan.
                  </Text>
                  {DEVELOPMENT_UC3_REHAB_EXERCISES.map((exercise) => (
                    <View key={exercise.key} style={styles.inlineControlRow}>
                      <Text style={styles.inlineControlLabel}>{exercise.label}</Text>
                      <Switch
                        value={assignedExerciseKeySet.has(exercise.key)}
                        onValueChange={() => handleUc3ExerciseAssignmentToggle(exercise.key)}
                        trackColor={{ false: AppTheme.colors.border, true: AppTheme.colors.brandSoft }}
                        thumbColor={
                          assignedExerciseKeySet.has(exercise.key)
                            ? AppTheme.colors.brand
                            : AppTheme.colors.white
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
                ]}
                onPress={handleRunUc3Evaluation}
                disabled={runningUc3Evaluation}
                accessibilityRole="button"
                accessibilityLabel="Run UC3 evaluation"
              >
                <Text style={styles.actionButtonText}>Run UC3 evaluation</Text>
              </Pressable>
              {uc3EvaluationStatus ? (
                <View style={styles.uc3EvaluationStatusCard}>
                  <Text style={styles.uc3EvaluationStatusTitle}>
                    {uc3EvaluationStatus.title}
                  </Text>
                  {uc3EvaluationStatus.lines.map((line) => (
                    <Text key={line} style={styles.uc3EvaluationStatusLine}>
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
              <Text style={styles.devInfo}>
                Development-only manual run for the active patient. UC4 cards stay separate from emergency alerts.
              </Text>
              <Pressable
                style={[
                  styles.actionButton,
                  runningUc4Evaluation && styles.disabledActionButton,
                ]}
                onPress={handleRunUc4Evaluation}
                disabled={runningUc4Evaluation}
                accessibilityRole="button"
                accessibilityLabel="Run UC4 evaluation"
              >
                <Text style={styles.actionButtonText}>Run UC4 evaluation</Text>
              </Pressable>
              {uc4EvaluationStatus ? (
                <View style={styles.uc3EvaluationStatusCard}>
                  <Text style={styles.uc3EvaluationStatusTitle}>
                    {uc4EvaluationStatus.title}
                  </Text>
                  {uc4EvaluationStatus.lines.map((line) => (
                    <Text key={line} style={styles.uc3EvaluationStatusLine}>
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
              refresh={refresh}
            />
          </Section>
        ) : null}

        {isDeveloper ? (
          <Section title="Simulate care-team-required confirmation">
            <DemoMedicationConfirmationSettings
              patientId={patientId}
              snapshot={snapshot}
              refresh={refresh}
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
  refresh,
}: {
  patientId: string;
  snapshot: ReturnType<typeof usePatientRecord>['snapshot'];
  refresh: () => void;
}) {
  const conditions = snapshot?.conditions ?? EMPTY_CONDITIONS;
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
        <Text style={styles.thresholdMuted}>No active patient selected.</Text>
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

    updatePatientConditionRoles(patientId, rolesByConditionId);
    refresh();
    Alert.alert('Saved', 'Diagnosis roles updated for the active patient.');
  };

  return (
    <View style={styles.devSection}>
      <Text style={styles.thresholdMuted}>
        Choose the app-level primary diagnosis and active comorbidities. Unselected conditions are saved as history context.
      </Text>

      {conditions.length === 0 ? (
        <Text style={styles.thresholdMuted}>No conditions available.</Text>
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
              <View key={condition.conditionId} style={styles.conditionRoleRow}>
                <View style={styles.thresholdTextBlock}>
                  <Text style={styles.thresholdValue}>{condition.name}</Text>
                  <Text style={styles.thresholdMuted}>
                    {sourceSummary || 'Source timing unavailable'}
                  </Text>
                </View>
                <View style={styles.conditionRoleActions}>
                  <Pressable
                    style={[styles.roleButton, isPrimary && styles.roleButtonActive]}
                    onPress={() => handlePrimaryChange(condition.conditionId)}
                  >
                    <Text style={[styles.roleButtonText, isPrimary && styles.roleButtonTextActive]}>
                      Primary
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.roleButton,
                      isActive && styles.roleButtonActive,
                      isPrimary && styles.disabledButton,
                    ]}
                    disabled={isPrimary}
                    onPress={() => toggleActiveCondition(condition.conditionId)}
                  >
                    <Text style={[styles.roleButtonText, isActive && styles.roleButtonTextActive]}>
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

function DemoMedicationConfirmationSettings({
  patientId,
  snapshot,
  refresh,
}: {
  patientId: string;
  snapshot: ReturnType<typeof usePatientRecord>['snapshot'];
  refresh: () => void;
}) {
  if (!patientId || !snapshot?.patient) {
    return (
      <View style={styles.devSection}>
        <Text style={styles.thresholdMuted}>
          For demonstration only. Select medications that should behave as if confirmation was required by the patient&apos;s care team.
        </Text>
        <Text style={styles.thresholdMuted}>No active patient selected</Text>
      </View>
    );
  }

  const requirements = snapshot.medicationConfirmationRequirements;
  if (!requirements) {
    return (
      <View style={styles.devSection}>
        <Text style={styles.thresholdMuted}>
          For demonstration only. Select medications that should behave as if confirmation was required by the patient&apos;s care team.
        </Text>
        <Text style={styles.thresholdMuted}>Medication confirmation requirements unavailable</Text>
      </View>
    );
  }

  const importedMedications = snapshot.medications.filter((medication) => medication.source === 'fhir');

  const handleToggle = (medicationId: string, enabled: boolean) => {
    if (enabled) {
      setDemoMedicationConfirmationRequired(patientId, medicationId);
    } else {
      removeDemoMedicationConfirmationRequirement(patientId, medicationId);
    }
    refresh();
  };

  return (
    <View style={styles.devSection}>
      <Text style={styles.thresholdMuted}>
        For demonstration only. Select medications that should behave as if confirmation was required by the patient&apos;s care team.
      </Text>
      {importedMedications.length === 0 ? (
        <Text style={styles.thresholdMuted}>No medications provided</Text>
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
                <Text style={styles.thresholdValue}>{medication.name}</Text>
                <Text style={styles.thresholdMuted}>
                  {detail || 'Medication details not provided'}
                </Text>
              </View>
              <Switch
                value={isRequired}
                disabled={lockedByNonDemoSource}
                onValueChange={(enabled) => handleToggle(medication.medicationId, enabled)}
                trackColor={{ false: AppTheme.colors.border, true: AppTheme.colors.brandSoft }}
                thumbColor={isRequired ? AppTheme.colors.brand : AppTheme.colors.white}
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
            label={scope.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            value={active}
            expanded={false}
            onToggleExpand={() => {}}
            onValueChange={(v) => handleToggle(scope, v)}
            accessibilityHint="Allow location-aware support when a care workflow requests it."
          />
        );
      })}
    </View>
  );
}

function YourDecisionsSection({ patientId }: { patientId: string }) {
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
    <Section title="Your Decisions">
      <View style={styles.subsection}>
        {decisions.map((d, i) => (
          <View key={`${d.resourceId ?? d.auditId}-${i}`} style={styles.decisionRow}>
            <Text style={styles.decisionAction}>
              {d.action === 'override'
                ? 'You overrode'
                : d.action === 'confirm'
                  ? 'You confirmed'
                  : `You ${d.action}`}
            </Text>
            <Text style={styles.decisionTime}>
              {d.createdAt
                ? new Date(d.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : ''}
            </Text>
          </View>
        ))}
      </View>
    </Section>
  );
}

function AuditViewer({ patientId }: { patientId: string }) {
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
        <Text style={[styles.chainStatus, chainOk ? styles.chainOk : styles.chainBroken]}>
          Hash chain: {chainOk ? 'Intact' : 'Broken'}
        </Text>
      ) : null}
      {expanded && entries.length > 0 ? (
        <View style={styles.auditList}>
          {entries.map((e) => (
            <View key={e.auditId} style={styles.auditEntry}>
              <Text style={styles.auditText}>
                {e.createdAt.slice(11, 19)} - {e.actor} - {e.action} - {e.resourceType}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {expanded && entries.length === 0 ? (
        <Text style={styles.devInfo}>No audit entries found.</Text>
      ) : null}
    </View>
  );
}

function KnowledgeCacheViewer({ patientId }: { patientId: string }) {
  const { refresh: refreshSnapshot } = usePatientRecord();
  const [loaded, setLoaded] = useState(false);
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [expandedChunkId, setExpandedChunkId] = useState<string | null>(null);
  // Source groups are collapsed by default; this set tracks which are expanded.
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exportingZip, setExportingZip] = useState(false);
  const [enrichmentLogOpen, setEnrichmentLogOpen] = useState(false);
  const [enrichmentLog, setEnrichmentLog] = useState<PatientEnrichmentLogEntry[]>([]);

  const loadChunks = useCallback(() => {
    setChunks(getAllKnowledgeChunks());
    setEnrichmentLog(getEnrichmentLogForPatient(patientId, 20));
    setLoaded(true);
  }, [patientId]);

  // Refresh both the local chunk list AND the patient-record snapshot so the
  // Knowledge Cache stats counts + bundleStatus at the top of the block update
  // (they read from snapshot.knowledgeStats, which only changes on snapshot refresh).
  const refresh = useCallback(() => {
    setChunks(getAllKnowledgeChunks());
    setEnrichmentLog(getEnrichmentLogForPatient(patientId, 20));
    refreshSnapshot();
  }, [patientId, refreshSnapshot]);

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
      `Delete all "${source}" chunks?`,
      `This removes every chunk with source="${source}". Use Re-download to re-fetch.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: () => {
            const removed = deleteKnowledgeChunksBySource(source);
            refresh();
            Alert.alert('Deleted', `${removed} ${source} chunk${removed === 1 ? '' : 's'} removed.`);
          },
        },
      ],
    );
  }, [refresh]);

  const handleRedownloadAll = useCallback(async () => {
    setBusyId('__all__');
    try {
      const result = await redownloadAllForPatient(patientId);
      refresh();
      if (result.errors.length === 0) {
        Alert.alert('Re-downloaded', 'Knowledge cache rebuilt from current patient record.');
      } else {
        Alert.alert('Re-download completed with errors', result.errors.join('\n'));
      }
    } finally {
      setBusyId(null);
    }
  }, [patientId, refresh]);

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
          style={[styles.actionButton, busyId === '__all__' && styles.disabledActionButton]}
          onPress={handleRedownloadAll}
          disabled={busyId === '__all__'}
        >
          <Text style={styles.actionButtonText}>
            {busyId === '__all__' ? 'Re-downloading…' : 'Re-download all (from current record)'}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.actionButton, (exportingZip || chunks.length === 0) && styles.disabledActionButton]}
          onPress={() => void handleExportZip()}
          disabled={exportingZip || chunks.length === 0}
        >
          <Text style={styles.actionButtonText}>
            {exportingZip ? 'Exporting…' : 'Export as ZIP'}
          </Text>
        </Pressable>
      </View>

      {chunks.length === 0 ? (
        <Text style={styles.devInfo}>
          The knowledge cache is empty. It populates after onboarding when the
          condition-bundler fetches clinical knowledge chunks for the patient&apos;s
          conditions and medications.
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
                <Text style={styles.cacheSourceCaret}>
                  {isSourceExpanded ? '▾' : '▸'}
                </Text>
                <Text style={styles.cacheSourceLabel}>
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
                <View key={chunk.chunkId} style={styles.cacheChunkRow}>
                  <Pressable onPress={() => setExpandedChunkId(isOpen ? null : chunk.chunkId)}>
                    <Text style={styles.cacheChunkId}>{chunk.chunkId}</Text>
                    <Text style={styles.cacheChunkMeta}>
                      {chunk.conditions ? `conditions: ${chunk.conditions}` : 'no conditions'}
                      {' · '}uses: {chunk.useCount}
                      {chunk.documentType ? ` · ${chunk.documentType}` : ''}
                    </Text>
                    {isOpen ? (
                      <Text style={styles.cacheChunkText}>{chunk.text}</Text>
                    ) : (
                      <Text style={styles.cacheChunkPreview} numberOfLines={2}>
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
      <View style={styles.enrichmentLogBlock}>
        <Pressable
          style={styles.enrichmentLogHeader}
          onPress={() => setEnrichmentLogOpen((v) => !v)}
        >
          <Text style={styles.devLabel}>
            {enrichmentLogOpen ? '▾' : '▸'} Enrichment log ({enrichmentLog.length} entries)
          </Text>
        </Pressable>
        {enrichmentLogOpen ? (
          enrichmentLog.length === 0 ? (
            <Text style={styles.devInfo}>No enrichment entries yet.</Text>
          ) : (
            enrichmentLog.map((entry) => (
              <View key={entry.logId} style={styles.enrichmentLogRow}>
                <Text style={styles.enrichmentLogMeta}>
                  {entry.createdAt.slice(0, 19).replace('T', ' ')} · {entry.source} · {entry.action}
                  {entry.resultCount !== undefined ? ` · ${entry.resultCount} chunks` : ''}
                  {entry.latencyMs !== undefined ? ` · ${entry.latencyMs}ms` : ''}
                </Text>
                {entry.deidentifiedQuery ? (
                  <Text style={styles.enrichmentLogQuery}>{entry.deidentifiedQuery}</Text>
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
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
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
}) {
  return (
    <View style={styles.compactWrap}>
      <View style={styles.compactRow}>
        <Pressable
          style={styles.compactPressArea}
          onPress={() => onToggleExpand(id)}
          accessibilityRole="button"
          accessibilityLabel={`${accessibilityLabel ?? label} details`}
          accessibilityHint={expanded ? 'Collapse explanation' : accessibilityHint ?? 'Expand explanation'}
          accessibilityState={{ expanded }}
        >
          <Text style={styles.rowEmoji} accessibilityElementsHidden importantForAccessibility="no">
            {emoji}
          </Text>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.infoIcon}>{expanded ? '⌃' : 'ⓘ'}</Text>
        </Pressable>
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: AppTheme.colors.border, true: AppTheme.colors.brandSoft }}
          thumbColor={value ? AppTheme.colors.brand : AppTheme.colors.white}
          accessibilityRole="switch"
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ checked: value }}
        />
      </View>
      {expanded && explanation ? (
        <View style={styles.explanation}>
          <Text style={styles.explanationText}>{explanation}</Text>
          <Pressable
            style={styles.closeExplanation}
            onPress={() => onToggleExpand(id)}
            accessibilityRole="button"
            accessibilityLabel={`Close ${label} explanation`}
          >
            <Text style={styles.closeExplanationText}>Close</Text>
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
}: {
  id: ExpandableId;
  emoji: string;
  label: string;
  expanded: boolean;
  explanation?: string;
  onToggleExpand: (id: ExpandableId) => void;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.compactWrap}>
      <Pressable
        style={styles.actionCompactRow}
        onPress={() => onToggleExpand(id)}
        accessibilityRole="button"
        accessibilityLabel={`${label} details`}
        accessibilityHint={expanded ? 'Collapse details' : 'Expand details'}
        accessibilityState={{ expanded }}
      >
        <Text style={styles.rowEmoji} accessibilityElementsHidden importantForAccessibility="no">
          {emoji}
        </Text>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.chevron}>{expanded ? '⌃' : '›'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.explanation}>
          {explanation ? <Text style={styles.explanationText}>{explanation}</Text> : null}
          {children}
          <Pressable
            style={styles.closeExplanation}
            onPress={() => onToggleExpand(id)}
            accessibilityRole="button"
            accessibilityLabel={`Close ${label} details`}
          >
            <Text style={styles.closeExplanationText}>Close</Text>
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
  return (
    <Pressable
      style={styles.actionCompactRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={description}
    >
      <Text style={styles.rowEmoji} accessibilityElementsHidden importantForAccessibility="no">
        {emoji}
      </Text>
      <View style={styles.rowTextBlock}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AppTheme.colors.screen },
  content: { padding: 24, paddingBottom: 40, gap: 18 },
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
  infoIcon: {
    color: AppTheme.colors.textMuted,
    fontSize: 17,
    fontWeight: '900',
    paddingHorizontal: 4,
  },
  chevron: {
    color: AppTheme.colors.textMuted,
    fontSize: 22,
    fontWeight: '900',
    paddingHorizontal: 4,
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
