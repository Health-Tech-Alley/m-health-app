/**
 * Unified alert detail screen.
 *
 * Pushed on top of the tab shell. Handles all three steel threads via a
 * single `alertId` param. For severity-3 alerts it renders an emergency
 * banner with direct-action options (Call 911, Go to ER, Contact Provider,
 * Acknowledge, Explain, Add Note). For severity 1–2 it shows vitals context.
 *
 * "Ask the Concierge" opens SlmInsightSheet (Care-style minimize/scroll popup)
 * on top of this per-alert screen — it does not leave the alert focus.
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
import { severityColor } from '@/constants/user-terms';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
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
import { SlmInsightSheet } from '@/components/slm-insight-sheet';
import {
  useOrchestratorPatientId,
  useOrchestratorSafe,
} from '@/contexts/orchestrator-context';
import { executeNextStep } from '@/orchestration/next-steps';
import type { NextStepActionId } from '@/data/types';
import { buildAlertExplainPrompt } from '@/services/alerts/alertExplainPrompt';
import type { TranslateFn, TranslationKey } from '@/localization/i18n';

const TEAL = AppTheme.colors.brand;
const BG = AppTheme.colors.screen;
const DARK = AppTheme.colors.text;
const MUTED = AppTheme.colors.textSoft;
const RED = AppTheme.colors.danger;

const ALERT_STATUS_LABEL_KEYS: Record<string, TranslationKey> = {
  open: 'dashboard.alertsLog.status.open',
  acknowledged: 'dashboard.alertsLog.status.acknowledged',
  resolved: 'dashboard.alertsLog.status.resolved',
  escalated: 'dashboard.alertsLog.status.escalated',
  dismissed: 'dashboard.alertsLog.status.dismissed',
  removed: 'dashboard.alertsLog.status.removed',
};

function formatAlertDetailSeverityLabel(
  severity: number | null | undefined,
  t: TranslateFn,
): string {
  if (severity === 3) return t('dashboard.alertSeverity.urgent');
  if (severity === 2) return t('dashboard.alertSeverity.needsAttention');
  if (severity === 1) return t('dashboard.alertSeverity.headsUp');
  if (severity === 0) return t('dashboard.alertSeverity.info');
  return t('dashboard.alertSeverity.alert');
}

function formatAlertDetailStatus(status: string, t: TranslateFn): string {
  const key = ALERT_STATUS_LABEL_KEYS[status];
  return key ? t(key) : status;
}

function formatAnalysisValue(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase();
}

export default function AlertDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const isDark = theme.appBackground === '#000000';
  const { alertId } = useLocalSearchParams<{ alertId: string }>();
  const orchestrator = useOrchestratorSafe();
  const activePatientId = useOrchestratorPatientId();

  const [version, setVersion] = useState(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [observationCodes, setObservationCodes] = useState<string[]>([]);
  const [conciergeOpen, setConciergeOpen] = useState(false);
  const [conciergeRequest, setConciergeRequest] = useState<{
    title: string;
    prompt: string;
  } | null>(null);

  const loadedAlert = alertId ? getAlertById(alertId) : null;
  const alertUnavailableMessage = !alertId
    ? t('alertDetail.unavailable.noneSelected')
    : !loadedAlert
      ? t('alertDetail.unavailable.notFound')
      : activePatientId && loadedAlert.patientId !== activePatientId
        ? t('alertDetail.unavailable.differentPatient')
        : null;
  const alert = alertUnavailableMessage ? null : loadedAlert;

  // Compute the 24h-ago cutoff once (impure Date.now() allowed in a useState
  // initializer, not during render).
  // Note: do NOT preload_warm here. Dynamic mode unloads on last lease release,
  // so a warm lease released right before SlmInsightSheet opens races unload vs
  // load and makes the first "Ask the Concierge" fail. The sheet owns load.
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
    if (!event || event.patientId !== alert.patientId) return null;
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
    setStatusMsg(t('alertDetail.status.noteSaved'));
    bump();
  }, [alert, noteText, bump, t]);

  const askAssistant = useCallback(() => {
    if (!alert) return;

    const topFeatures = mlDetails?.topFeatures ?? [];
    const prompt = buildAlertExplainPrompt({
      title: alert.title,
      body: alert.body,
      severity: alert.severity,
      status: alert.status,
      createdAt: alert.createdAt,
      mlScore: alert.mlScore ?? alert.aeScore ?? null,
      initialAnomalyType:
        alert.initialAnomalyType ?? mlDetails?.event?.initialAnomalyType ?? null,
      postHitlAnomalyType:
        alert.postHitlAnomalyType ?? mlDetails?.event?.postHitlAnomalyType ?? null,
      topFeatures,
      rawVitals: (mlDetails?.rawVitals ?? null) as Record<string, unknown> | null,
      observationCodes,
      recentSpo2: recentSpo2.map((s) => ({ value: s.value })),
      recentHr: recentHr.map((s) => ({ value: s.value })),
    });
    setConciergeRequest({
      title:
        alert.severity === 3
          ? t('alertDetail.concierge.emergencyTitle')
          : t('alertDetail.concierge.title'),
      prompt,
    });
    setConciergeOpen(true);
  }, [alert, mlDetails, observationCodes, recentHr, recentSpo2, t]);

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
          const severity =
            result.finalDecision?.final_severity ?? result.post_hitl_severity ?? null;
          setStatusMsg(
            t('alertDetail.status.observationsSavedRerun', {
              post: formatAnalysisValue(String(post)),
              severity:
                typeof severity === 'number'
                  ? formatAlertDetailSeverityLabel(severity, t)
                  : '-',
            }),
          );
        } else {
          setStatusMsg(t('alertDetail.status.observationsSavedNoVitals'));
        }
      } else {
        setStatusMsg(t('alertDetail.status.observationsSaved'));
      }
      bump();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : t('alertDetail.status.applyFailed'));
    } finally {
      setBusy(false);
    }
  }, [alert, observationCodes, bump, orchestrator, t]);

  if (!alert) {
    return (
      <SafeAreaView style={[styles.safeArea, themedStyles.safeArea]} edges={['top', 'bottom']}>
        <View style={styles.missing}>
          <Text style={[styles.muted, themedStyles.supportingText]}>{alertUnavailableMessage}</Text>
          <Pressable
            style={styles.button}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Text style={styles.buttonText}>{t('common.back')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const color = severityColor(alert.severity);
  const isEmergency = alert.severity === 3;

  return (
    <SafeAreaView style={[styles.safeArea, themedStyles.safeArea]} edges={['top', 'bottom']}>
      <ScrollView
        style={themedStyles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topBar}>
          <Pressable
            style={styles.backButton}
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Text style={[styles.backLink, themedStyles.brandText]}>{'\u2190'} {t('common.back')}</Text>
          </Pressable>
        </View>

        {/* Alert header */}
        <View style={[styles.alertHeader, { backgroundColor: color }]}>
          <Text style={styles.alertEyebrow}>
            {formatAlertDetailSeverityLabel(alert.severity, t)}
          </Text>
          <Text style={styles.alertTitle}>{alert.title}</Text>
          {alert.body ? <Text style={styles.alertBody}>{alert.body}</Text> : null}
          <Text style={styles.alertStatus}>
            {t('alertDetail.statusLabel', {
              status: formatAlertDetailStatus(alert.status, t),
            })}
          </Text>
        </View>

        {isEmergency && (
          <View style={[styles.emergencyBanner, themedStyles.emergencyBanner]}>
            <Text style={[styles.emergencyHeadline, themedStyles.dangerText]}>
              {t('alertDetail.emergency.title')}
            </Text>
            <Text style={[styles.emergencySubtext, themedStyles.dangerText]}>
              {t('alertDetail.emergency.body')}
            </Text>
          </View>
        )}

        {/* Vitals context (severity 1–2) */}
        {!isEmergency && (
          <View style={[styles.card, themedStyles.card]}>
            <Text style={[styles.cardTitle, themedStyles.sectionText]}>
              {t('alertDetail.vitals.title')}
            </Text>
            <VitalsInline label={t('alertDetail.vitals.spo2')} samples={recentSpo2.map((s) => s.value)} unit="%" />
            <VitalsInline label={t('alertDetail.vitals.heartRate')} samples={recentHr.map((s) => s.value)} unit="bpm" />
          </View>
        )}

        {/* ML event details (UC2 decision-layer output) */}
        {mlDetails && (
          <View style={[styles.card, themedStyles.card]}>
            <Text style={[styles.cardTitle, themedStyles.sectionText]}>
              {t('alertDetail.analysis.title')}
            </Text>
            {mlDetails.event.initialAnomalyType && (
              <Text style={[styles.mlLine, themedStyles.primaryText]}>
                {t('alertDetail.analysis.pattern', {
                  pattern: formatAnalysisValue(mlDetails.event.initialAnomalyType),
                })}
                {mlDetails.event.postHitlAnomalyType &&
                mlDetails.event.postHitlAnomalyType !== mlDetails.event.initialAnomalyType
                  ? ` \u2192 ${formatAnalysisValue(mlDetails.event.postHitlAnomalyType)}`
                  : ''}
              </Text>
            )}
            {mlDetails.ratio !== null && (
              <Text style={[styles.mlLine, themedStyles.primaryText]}>
                {t('alertDetail.analysis.confidenceRatio', {
                  ratio: mlDetails.ratio.toFixed(2),
                })}
              </Text>
            )}
            {mlDetails.ruleEngine && mlDetails.ruleEngine.is_emergency && (
              <Text style={[styles.mlLine, themedStyles.dangerText]}>
                {t('alertDetail.analysis.ruleEngineEmergency', {
                  reasons: mlDetails.ruleEngine.reasons.join(', '),
                })}
              </Text>
            )}
            {mlDetails.topFeatures.length > 0 && (
              <>
                <Text style={[styles.mlSubTitle, themedStyles.brandText]}>
                  {t('alertDetail.analysis.topFeatures')}
                </Text>
                {mlDetails.topFeatures.slice(0, 5).map(([name, val]) => (
                  <Text key={name} style={[styles.mlFeatureLine, themedStyles.supportingText]}>
                    {'\u2022'} {name}: {val.toFixed(2)}
                  </Text>
                ))}
              </>
            )}
          </View>
        )}

        {/* Emergency actions */}
        {isEmergency && (
          <View style={[styles.card, themedStyles.card]}>
            <Text style={[styles.cardTitle, themedStyles.sectionText]}>{t('alertDetail.actions.title')}</Text>
            <ActionRow
              label={t('alertDetail.actions.call911')}
              accessibilityLabel={t('dashboard.critical.call911')}
              onPress={() => handleAction('call_911')}
              disabled={busy}
              danger
            />
            <ActionRow
              label={t('alertDetail.actions.goToEr')}
              accessibilityLabel={t('alertDetail.actions.goToErA11y')}
              onPress={() => handleAction('go_to_er')}
              disabled={busy}
              danger
            />
            <ActionRow
              label={t('alertDetail.actions.contactProvider')}
              accessibilityLabel={t('dashboard.critical.contactProvider')}
              onPress={() => handleAction('contact_pcp')}
              disabled={busy}
            />
            <ActionRow
              label={t('alertDetail.actions.findCare')}
              accessibilityLabel={t('alertDetail.actions.findCareA11y')}
              onPress={() => handleAction('geofence_service')}
              disabled={busy}
            />
          </View>
        )}

        {/* Caregiver observations (severity 1-2 HITL) */}
        {!isEmergency && (
          <View style={[styles.card, themedStyles.card]}>
            <Text style={[styles.cardTitle, themedStyles.sectionText]}>{t('alertDetail.observations.title')}</Text>
            <Text style={[styles.observationHint, themedStyles.supportingText]}>
              {t('alertDetail.observations.hint')}
            </Text>
            <ObservationPicker
              selected={observationCodes}
              onChange={setObservationCodes}
            />
            {observationCodes.length > 0 && (
              <ActionRow
                label={t('alertDetail.observations.save')}
                onPress={saveObservations}
                disabled={busy}
                primary
              />
            )}
          </View>
        )}

        {/* Explain + note */}
        <View style={[styles.card, themedStyles.card]}>
          <Text style={[styles.cardTitle, themedStyles.sectionText]}>{t('alertDetail.notes.title')}</Text>
          <ActionRow
            label={isEmergency ? t('alertDetail.notes.askOptional') : t('alertDetail.notes.ask')}
            onPress={askAssistant}
            disabled={busy}
            primary
          />
          <ActionRow label={t('alertDetail.notes.add')} onPress={() => setNoteOpen(true)} disabled={busy} />
          {alert.status !== 'acknowledged' && alert.status !== 'resolved' && (
            <ActionRow label={t('alertDetail.notes.acknowledge')} onPress={acknowledge} disabled={busy} />
          )}
          <ActionRow label={t('alertDetail.notes.dismiss')} onPress={dismiss} disabled={busy} subtle />
        </View>

        {statusMsg ? (
          <View style={[styles.statusBox, themedStyles.statusBox]}>
            <Text style={[styles.statusText, themedStyles.primaryText]}>{statusMsg}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Note modal */}
      <Modal visible={noteOpen} animationType="slide" transparent onRequestClose={() => setNoteOpen(false)}>
        <View style={[styles.modalOverlay, themedStyles.modalOverlay]}>
          <View style={[styles.modalCard, themedStyles.modalCard]}>
            <Text style={[styles.modalTitle, themedStyles.primaryText]}>{t('alertDetail.notes.add')}</Text>
            <TextInput
              style={[styles.noteInput, themedStyles.noteInput]}
              value={noteText}
              onChangeText={setNoteText}
              placeholder={t('alertDetail.notes.placeholder')}
              placeholderTextColor={isDark ? theme.appTextMuted : '#9AA4A8'}
              multiline
              textAlignVertical="top"
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setNoteOpen(false)}>
                <Text style={[styles.modalCancelText, themedStyles.supportingText]}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable style={styles.modalSave} onPress={saveNote}>
                <Text style={styles.buttonText}>{t('alertDetail.notes.save')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Care-style Concierge popup on top of this per-alert screen (minimize/scroll). */}
      <SlmInsightSheet
        visible={conciergeOpen && conciergeRequest !== null}
        onClose={() => {
          setConciergeOpen(false);
          setConciergeRequest(null);
        }}
        title={conciergeRequest?.title ?? t('alertDetail.concierge.title')}
        prompt={conciergeRequest?.prompt ?? ''}
        reason="care_explain"
        allowMinimize
      />
    </SafeAreaView>
  );
}

