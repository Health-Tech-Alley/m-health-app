/**
 * Full settings screen component — model management, notifications, profiles,
 * consent, data, developer mode, and about. Shared by the settings tab and
 * the standalone settings route.
 */

import { useState, useCallback } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Switch,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useSettings } from '@/contexts/settings-context';
import { useSLM } from '@/contexts/slm-context';
import { useOrchestratorPatientId } from '@/contexts/orchestrator-context';
import { MODEL_CATALOG } from '@/inference/model-catalog';
import { isModelInstalled } from '@/services/model-storage';
import {
  getActiveConsents,
  verifyAuditChain,
  getAuditEntriesForResource,
  resetDatabase,
  type ConsentToken,
} from '@/data';
import { grantConsent, revokeConsentAndAudit } from '@/services/consent/consentGate';
import { exportCcd } from '@/services/export/ccdaExportService';

const teal = '#0E6F68';
const darkText = '#123433';
const mutedText = '#526866';
const lightBg = '#EEF7F6';
const cardBg = '#FFFFFF';
const borderColor = '#D9E7E5';
const dangerRed = '#B42318';

export function SettingsScreen() {
  const router = useRouter();
  const { settings, isDeveloper, toggleMode, setTheme, setNotificationPreferences } = useSettings();
  const slm = useSLM();
  const patientId = useOrchestratorPatientId();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        {/* Appearance */}
        <Section title="Appearance">
          <Row label="Theme">
            <View style={styles.segmented}>
              {(['light', 'dark', 'system'] as const).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.segButton, settings.theme === t && styles.segButtonActive]}
                  onPress={() => setTheme(t)}>
                  <Text style={[styles.segText, settings.theme === t && styles.segTextActive]}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Row>
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          <ToggleRow
            label="Anomaly alerts"
            value={settings.notifications.anomaly}
            onValueChange={(v) => setNotificationPreferences({ anomaly: v })}
          />
          <ToggleRow
            label="Medication reminders"
            value={settings.notifications.medication}
            onValueChange={(v) => setNotificationPreferences({ medication: v })}
          />
          <ToggleRow
            label="Appointment reminders"
            value={settings.notifications.appointment}
            onValueChange={(v) => setNotificationPreferences({ appointment: v })}
          />
          <Row label="Appointment lead time (min)">
            <TextInput
              style={styles.numInput}
              value={String(settings.notifications.appointmentLeadTimeMin)}
              keyboardType="numeric"
              onChangeText={(v) => {
                const n = parseInt(v, 10);
                if (!isNaN(n)) setNotificationPreferences({ appointmentLeadTimeMin: n });
              }}
            />
          </Row>
          <ToggleRow
            label="Care task reminders"
            value={settings.notifications.careTask}
            onValueChange={(v) => setNotificationPreferences({ careTask: v })}
          />
        </Section>

        {/* Consent Management */}
        <Section title="Consent Management">
          <ConsentManagement patientId={patientId} />
        </Section>

        {/* Data */}
        <Section title="Data">
          <Pressable
            style={styles.actionButton}
            onPress={() => {
              try {
                const result = exportCcd(patientId);
                Alert.alert('Export', result.queued ? 'C-CDA record exported and queued for sync.' : 'C-CDA record exported.');
              } catch (err) {
                Alert.alert('Export Failed', err instanceof Error ? err.message : String(err));
              }
            }}>
            <Text style={styles.actionButtonText}>Export C-CDA Record</Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, styles.dangerButton]}
            onPress={() => {
              Alert.alert(
                'Reset All Data',
                'This will erase all patient data, alerts, medications, and settings. Continue?',
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
        </Section>

        {/* Developer Section */}
        <Section title="Developer">
          <ToggleRow
            label="Developer mode"
            value={isDeveloper}
            onValueChange={toggleMode}
          />
          {isDeveloper && (
            <View style={styles.devSection}>
              <Text style={styles.devLabel}>SLM Management</Text>
              <Text style={styles.devInfo}>
                Policy: {slm.policy} · Status: {slm.loadStatus}
                {slm.currentModelId ? ` · Model: ${slm.currentModelId}` : ''}
              </Text>
              <View style={styles.modelRow}>
                {MODEL_CATALOG.map((m) => {
                  const installed = isModelInstalled(m);
                  const isActive = slm.currentModelId === m.id;
                  return (
                    <View key={m.id} style={styles.modelItem}>
                      <Text style={styles.modelName}>{m.displayName}</Text>
                      <Text style={styles.modelStatus}>
                        {installed ? 'Installed' : 'Not installed'}
                        {isActive ? ' · Active' : ''}
                      </Text>
                      <View style={styles.modelActions}>
                        <Pressable
                          style={[styles.smallButton, !installed && styles.disabledButton]}
                          disabled={!installed || slm.loadStatus === 'loading'}
                          onPress={() => slm.loadModel(m.id)}>
                          <Text style={styles.smallButtonText}>Load</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.smallButton, styles.dangerSmallButton]}
                          disabled={!isActive}
                          onPress={() => slm.unloadModel()}>
                          <Text style={styles.smallButtonText}>Unload</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>

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

              <AuditViewer patientId={patientId} />
            </View>
          )}
        </Section>

        {/* About */}
        <Section title="About">
          <Text style={styles.aboutText}>Caregiver Concierge: ACCESS-DP</Text>
          <Text style={styles.aboutText}>Health Tech Alley · v1.0.0</Text>
          <Text style={styles.aboutMuted}>
            This app is a caregiver support prototype and does not replace emergency care or professional medical advice.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function ConsentManagement({ patientId }: { patientId: string }) {
  const [consents, setConsents] = useState<ConsentToken[]>(() => getActiveConsents(patientId));
  const consentScopes = ['ccda_export', 'location_access', 'fhir-share', 'pharmacy-communicator', 'provider-message'] as const;

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
          <ToggleRow
            key={scope}
            label={scope.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            value={active}
            onValueChange={(v) => handleToggle(scope, v)}
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

  return (
    <View>
      <Pressable style={styles.actionButton} onPress={loadEntries}>
        <Text style={styles.actionButtonText}>View Audit Log</Text>
      </Pressable>
      {chainOk !== null && (
        <Text style={[styles.chainStatus, chainOk ? styles.chainOk : styles.chainBroken]}>
          Hash chain: {chainOk ? 'Intact ✓' : 'BROKEN ✗'}
        </Text>
      )}
      {expanded && entries.length > 0 && (
        <View style={styles.auditList}>
          {entries.map((e) => (
            <View key={e.auditId} style={styles.auditEntry}>
              <Text style={styles.auditText}>
                {e.createdAt.slice(11, 19)} · {e.actor} · {e.action} · {e.resourceType}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// --- Reusable components ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

function ToggleRow({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: '#D9E7E5', true: teal }} />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: lightBg },
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  title: { fontSize: 28, fontWeight: '900', color: darkText, marginBottom: 4 },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: mutedText,
  },
  card: {
    backgroundColor: cardBg,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  rowLabel: { fontSize: 15, color: darkText, fontWeight: '500', flex: 1 },
  segmented: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor },
  segButton: { paddingHorizontal: 12, paddingVertical: 8 },
  segButtonActive: { backgroundColor: teal },
  segText: { fontSize: 13, color: darkText, fontWeight: '600' },
  segTextActive: { color: '#FFFFFF' },
  numInput: {
    width: 60,
    borderWidth: 1,
    borderColor,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 15,
    color: darkText,
    textAlign: 'center',
  },
  actionButton: {
    backgroundColor: teal,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  dangerButton: { backgroundColor: dangerRed },
  devSection: { gap: 12, marginTop: 8 },
  devLabel: { fontSize: 14, fontWeight: '700', color: darkText },
  devInfo: { fontSize: 12, color: mutedText },
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
  modelActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  smallButton: {
    backgroundColor: teal,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  smallButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  disabledButton: { opacity: 0.4 },
  dangerSmallButton: { backgroundColor: dangerRed },
  aboutText: { fontSize: 14, color: darkText, fontWeight: '500' },
  aboutMuted: { fontSize: 12, color: mutedText, lineHeight: 18, marginTop: 4 },
  auditList: { marginTop: 8, gap: 4 },
  auditEntry: { paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: borderColor },
  auditText: { fontSize: 11, color: mutedText, fontFamily: 'monospace' },
  chainStatus: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  chainOk: { color: teal },
  chainBroken: { color: dangerRed },
});
