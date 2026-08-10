/**
 * Critical-alert popup overlay.
 *
 * Renders the severity-3 active alert as a transient red dialogue (Modal)
 * instead of a persistent card. Shown/hidden by `CriticalAlertProvider`.
 *
 * Actions:
 *   - Call 911 / Go to ER / Contact Provider (emergency deep-links, audit-logged)
 *   - Close — hide for this session (reappears when the Care tab is re-opened)
 *   - Dismiss — permanently suppress (confirmation prompt; alert stays in the
 *     Dashboard alerts log as inactive, retained for audit)
 *   - View full alert → /alert-detail
 *
 * This is the popup successor to the old persistent `ActiveAlertCard`.
 */

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppIcon } from '@/components/AppIcon';
import { AppTheme } from '@/constants/theme';
import { useCriticalAlert } from '@/contexts/critical-alert-context';
import { getMlEventForAlert, parseRawVitals, type MlEvent } from '@/data';
import { HARD_EMERGENCY_THRESHOLDS } from '@/ml-models/uc2-decision-layer/uc2Constants';
import { executeNextStep } from '@/orchestration/next-steps';
import type { NextStepActionId } from '@/data/types';
import { useActivePatientView } from '@/hooks/useActivePatientView';
import { useTranslation } from '@/hooks/use-translation';
import type { TranslateFn } from '@/localization/i18n';
import { displayEntered, formatPossessive, getPatientDisplayName } from '@/utils/patientDisplay';

type AlertMetricVitals = {
  blood_oxygen?: number;
  heart_rate?: number;
  respiratory_rate?: number;
  stress_level?: number;
};

function metricVitalsFromEvent(event: MlEvent | null): AlertMetricVitals {
  const raw = event ? parseRawVitals(event) : null;
  if (!raw) return {};
  const maybeEnvelope = raw as { contract?: unknown; input?: unknown };
  return maybeEnvelope.contract === 'AppleWatchVitalsInput' && maybeEnvelope.input && typeof maybeEnvelope.input === 'object'
    ? maybeEnvelope.input as AlertMetricVitals
    : raw as AlertMetricVitals;
}

function formatMetric(v: number | undefined, unit: string): string {
  return v !== undefined && v !== null && Number.isFinite(v)
    ? `${Math.round(v * 100) / 100}${unit}`
    : '—';
}

function formatRelativeTime(iso: string, t: TranslateFn): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return t('dashboard.time.recent');
  const minutes = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (minutes < 1) return t('dashboard.time.justNow');
  if (minutes < 60) return t('dashboard.time.minutesAgoShort', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('dashboard.time.hoursAgoShort', { count: hours });
  return t('dashboard.time.daysAgoShort', { count: Math.round(hours / 24) });
}