function VitalsInline({ label, samples, unit }: { label: string; samples: number[]; unit: string }) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const isDark = theme.appBackground === '#000000';
  const latest = samples.length > 0 ? samples[samples.length - 1] : null;
  const trend =
    samples.length >= 2 ? samples[samples.length - 1] - samples[0] : 0;
  const trendColor =
    trend < 0
      ? isDark ? AppTheme.colors.dangerLight : RED
      : isDark ? AppTheme.colors.brandPale : TEAL;
  return (
    <View style={[styles.vitalRow, themedStyles.vitalRow]}>
      <Text style={[styles.vitalName, themedStyles.primaryText]}>{label}</Text>
      <Text style={[styles.vitalLatest, themedStyles.primaryText]}>
        {latest != null ? `${Math.round(latest * 100) / 100}` : '—'}
        <Text style={[styles.vitalUnit, themedStyles.supportingText]}> {unit}</Text>
      </Text>
      {samples.length >= 2 ? (
        <Text style={[styles.vitalTrend, { color: trendColor }]}>
          {trend < 0 ? '▼' : '▲'} {Math.abs(Math.round(trend * 100) / 100)}
        </Text>
      ) : null}
    </View>
  );
}

function ActionRow({
  label,
  accessibilityLabel,
  onPress,
  disabled,
  danger,
  primary,
  subtle,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
  subtle?: boolean;
}) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const style = [
    styles.action,
    themedStyles.action,
    danger && styles.actionDanger,
    danger && themedStyles.actionDanger,
    primary && styles.actionPrimary,
    subtle && styles.actionSubtle,
    subtle && themedStyles.actionSubtle,
    disabled && styles.actionDisabled,
  ];
  const textStyle = [
    styles.actionText,
    themedStyles.actionText,
    danger && styles.actionTextDanger,
    danger && themedStyles.actionTextDanger,
    primary && styles.actionTextPrimary,
    subtle && styles.actionTextSubtle,
    subtle && themedStyles.actionTextSubtle,
    disabled && styles.actionTextDisabled,
    disabled && themedStyles.actionTextDisabled,
  ];
  return (
    <Pressable
      style={style}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';
  const brandText = isDark ? AppTheme.colors.brandPale : TEAL;
  const dangerText = isDark ? AppTheme.colors.dangerLight : RED;

  return StyleSheet.create({
    safeArea: {
      backgroundColor: theme.appBackground,
    },
    scrollView: {
      backgroundColor: theme.appBackground,
    },
    card: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    primaryText: {
      color: theme.appText,
    },
    supportingText: {
      color: theme.appTextSupporting,
    },
    sectionText: {
      color: theme.appSectionText,
    },
    brandText: {
      color: brandText,
    },
    dangerText: {
      color: dangerText,
    },
    emergencyBanner: {
      backgroundColor: isDark ? 'rgba(240, 6, 22, 0.16)' : AppTheme.colors.dangerLight,
      borderColor: isDark ? 'rgba(255, 233, 236, 0.34)' : '#FFC7CE',
    },
    vitalRow: {
      borderBottomColor: theme.appBorder,
    },
    action: {
      borderColor: theme.appBorder,
      backgroundColor: theme.appControlSurface,
    },
    actionDanger: {
      borderColor: isDark ? 'rgba(255, 233, 236, 0.34)' : '#FFC7CE',
      backgroundColor: isDark ? 'rgba(240, 6, 22, 0.16)' : AppTheme.colors.dangerLight,
    },
    actionSubtle: {
      borderColor: theme.appBorder,
      backgroundColor: theme.appSurface,
    },
    actionText: {
      color: theme.appText,
    },
    actionTextDanger: {
      color: dangerText,
    },
    actionTextSubtle: {
      color: theme.appTextSupporting,
    },
    actionTextDisabled: {
      color: isDark ? theme.appTextMuted : MUTED,
    },
    statusBox: {
      backgroundColor: isDark ? theme.appControlSurface : AppTheme.colors.brandSoft,
      borderColor: isDark ? theme.appBorder : AppTheme.colors.brandPale,
    },
    modalOverlay: {
      backgroundColor: isDark ? 'rgba(0,0,0,0.72)' : 'rgba(7,26,51,0.48)',
    },
    modalCard: {
      backgroundColor: theme.appSurface,
    },
    noteInput: {
      color: theme.appText,
      backgroundColor: isDark ? theme.appInputBackground : AppTheme.colors.softSurface,
      borderColor: theme.appBorder,
    },
  });
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
