/**
 * Unified alert detail screen.
 *
 * Pushed on top of the tab shell. Handles all three steel threads via a
 * single `alertId` param. For severity-3 alerts it renders an emergency
 * banner with direct-action options (Call 911, Go to ER, Contact Provider,
 * Acknowledge, Explain, Add Note). For severity 1–2 it shows vitals context
 * and routes to the shared SLM explain screen.
 */

import { useCallback, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getAlertById,
  getAnomalyConfidenceRatio,
  getMlEventForAlert,
  getRecentHealthSamples,
  insertCaregiverAction,
  parseRawVitals,
  parseRuleEngine,
  parseTopFeatures,
  updateAlertStatus,
} from '@/data';
import { ObservationPicker } from '@/components/ObservationPicker';
import { executeNextStep } from '@/orchestration/next-steps';
import type { NextStepActionId } from '@/data/types';

const TEAL = '#0E6F68';
const BG = '#EEF7F6';
const DARK = '#123433';
const MUTED = '#526866';
const RED = '#B42318';
const ORANGE = '#B54708';

const SEVERITY_COLOR: Record<number, string> = { 3: RED, 2: ORANGE, 1: TEAL };
const SEVERITY_LABEL: Record<number, string> = {
  3: 'Emergency',
  2: 'Urgent',
  1: 'Info',
};