export function CriticalAlertDialog() {
  const router = useRouter();
  const { alert, visible, closeForSession, dismiss } = useCriticalAlert();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const activePatient = useActivePatientView();
  const patientDisplayName = getPatientDisplayName(activePatient);

  const mlEvent = useMemo<MlEvent | null>(() => {
    if (!alert) return null;
    try {
      return getMlEventForAlert(alert.alertId);
    } catch {
      return null;
    }
  }, [alert?.alertId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alert) return null;

  const vitals = metricVitalsFromEvent(mlEvent);
  const isEmergencyFastPath = alert.pipelinePath === 'RULE_ENGINE_EMERGENCY_FAST_PATH';
  // Care soft-NLU path inserts severity-3 without an ML event / watch vitals.
  const isCaregiverReported = alert.pipelinePath === 'caregiver_reported_emergency';
  const spo2Cutoff = isEmergencyFastPath
    ? `${HARD_EMERGENCY_THRESHOLDS.blood_oxygen_lte}%`
    : activePatient?.spo2Cutoff;
  const hasSpo2 = Number.isFinite(vitals.blood_oxygen);
  const metrics = [
    {
      label: 'SpO₂',
      value: formatMetric(vitals.blood_oxygen, '%'),
      // Avoid a blank SpO₂ dash on caregiver-reported (no sensor sample).
      show: hasSpo2,
    },
    {
      label: t('dashboard.critical.spo2Cutoff'),
      value: displayEntered(spo2Cutoff),
      show: !isCaregiverReported || hasSpo2,
    },
    {
      label: t('dashboard.critical.baselineHr'),
      value: displayEntered(activePatient?.baselineHeartRate),
      show: !isCaregiverReported || hasSpo2,
    },
  ].filter((m) => m.show);
  const contextualType =
    mlEvent?.initialAnomalyType ?? alert.initialAnomalyType ?? undefined;
  const contextLabel =
    isEmergencyFastPath || isCaregiverReported
      ? t('dashboard.critical.context.path')
      : t('dashboard.critical.context.pattern');
  const contextValue = isEmergencyFastPath
    ? t('dashboard.critical.context.emergencyFastPath')
    : isCaregiverReported
      ? t('dashboard.critical.context.caregiverReported')
      : contextualType?.replace(/_/g, ' ').toLowerCase();
  const visibleAlertBody =
    activePatient && alert.body
      ? alert.body.replace(
          /^([^\s'’]+(?:\s+[^\s'’]+)*)['’]s\b/,
          `${formatPossessive(patientDisplayName)}`,
        )
      : alert.body;
  const fallbackAlertBody = t('dashboard.critical.fallbackBody', {
    patientName: patientDisplayName,
    patientStatusOwner: formatPossessive(patientDisplayName),
  });

  async function handleAction(actionId: NextStepActionId) {
    if (!alert) return;
    setBusy(true);
    try {
      await executeNextStep(actionId, {
        patientId: alert.patientId,
        alertId: alert.alertId,
        caregiverId: 'caregiver-1',
      });
    } finally {
      setBusy(false);
    }
  }

  function handleDismiss() {
    if (!alert) return;
    Alert.alert(
      t('dashboard.critical.dismissDialog.title'),
      t('dashboard.critical.dismissDialog.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.dismiss'),
          style: 'destructive',
          onPress: () => dismiss(alert.alertId),
        },
      ],
    );
  }

  function openDetail() {
    if (!alert) return;
    router.push({ pathname: '/alert-detail', params: { alertId: alert.alertId } });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={closeForSession}
    >
      <Pressable style={styles.overlay} onPress={closeForSession}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
            <View style={styles.headerRow}>
              <View style={styles.iconCircle}>
                <AppIcon name="alert" size={28} color={AppTheme.colors.white} />
              </View>
              <View style={styles.titleBlock}>
                <Text style={styles.eyebrow}>{t('dashboard.critical.activeEmergency')}</Text>
                <Text style={styles.title}>{alert.title}</Text>
                <Text style={styles.subtitle}>
                  {formatRelativeTime(alert.createdAt, t)}
                </Text>
              </View>
              <View style={styles.urgentPill}>
                <Text style={styles.urgentText}>{t('dashboard.critical.urgent')}</Text>
              </View>
            </View>

            {metrics.length > 0 && (
              <View style={styles.metricRow}>
                {metrics.map((m) => (
                  <View key={m.label} style={styles.metricBox}>
                    <Text style={styles.metricLabel}>{m.label}</Text>
                    <Text style={styles.metricValue}>{m.value}</Text>
                  </View>
                ))}
              </View>
            )}

            {contextValue && (
              <Text style={styles.contextLine}>
                {contextLabel}: {contextValue}
              </Text>
            )}

            <Text style={styles.bodyText}>
              {visibleAlertBody
                ? visibleAlertBody
                : fallbackAlertBody}
              <Text style={styles.boldText}> {t('dashboard.critical.youDecide')}</Text>
            </Text>

            <Text style={styles.promptText}>{t('dashboard.critical.prompt')}</Text>

            <Pressable
              style={styles.callButton}
              onPress={() => handleAction('call_911')}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('dashboard.critical.call911')}
            >
              <Text style={styles.callButtonText}>{t('dashboard.critical.call911')}</Text>
            </Pressable>

            <View style={styles.twoColumnActions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => handleAction('go_to_er')}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('dashboard.critical.goToEr')}
              >
                <Text style={styles.secondaryButtonText}>{t('dashboard.critical.goToEr')}</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => handleAction('contact_pcp')}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('dashboard.critical.contactProvider')}
              >
                <Text style={styles.secondaryButtonText}>{t('dashboard.critical.contactProvider')}</Text>
              </Pressable>
            </View>

            <Pressable
              onPress={openDetail}
              accessibilityRole="link"
              accessibilityLabel={t('dashboard.critical.viewFullAlertA11y')}
            >
              <Text style={styles.footerLink}>{t('dashboard.critical.viewFullAlert')}</Text>
            </Pressable>

            <View style={styles.dialogActions}>
              <Pressable
                style={[styles.dialogButton, styles.closeButton]}
                onPress={closeForSession}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <Text style={styles.closeButtonText}>{t('common.close')}</Text>
              </Pressable>
              <Pressable
                style={[styles.dialogButton, styles.dismissButton]}
                onPress={handleDismiss}
                accessibilityRole="button"
                accessibilityLabel={t('common.dismiss')}
              >
                <Text style={styles.dismissButtonText}>{t('common.dismiss')}</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              {t('dashboard.critical.hint')}
            </Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: AppTheme.colors.danger,
    borderRadius: AppTheme.radius.card,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  sheetContent: {
    padding: 22,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  titleBlock: {
    flex: 1,
  },
  eyebrow: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: {
    color: AppTheme.colors.white,
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 26,
  },
  subtitle: {
    color: AppTheme.colors.white,
    fontSize: 14,
    marginTop: 4,
    opacity: 0.9,
  },
  urgentPill: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  urgentText: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  metricRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 22,
  },
  metricBox: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingVertical: 13,
    alignItems: 'center',
  },
  metricLabel: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  metricValue: {
    color: AppTheme.colors.white,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 4,
  },
  contextLine: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 14,
    textTransform: 'capitalize',
  },
  promptText: {
    color: AppTheme.colors.white,
    fontSize: 17,
    fontWeight: '900',
    marginTop: 18,
    marginBottom: 4,
  },
  bodyText: {
    color: AppTheme.colors.white,
    fontSize: 16,
    lineHeight: 26,
    marginTop: 16,
  },
  boldText: {
    fontWeight: '900',
  },
  callButton: {
    backgroundColor: AppTheme.colors.white,
    borderRadius: 18,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 20,
  },
  callButtonText: {
    color: AppTheme.colors.danger,
    fontSize: 17,
    fontWeight: '900',
  },
  twoColumnActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: AppTheme.colors.white,
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  footerLink: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: '900',
    textDecorationLine: 'underline',
    textAlign: 'center',
    marginTop: 18,
  },
  dialogActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  dialogButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeButton: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  closeButtonText: {
    color: AppTheme.colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  dismissButton: {
    backgroundColor: AppTheme.colors.surface,
  },
  dismissButtonText: {
    color: AppTheme.colors.danger,
    fontSize: 15,
    fontWeight: '900',
  },
  hint: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 12,
  },
});
