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

import { AppTheme } from '@/constants/theme';
import { severityColor, severityLabel } from '@/constants/user-terms';
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
import { useOrchestratorSafe } from '@/contexts/orchestrator-context';
import { executeNextStep } from '@/orchestration/next-steps';
import type { NextStepActionId } from '@/data/types';
import { getRecentReadingsFromRedux } from '@/services/ml/alert-ml-service';

const TEAL = AppTheme.colors.brand;
const BG = AppTheme.colors.screen;
const DARK = AppTheme.colors.text;
const MUTED = AppTheme.colors.textSoft;
const RED = AppTheme.colors.danger;

export default function AlertDetailScreen() {
  const router = useRouter();
  const { alertId } = useLocalSearchParams<{ alertId: string }>();
  const orchestrator = useOrchestratorSafe();

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
    const sinceMs = new Date(since).getTime();
    const spo2FromRedux = getRecentReadingsFromRedux(alert.patientId, 'spo2', sinceMs, 8);
    const hrFromRedux = getRecentReadingsFromRedux(alert.patientId, 'heart_rate', sinceMs, 8);
    const spo2 = (
      spo2FromRedux.length > 0
        ? spo2FromRedux
        : getRecentHealthSamples(alert.patientId, 'spo2', since, 8)
    ).reverse();
    const hr = (
      hrFromRedux.length > 0
        ? hrFromRedux
        : getRecentHealthSamples(alert.patientId, 'heart_rate', since, 8)
    ).reverse();
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

  const saveObservations = useCallback(async () => {
    if (!alert || observationCodes.length === 0) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      insertCaregiverAction({
        actionId: `act-${Date.now()}`,
        alertId: alert.alertId,
        patientId: alert.patientId,
        caregiverId: 'caregiver-1',
        type: 'log_observation',
        payloadJson: JSON.stringify({ observationCodes }),
        createdAt: new Date().toISOString(),
      });

      // Full UC2 HITL re-run (not log-only) so explain uses post-HITL context.
      if (orchestrator) {
        const result = await orchestrator.reRunHitlForAlert(alert.alertId, observationCodes);
        if (result) {
          const post =
            result.postHitlAnomalyType ?? result.post_hitl_anomaly_type ?? 'updated';
          setStatusMsg(
            `Observations saved · Health Monitor re-run: ${String(post).replace(/_/g, ' ').toLowerCase()} (severity ${result.finalDecision?.final_severity ?? result.post_hitl_severity ?? '—'}).`,
          );
        } else {
          setStatusMsg('Observations saved. (No stored vitals for Health Monitor re-run.)');
        }
      } else {
        setStatusMsg('Observations saved.');
      }
      bump();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to apply observations.');
    } finally {
      setBusy(false);
    }
  }, [alert, observationCodes, bump, orchestrator]);

  if (!alert) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.missing}>
          <Text style={styles.muted}>Alert not found.</Text>
          <Pressable style={styles.button} onPress={() => router.back()}>
            <Text style={styles.buttonText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const color = severityColor(alert.severity);
  const isEmergency = alert.severity === 3;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topBar}>
          <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backLink}>← Back</Text>
          </Pressable>
        </View>

        {/* Alert header */}
        <View style={[styles.alertHeader, { backgroundColor: color }]}>
          <Text style={styles.alertEyebrow}>
            {severityLabel(alert.severity)}
          </Text>
          <Text style={styles.alertTitle}>{alert.title}</Text>
          {alert.body ? <Text style={styles.alertBody}>{alert.body}</Text> : null}
          <Text style={styles.alertStatus}>Status: {alert.status}</Text>
        </View>

        {isEmergency && (
          <View style={styles.emergencyBanner}>
            <Text style={styles.emergencyHeadline}>⚠ This is an emergency</Text>
            <Text style={styles.emergencySubtext}>
              If the situation is life-threatening, act now. You can still ask the Concierge
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
            <Text style={styles.cardTitle}>Health Monitor analysis</Text>
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
          <Text style={styles.cardTitle}>Concierge & Notes</Text>
          <ActionRow
            label={isEmergency ? 'Ask the Concierge (optional)' : 'Ask the Concierge'}
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
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 124,
    gap: 18,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  backButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  backLink: {
    color: TEAL,
    fontWeight: '900',
    fontSize: 15,
  },
  alertHeader: {
    borderRadius: AppTheme.radius.card,
    padding: 22,
    gap: 10,
    ...AppTheme.shadow,
  },
  alertEyebrow: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    opacity: 0.9,
  },
  alertTitle: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '900',
    lineHeight: 31,
  },
  alertBody: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    opacity: 0.95,
    lineHeight: 23,
  },
  alertStatus: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    opacity: 0.85,
    marginTop: 2,
  },
  emergencyBanner: {
    backgroundColor: AppTheme.colors.dangerLight,
    borderRadius: AppTheme.radius.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: '#FFC7CE',
    gap: 8,
  },
  emergencyHeadline: {
    color: RED,
    fontSize: 18,
    fontWeight: '900',
  },
  emergencySubtext: {
    color: RED,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
  },
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    ...AppTheme.shadow,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: AppTheme.colors.sectionText,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  mlLine: {
    fontSize: 14,
    color: DARK,
    lineHeight: 21,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  mlSubTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: TEAL,
    marginTop: 10,
    marginBottom: 4,
  },
  mlFeatureLine: {
    fontSize: 13,
    color: MUTED,
    lineHeight: 20,
    fontWeight: '700',
  },
  observationHint: {
    fontSize: 13,
    color: MUTED,
    fontWeight: '700',
    lineHeight: 19,
    marginBottom: 8,
  },
  vitalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AppTheme.colors.border,
  },
  vitalName: {
    flex: 1,
    color: DARK,
    fontWeight: '900',
    fontSize: 15,
  },
  vitalLatest: {
    fontSize: 20,
    fontWeight: '900',
    color: DARK,
  },
  vitalUnit: {
    fontSize: 12,
    color: MUTED,
    fontWeight: '800',
  },
  vitalTrend: {
    fontSize: 13,
    fontWeight: '900',
    minWidth: 60,
    textAlign: 'right',
  },
  action: {
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: AppTheme.radius.lg,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  actionDanger: {
    borderColor: '#FFC7CE',
    backgroundColor: AppTheme.colors.dangerLight,
  },
  actionPrimary: {
    borderColor: TEAL,
    backgroundColor: TEAL,
  },
  actionSubtle: {
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
  },
  actionDisabled: {
    opacity: 0.5,
  },
  actionText: {
    color: DARK,
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 20,
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
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: AppTheme.radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: AppTheme.colors.brandPale,
  },
  statusText: {
    color: DARK,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
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
    fontWeight: '700',
  },
  button: {
    backgroundColor: TEAL,
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: AppTheme.radius.md,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(7,26,51,0.48)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: AppTheme.colors.surface,
    borderTopLeftRadius: AppTheme.radius.xl,
    borderTopRightRadius: AppTheme.radius.xl,
    padding: 24,
    gap: 14,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: DARK,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: AppTheme.radius.lg,
    padding: 14,
    minHeight: 120,
    fontSize: 15,
    color: DARK,
    backgroundColor: AppTheme.colors.softSurface,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancel: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  modalCancelText: {
    color: MUTED,
    fontWeight: '900',
    fontSize: 15,
  },
  modalSave: {
    backgroundColor: TEAL,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: AppTheme.radius.md,
  },
});