export default function AlertDetailScreen() {
  const router = useRouter();
  const { alertId } = useLocalSearchParams<{ alertId: string }>();

  const [version, setVersion] = useState(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [observationCodes, setObservationCodes] = useState<string[]>([]);

  const alert = alertId ? getAlertById(alertId) : null;

  // Compute the 24h-ago cutoff once (impure Date.now() allowed in a useState
  // initializer, not during render).
  const [since] = useState(() =>
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  );

  // Pull recent vitals for context. Memoized so the DB reads only run when
  // the alert identity changes, not on every render.
  const { recentSpo2, recentHr } = useMemo(() => {
    if (!alert) return { recentSpo2: [], recentHr: [] };
    const spo2 = getRecentHealthSamples(alert.patientId, 'spo2', since, 8).reverse();
    const hr = getRecentHealthSamples(alert.patientId, 'heart_rate', since, 8).reverse();
    return { recentSpo2: spo2, recentHr: hr };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert?.alertId, since]);

  // Structured ML event for this alert (UC2 decision-layer output): contextual
  // anomaly type, top features, feature quality, score ratio, rule engine.
  const mlDetails = useMemo(() => {
    if (!alert) return null;
    const event = getMlEventForAlert(alert.alertId);
    if (!event) return null;
    return {
      event,
      topFeatures: parseTopFeatures(event),
      ruleEngine: parseRuleEngine(event),
      rawVitals: parseRawVitals(event),
      ratio: getAnomalyConfidenceRatio(event),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert?.alertId, version]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  void version;

  const handleAction = useCallback(
    async (actionId: NextStepActionId) => {
      if (!alert) return;
      setBusy(true);
      setStatusMsg(null);
      try {
        const result = await executeNextStep(actionId, {
          patientId: alert.patientId,
          alertId: alert.alertId,
          caregiverId: 'caregiver-1',
        });
        setStatusMsg(result.message);
        bump();
      } catch (err) {
        setStatusMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [alert, bump],
  );

  const acknowledge = useCallback(() => {
    if (!alert) return;
    updateAlertStatus(alert.alertId, 'acknowledged');
    bump();
  }, [alert, bump]);

  const dismiss = useCallback(() => {
    if (!alert) return;
    updateAlertStatus(alert.alertId, 'resolved');
    router.back();
  }, [alert, router]);

  const saveNote = useCallback(() => {
    if (!alert || !noteText.trim()) return;
    insertCaregiverAction({
      actionId: `act-${Date.now()}`,
      alertId: alert.alertId,
      patientId: alert.patientId,
      caregiverId: 'caregiver-1',
      type: 'log_observation',
      payloadJson: JSON.stringify({ note: noteText.trim() }),
      createdAt: new Date().toISOString(),
    });
    setNoteText('');
    setNoteOpen(false);
    setStatusMsg('Note saved.');
    bump();
  }, [alert, noteText, bump]);

  const askAssistant = useCallback(() => {
    if (!alert) return;
    router.push({ pathname: '/slm-explain', params: { alertId: alert.alertId } });
  }, [alert, router]);

  const saveObservations = useCallback(() => {
    if (!alert || observationCodes.length === 0) return;
    insertCaregiverAction({
      actionId: `act-${Date.now()}`,
      alertId: alert.alertId,
      patientId: alert.patientId,
      caregiverId: 'caregiver-1',
      type: 'log_observation',
      payloadJson: JSON.stringify({ observationCodes }),
      createdAt: new Date().toISOString(),
    });
    setStatusMsg('Observations saved.');
    bump();
  }, [alert, observationCodes, bump]);

  if (!alert) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.missing}>
          <Text style={styles.muted}>Alert not found.</Text>
          <Pressable style={styles.button} onPress={() => router.back()}>
            <Text style={styles.buttonText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const color = SEVERITY_COLOR[alert.severity] ?? TEAL;
  const isEmergency = alert.severity === 3;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backLink}>← Back</Text>
          </Pressable>
        </View>

        {/* Alert header */}
        <View style={[styles.alertHeader, { backgroundColor: color }]}>
          <Text style={styles.alertEyebrow}>
            {SEVERITY_LABEL[alert.severity]} · Severity {alert.severity}
          </Text>
          <Text style={styles.alertTitle}>{alert.title}</Text>
          {alert.body ? <Text style={styles.alertBody}>{alert.body}</Text> : null}
          <Text style={styles.alertStatus}>Status: {alert.status}</Text>
        </View>

        {isEmergency && (
          <View style={styles.emergencyBanner}>
            <Text style={styles.emergencyHeadline}>⚠ This is an emergency</Text>
            <Text style={styles.emergencySubtext}>
              If the situation is life-threatening, act now. You can still ask the assistant
              for an explanation afterwards.
            </Text>
          </View>
        )}

        {/* Vitals context (severity 1–2) */}
        {!isEmergency && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Recent Vitals (24h)</Text>
            <VitalsInline label="SpO2" samples={recentSpo2.map((s) => s.value)} unit="%" />
            <VitalsInline label="Heart Rate" samples={recentHr.map((s) => s.value)} unit="bpm" />
          </View>
        )}

        {/* ML event details (UC2 decision-layer output) */}
        {mlDetails && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>ML Analysis</Text>
            {mlDetails.event.initialAnomalyType && (
              <Text style={styles.mlLine}>
                Pattern: {mlDetails.event.initialAnomalyType.replace(/_/g, ' ').toLowerCase()}
                {mlDetails.event.postHitlAnomalyType &&
                mlDetails.event.postHitlAnomalyType !== mlDetails.event.initialAnomalyType
                  ? ` → ${mlDetails.event.postHitlAnomalyType.replace(/_/g, ' ').toLowerCase()}`
                  : ''}
              </Text>
            )}
            {mlDetails.ratio !== null && (
              <Text style={styles.mlLine}>
                Confidence ratio: {mlDetails.ratio.toFixed(2)} (higher = more confident)
              </Text>
            )}
            {mlDetails.ruleEngine && mlDetails.ruleEngine.is_emergency && (
              <Text style={[styles.mlLine, { color: RED }]}>
                Rule engine: emergency ({mlDetails.ruleEngine.reasons.join(', ')})
              </Text>
            )}
            {mlDetails.topFeatures.length > 0 && (
              <>
                <Text style={styles.mlSubTitle}>Top contributing features</Text>
                {mlDetails.topFeatures.slice(0, 5).map(([name, val]) => (
                  <Text key={name} style={styles.mlFeatureLine}>
                    • {name}: {val.toFixed(2)}
                  </Text>
                ))}
              </>
            )}
          </View>
        )}

        {/* Emergency actions */}
        {isEmergency && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Take Action</Text>
            <ActionRow label="📞 Call 911" onPress={() => handleAction('call_911')} disabled={busy} danger />
            <ActionRow label="🏥 Go to nearest ER" onPress={() => handleAction('go_to_er')} disabled={busy} danger />
            <ActionRow label="👨‍⚕️ Contact Provider" onPress={() => handleAction('contact_pcp')} disabled={busy} />
            <ActionRow label="💊 Find nearby pharmacy / urgent care" onPress={() => handleAction('geofence_service')} disabled={busy} />
          </View>
        )}

        {/* Caregiver observations (severity 1-2 HITL) */}
        {!isEmergency && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>What did you notice?</Text>
            <Text style={styles.observationHint}>
              Select anything unusual around this time. This feeds the anomaly
              analysis and is logged to the audit trail.
            </Text>
            <ObservationPicker
              selected={observationCodes}
              onChange={setObservationCodes}
            />
            {observationCodes.length > 0 && (
              <ActionRow
                label="Save observations"
                onPress={saveObservations}
                disabled={busy}
                primary
              />
            )}
          </View>
        )}

        {/* Explain + note */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Assistant & Notes</Text>
          <ActionRow
            label={isEmergency ? 'Ask the assistant (optional)' : 'Ask the assistant'}
            onPress={askAssistant}
            disabled={busy}
            primary
          />
          <ActionRow label="Add a note" onPress={() => setNoteOpen(true)} disabled={busy} />
          {alert.status !== 'acknowledged' && alert.status !== 'resolved' && (
            <ActionRow label="Acknowledge alert" onPress={acknowledge} disabled={busy} />
          )}
          <ActionRow label="Dismiss alert" onPress={dismiss} disabled={busy} subtle />
        </View>

        {statusMsg ? (
          <View style={styles.statusBox}>
            <Text style={styles.statusText}>{statusMsg}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Note modal */}
      <Modal visible={noteOpen} animationType="slide" transparent onRequestClose={() => setNoteOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add a note</Text>
            <TextInput
              style={styles.noteInput}
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Describe what you observed or did…"
              placeholderTextColor="#9AA4A8"
              multiline
              textAlignVertical="top"
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setNoteOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSave} onPress={saveNote}>
                <Text style={styles.buttonText}>Save note</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function VitalsInline({ label, samples, unit }: { label: string; samples: number[]; unit: string }) {
  const latest = samples.length > 0 ? samples[samples.length - 1] : null;
  const trend =
    samples.length >= 2 ? samples[samples.length - 1] - samples[0] : 0;
  return (
    <View style={styles.vitalRow}>
      <Text style={styles.vitalName}>{label}</Text>
      <Text style={styles.vitalLatest}>
        {latest != null ? `${Math.round(latest * 100) / 100}` : '—'}
        <Text style={styles.vitalUnit}> {unit}</Text>
      </Text>
      {samples.length >= 2 ? (
        <Text style={[styles.vitalTrend, trend < 0 ? { color: RED } : { color: TEAL }]}>
          {trend < 0 ? '▼' : '▲'} {Math.abs(Math.round(trend * 100) / 100)}
        </Text>
      ) : null}
    </View>
  );
}

function ActionRow({
  label,
  onPress,
  disabled,
  danger,
  primary,
  subtle,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
  subtle?: boolean;
}) {
  const style = [
    styles.action,
    danger && styles.actionDanger,
    primary && styles.actionPrimary,
    subtle && styles.actionSubtle,
    disabled && styles.actionDisabled,
  ];
  const textStyle = [
    styles.actionText,
    danger && styles.actionTextDanger,
    primary && styles.actionTextPrimary,
    subtle && styles.actionTextSubtle,
    disabled && styles.actionTextDisabled,
  ];
  return (
    <Pressable style={style} onPress={onPress} disabled={disabled}>
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: BG,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 14,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backLink: {
    color: TEAL,
    fontWeight: '700',
    fontSize: 15,
  },
  alertHeader: {
    borderRadius: 20,
    padding: 18,
    gap: 6,
  },
  alertEyebrow: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    opacity: 0.9,
  },
  alertTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
  },
  alertBody: {
    color: '#FFFFFF',
    fontSize: 15,
    opacity: 0.95,
    lineHeight: 21,
  },
  alertStatus: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    opacity: 0.85,
    marginTop: 4,
  },
  emergencyBanner: {
    backgroundColor: '#FEE4E2',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: RED,
    gap: 6,
  },
  emergencyHeadline: {
    color: RED,
    fontSize: 17,
    fontWeight: '800',
  },
  emergencySubtext: {
    color: RED,
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E4E7EC',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: MUTED,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  mlLine: {
    fontSize: 14,
    color: DARK,
    lineHeight: 20,
    textTransform: 'capitalize',
  },
  mlSubTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: TEAL,
    marginTop: 8,
    marginBottom: 4,
  },
  mlFeatureLine: {
    fontSize: 13,
    color: MUTED,
    lineHeight: 19,
  },
  observationHint: {
    fontSize: 12,
    color: MUTED,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  vitalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4E7EC',
  },
  vitalName: {
    flex: 1,
    color: DARK,
    fontWeight: '700',
    fontSize: 15,
  },
  vitalLatest: {
    fontSize: 18,
    fontWeight: '800',
    color: DARK,
  },
  vitalUnit: {
    fontSize: 12,
    color: MUTED,
    fontWeight: '600',
  },
  vitalTrend: {
    fontSize: 13,
    fontWeight: '700',
    minWidth: 60,
    textAlign: 'right',
  },
  action: {
    borderWidth: 1,
    borderColor: '#D9E7E5',
    backgroundColor: '#F7FAF9',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  actionDanger: {
    borderColor: RED,
    backgroundColor: '#FEE4E2',
  },
  actionPrimary: {
    borderColor: TEAL,
    backgroundColor: TEAL,
  },
  actionSubtle: {
    borderColor: '#E4E7EC',
    backgroundColor: '#FFFFFF',
  },
  actionDisabled: {
    opacity: 0.5,
  },
  actionText: {
    color: DARK,
    fontSize: 15,
    fontWeight: '700',
  },
  actionTextDanger: {
    color: RED,
  },
  actionTextPrimary: {
    color: '#FFFFFF',
  },
  actionTextSubtle: {
    color: MUTED,
  },
  actionTextDisabled: {
    color: MUTED,
  },
  statusBox: {
    backgroundColor: '#EAFBF7',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: TEAL,
  },
  statusText: {
    color: DARK,
    fontSize: 14,
    fontWeight: '600',
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  muted: {
    color: MUTED,
    fontSize: 15,
  },
  button: {
    backgroundColor: TEAL,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(18,52,51,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: DARK,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: '#D9E7E5',
    borderRadius: 12,
    padding: 12,
    minHeight: 120,
    fontSize: 15,
    color: DARK,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancel: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  modalCancelText: {
    color: MUTED,
    fontWeight: '700',
    fontSize: 15,
  },
  modalSave: {
    backgroundColor: TEAL,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
});
