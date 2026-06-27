/**
 * Caregiver Preferences plus advanced developer settings.
 *
 * Preferences keeps caregiver-facing controls compact. Advanced Developer
 * Settings keeps demo, model, API, diagnostic, and reset tools behind the
 * existing Developer / Demo Mode switch.
 */

import { useCallback, useEffect, useState } from 'react';
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

import { ScreenHeader } from '@/components/ui/screen-header';
import { AppTheme } from '@/constants/theme';
import { useSettings } from '@/contexts/settings-context';
import { useSLM } from '@/contexts/slm-context';
import { useOrchestratorPatientId } from '@/contexts/orchestrator-context';
import { usePatientRecord } from '@/contexts/patient-record-context';
import { MODEL_CATALOG, type ModelEntry } from '@/inference/model-catalog';
import { isModelInstalled, deleteModel, clearAllModels } from '@/services/model-storage';
import { downloadModel } from '@/services/model-download';
import {
  clearKnowledgeCache,
  getActiveConsents,
  getAllKnowledgeChunks,
  getAuditEntriesForResource,
  getPendingThresholdRecommendations,
  resetDatabase,
  updateThresholdRecommendationStatus,
  verifyAuditChain,
  type ConsentToken,
  type KnowledgeChunk,
  type ThresholdRecommendation,
} from '@/data';
import { audit } from '@/services/audit/auditService';
import { grantConsent, revokeConsentAndAudit } from '@/services/consent/consentGate';
import { setNcbiApiKey, clearNcbiApiKey } from '@/services/ncbi-token-store';
import { setOpenFdaApiKey, clearOpenFdaApiKey } from '@/services/openfda-token-store';
import {
  exportPatientCcda,
  getRecordConsentStatus,
  setRecordConsent,
  type RecordConsentScope,
} from '@/services/records/recordsService';

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
    title: 'C-CDA export consent',
    subtitle: 'Allow exporting a C-CDA record for care coordination.',
  },
  {
    scope: 'fhir-share',
    emoji: '🔗',
    title: 'FHIR share consent',
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
  const { settings, setTheme, setNotificationPreferences } = useSettings();
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
          ? 'Consent granted for C-CDA export'
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
          ? 'Consent granted for C-CDA export'
          : 'Consent required before export',
      );
    }
  }, [patientId, recordConsentGranted]);

  const handlePatientCcdaExport = useCallback(() => {
    const result = exportPatientCcda(patientId);

    if (result.status === 'queued') {
      setRecordExportStatus('C-CDA export queued for sync');
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
        'Please turn on record export consent before exporting a C-CDA record.',
      );
      return;
    }

    setRecordExportStatus('C-CDA export failed');
    Alert.alert('Export failed', result.message);
  }, [patientId]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="Caregiver Concierge" title="Preferences" />

        <Section title="🔔 Notifications">
          <CompactToggleRow
            id="anomaly"
            emoji="🚨"
            label="Anomaly Alerts"
            value={settings.notifications.anomaly}
            expanded={expandedId === 'anomaly'}
            explanation="Alerts can notify you when vitals or behavior need attention. These alerts support caregiver review and do not replace clinical judgment."
            onToggleExpand={toggleExpanded}
            onValueChange={(v) => setNotificationPreferences({ anomaly: v })}
          />
          <CompactToggleRow
            id="medication"
            emoji="💊"
            label="Medication Reminders"
            value={settings.notifications.medication}
            expanded={expandedId === 'medication'}
            explanation="Medication reminders help keep scheduled doses visible. Timing still follows the care plan and reminder engine."
            onToggleExpand={toggleExpanded}
            onValueChange={(v) => setNotificationPreferences({ medication: v })}
          />
          <CompactToggleRow
            id="appointment"
            emoji="📅"
            label="Appointment Reminders"
            value={settings.notifications.appointment}
            expanded={expandedId === 'appointment'}
            explanation="Appointment reminders can notify you before scheduled visits. The lead time can be adjusted under Reminder Timing."
            onToggleExpand={toggleExpanded}
            onValueChange={(v) => setNotificationPreferences({ appointment: v })}
          />
          <CompactToggleRow
            id="care-task"
            emoji="🧩"
            label="Care Task Reminders"
            value={settings.notifications.careTask}
            expanded={expandedId === 'care-task'}
            explanation="Care task reminders support routine non-emergency tasks. They do not change the care plan or schedule clinical actions."
            onToggleExpand={toggleExpanded}
            onValueChange={(v) => setNotificationPreferences({ careTask: v })}
          />
          <CompactActionRow
            id="timing"
            emoji="⏰"
            label="Reminder Timing"
            expanded={expandedId === 'timing'}
            explanation="Set how many minutes before an appointment reminder should appear."
            onToggleExpand={toggleExpanded}
          >
            <View style={styles.inlineControlRow}>
              <Text style={styles.inlineControlLabel}>Appointment lead time</Text>
              <TextInput
                style={styles.numInput}
                value={String(settings.notifications.appointmentLeadTimeMin)}
                keyboardType="numeric"
                accessibilityLabel="Appointment reminder lead time in minutes"
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n)) setNotificationPreferences({ appointmentLeadTimeMin: n });
                }}
              />
            </View>
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
                      label="Export C-CDA"
                      description={recordExportStatus}
                      onPress={handlePatientCcdaExport}
                      accessibilityLabel="Export C-CDA record"
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
  const { snapshot, refresh } = usePatientRecord();
  const [expandedId, setExpandedId] = useState<ExpandableId | null>(null);
  const [ncbiKeyInput, setNcbiKeyInput] = useState('');
  const [openfdaKeyInput, setOpenFdaKeyInput] = useState('');
  const [downloads, setDownloads] = useState<Map<string, { progress: number; cancel: () => void }>>(new Map());
  const [thresholdRecs, setThresholdRecs] = useState<ThresholdRecommendation[]>([]);
  const [recVersion, setRecVersion] = useState(0);

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

        <Section title="🛠️ Developer / Demo">
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
              <Text style={styles.devLabel}>SLM Management</Text>
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

              <Text style={[styles.devLabel, { marginTop: 8 }]}>Default SLM Model (Demo auto-load)</Text>
              <Text style={styles.devInfo}>
                The model auto-loaded when a transient task acquires a lease in Demo
                mode. Currently: {settings.demoDefaultModelId ?? 'healthgpt-pro-4b'}
              </Text>
              <View style={styles.modelActions}>
                {MODEL_CATALOG.map((m) => {
                  const active = (settings.demoDefaultModelId ?? 'healthgpt-pro-4b') === m.id;
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
                onPress={() => router.push('/acute-anomaly')}>
                <Text style={styles.actionButtonText}>Acute Anomaly Demo</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={() => router.push('/slm')}>
                <Text style={styles.actionButtonText}>Raw SLM Chat</Text>
              </Pressable>

              <Text style={[styles.devLabel, { marginTop: 16 }]}>Clinical Evidence API Keys</Text>
              <Text style={styles.devInfo}>
                Optional. PubMed uses an NCBI key for higher rate limits. OpenFDA
                uses a key for higher rate limits.
              </Text>

              <Text style={[styles.devLabel, { marginTop: 8 }]}>NCBI API Key (PubMed)</Text>
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
                        Alert.alert('Saved', 'NCBI API key stored securely.');
                      }}>
                      <Text style={styles.smallButtonText}>Save Key</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.smallButton, styles.dangerSmallButton]}
                      onPress={async () => {
                        await clearNcbiApiKey();
                        setNcbiKeyInput('');
                        Alert.alert('Cleared', 'NCBI API key removed.');
                      }}>
                      <Text style={styles.smallButtonText}>Clear</Text>
                    </Pressable>
                  </View>
                </View>
              </View>

              <Text style={[styles.devLabel, { marginTop: 8 }]}>OpenFDA API Key</Text>
              <View style={styles.modelRow}>
                <View style={styles.modelItem}>
                  <TextInput
                    style={styles.ncbiInput}
                    value={openfdaKeyInput}
                    onChangeText={setOpenFdaKeyInput}
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
                        setOpenFdaKeyInput('');
                        Alert.alert('Saved', 'OpenFDA API key stored securely.');
                      }}>
                      <Text style={styles.smallButtonText}>Save Key</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.smallButton, styles.dangerSmallButton]}
                      onPress={async () => {
                        await clearOpenFdaApiKey();
                        setOpenFdaKeyInput('');
                        Alert.alert('Cleared', 'OpenFDA API key removed.');
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

              <KnowledgeCacheViewer />

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
                Import a C-CDA or FHIR JSON record from the care team. Coming soon.
              </Text>
              <Pressable
                style={[styles.actionButton, styles.disabledActionButton]}
                disabled
                onPress={() => {}}>
                <Text style={styles.actionButtonText}>Import Record (Coming Soon)</Text>
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
      </ScrollView>
    </SafeAreaView>
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

function KnowledgeCacheViewer() {
  const [loaded, setLoaded] = useState(false);
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadChunks = useCallback(() => {
    setChunks(getAllKnowledgeChunks());
    setLoaded(true);
  }, []);

  const closeViewer = useCallback(() => {
    setLoaded(false);
    setChunks([]);
    setExpandedId(null);
  }, []);

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
      <Pressable style={[styles.actionButton, styles.closeButton]} onPress={closeViewer}>
        <Text style={styles.actionButtonText}>Close Chunk Viewer</Text>
      </Pressable>

      {chunks.length === 0 ? (
        <Text style={styles.devInfo}>
          The knowledge cache is empty. It populates after onboarding when the
          condition-bundler fetches clinical knowledge chunks for the patient&apos;s
          conditions and medications.
        </Text>
      ) : (
        sources.map((src) => (
          <View key={src} style={styles.cacheSourceGroup}>
            <Text style={styles.cacheSourceLabel}>
              {src} ({bySource[src].length})
            </Text>
            {bySource[src].map((chunk) => {
              const isOpen = expandedId === chunk.chunkId;
              return (
                <Pressable
                  key={chunk.chunkId}
                  style={styles.cacheChunkRow}
                  onPress={() => setExpandedId(isOpen ? null : chunk.chunkId)}
                >
                  <Text style={styles.cacheChunkId}>{chunk.chunkId}</Text>
                  <Text style={styles.cacheChunkMeta}>
                    {chunk.conditions ? `conditions: ${chunk.conditions}` : 'no conditions'}
                    {' - '}uses: {chunk.useCount}
                  </Text>
                  {isOpen ? (
                    <Text style={styles.cacheChunkText}>{chunk.text}</Text>
                  ) : (
                    <Text style={styles.cacheChunkPreview} numberOfLines={2}>
                      {chunk.text}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))
      )}
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
    gap: 3,
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
});
