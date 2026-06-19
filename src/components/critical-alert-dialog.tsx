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
import { getMlEventForAlert, type MlEvent } from '@/data';
import { executeNextStep } from '@/orchestration/next-steps';
import type { NextStepActionId } from '@/data/types';
import { getOnboardingProfile } from '@/services/onboarding/onboardingService';

function parseRawVitals(event: MlEvent | null): Record<string, number | undefined> {
  if (!event?.rawVitalsJson) return {};
  try {
    return JSON.parse(event.rawVitalsJson) as Record<string, number | undefined>;
  } catch {
    return {};
  }
}

function formatMetric(v: number | undefined, unit: string): string {
  return v !== undefined && v !== null && Number.isFinite(v)
    ? `${Math.round(v * 100) / 100}${unit}`
    : '—';
}

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return 'Recent';
  const minutes = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function CriticalAlertDialog() {
  const router = useRouter();
  const { alert, visible, closeForSession, dismiss } = useCriticalAlert();
  const [busy, setBusy] = useState(false);

  const profile = getOnboardingProfile();

  const mlEvent = useMemo<MlEvent | null>(() => {
    if (!alert) return null;
    try {
      return getMlEventForAlert(alert.alertId);
    } catch {
      return null;
    }
  }, [alert?.alertId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alert) return null;

  const vitals = parseRawVitals(mlEvent);
  const metrics = [
    { label: 'SpO₂', value: formatMetric(vitals.blood_oxygen, '%') },
    { label: 'HR', value: formatMetric(vitals.heart_rate, ' BPM') },
    { label: 'RR', value: formatMetric(vitals.respiratory_rate, '/min') },
  ];
  const contextualType = mlEvent?.initialAnomalyType;

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
      'Dismiss this alert?',
      'This permanently suppresses the popup. The alert stays logged as inactive and you can review or remove it from the alerts log on the Home tab.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss',
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
                <Text style={styles.eyebrow}>Active Alert · Emergency</Text>
                <Text style={styles.title}>{alert.title}</Text>
                <Text style={styles.subtitle}>
                  Severity 3 · {formatRelativeTime(alert.createdAt)}
                </Text>
              </View>
              <View style={styles.urgentPill}>
                <Text style={styles.urgentText}>Urgent</Text>
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

            {contextualType && (
              <Text style={styles.contextLine}>
                Pattern: {contextualType.replace(/_/g, ' ').toLowerCase()}
              </Text>
            )}

            <Text style={styles.bodyText}>
              {alert.body
                ? `${alert.body} `
                : `${profile.patient.name}'s recent vitals show an unusual pattern. `}
              <Text style={styles.boldText}>
                You decide — the app never acts for you.
              </Text>
            </Text>

            <Pressable
              style={styles.callButton}
              onPress={() => handleAction('call_911')}
              disabled={busy}
            >
              <Text style={styles.callButtonText}>Call 911</Text>
            </Pressable>

            <View style={styles.twoColumnActions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => handleAction('go_to_er')}
                disabled={busy}
              >
                <Text style={styles.secondaryButtonText}>Go to ER</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => handleAction('contact_pcp')}
                disabled={busy}
              >
                <Text style={styles.secondaryButtonText}>Contact Provider</Text>
              </Pressable>
            </View>

            <Pressable onPress={openDetail}>
              <Text style={styles.footerLink}>View full alert →</Text>
            </Pressable>

            <View style={styles.dialogActions}>
              <Pressable
                style={[styles.dialogButton, styles.closeButton]}
                onPress={closeForSession}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </Pressable>
              <Pressable
                style={[styles.dialogButton, styles.dismissButton]}
                onPress={handleDismiss}
              >
                <Text style={styles.dismissButtonText}>Dismiss</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              Close hides this for now (it returns when you re-open the Care
              tab). Dismiss suppresses it permanently.
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
