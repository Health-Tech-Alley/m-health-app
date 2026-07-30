/**
 * Alerts log card (Dashboard).
 *
 * Replaces the old persistent `ActiveAlertCard` on the Home tab with a
 * reviewable log of all alerts (excludes `removed`). Alerts are grouped:
 *
 *   - Active   → status `open` / `acknowledged` (still needs attention; the
 *     severity-3 popup re-surfaces these on the Care tab until dismissed).
 *   - Inactive → status `dismissed` / `resolved` / `escalated`.
 *
 * Tapping a row opens the existing `/alert-detail` screen (notes, actions,
 * explain). A per-row remove (×) hides the alert from the log (status
 * `removed`); the row is retained in SQLite for the audit trail.
 *
 * Live-refreshes on alert-affecting bus events so newly created / dismissed /
 * removed alerts appear without a manual pull-to-refresh.
 */

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppIcon } from '@/components/AppIcon';
import { AppTheme } from '@/constants/theme';
import { severityColor } from '@/constants/user-terms';
import { useOrchestratorPatientId } from '@/contexts/orchestrator-context';
import { useTheme } from '@/hooks/use-theme';
import { getEventBus } from '@/orchestration/event-bus';
import { audit } from '@/services/audit/auditService';
import {
  getCareAlertsForLog,
  removeCareAlert,
  type CareAlert,
} from '@/services/care/careService';

const ACTIVE_STATUSES = new Set(['open', 'acknowledged']);

const STATUS_LABEL: Record<CareAlert['status'], string> = {
  open: 'Active',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  escalated: 'Escalated',
  dismissed: 'Dismissed',
  removed: 'Removed',
};

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

export function AlertsLogCard() {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const router = useRouter();
  const patientId = useOrchestratorPatientId();
  const [alerts, setAlerts] = useState<CareAlert[]>([]);

  const refresh = useCallback(() => {
    if (!patientId) {
      setAlerts([]);
      return;
    }
    try {
      setAlerts(getCareAlertsForLog(patientId));
    } catch {
      setAlerts([]);
    }
  }, [patientId]);

  // Initial read (deferred) + live-refresh on alert-affecting bus events.
  useEffect(() => {
    if (!patientId) {
      const clear = setTimeout(() => setAlerts([]), 0);
      return () => clearTimeout(clear);
    }
    const initial = setTimeout(refresh, 0);
    const deferredRefresh = () => setTimeout(refresh, 250);
    const bus = getEventBus();
    const unsubMl = bus.subscribe('ml_alert_created', deferredRefresh);
    const unsubVitals = bus.subscribe('vitals_sample', deferredRefresh);
    const unsubOverride = bus.subscribe('caregiver_override', deferredRefresh);
    return () => {
      clearTimeout(initial);
      unsubMl();
      unsubVitals();
      unsubOverride();
    };
  }, [patientId, refresh]);

  function handleRemove(alert: CareAlert) {
    Alert.alert(
      'Remove from log?',
      'This hides the alert from your alerts log. The record is kept for the audit trail.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeCareAlert(alert.alertId);
            audit({
              actor: 'caregiver',
              action: 'removed',
              resourceType: 'alert',
              resourceId: alert.alertId,
              patientId: patientId || undefined,
              payload: { severity: alert.severity, prevStatus: alert.status },
            });
            refresh();
          },
        },
      ],
    );
  }

  const active = alerts.filter((a) => ACTIVE_STATUSES.has(a.status));
  const inactive = alerts.filter((a) => !ACTIVE_STATUSES.has(a.status));

  if (alerts.length === 0) {
    return (
      <View style={[styles.card, themedStyles.card]}>
        <View style={styles.headerRow}>
          <AppIcon name="bell" size={18} color={theme.appTextMuted} />
          <Text style={[styles.title, themedStyles.title]}>Alerts Log</Text>
        </View>
        <Text style={[styles.emptyText, themedStyles.mutedText]}>
          No alerts recorded yet. Alerts from the ML care analysis demo will
          appear here, grouped by active and inactive.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, themedStyles.card]}>
      <View style={styles.headerRow}>
        <AppIcon name="bell" size={18} color={theme.appTextMuted} />
        <Text style={[styles.title, themedStyles.title]}>Alerts Log</Text>
        <Text style={[styles.count, themedStyles.count]}>{alerts.length}</Text>
      </View>

      {active.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, themedStyles.sectionLabel]}>Active · {active.length}</Text>
          {active.map((a) => (
            <AlertRow
              key={a.alertId}
              alert={a}
              onOpen={() =>
                router.push({ pathname: '/alert-detail', params: { alertId: a.alertId } })
              }
              onRemove={() => handleRemove(a)}
            />
          ))}
        </View>
      )}

      {inactive.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, themedStyles.sectionLabel, styles.sectionLabelInactive]}>
            Inactive · {inactive.length}
          </Text>
          {inactive.map((a) => (
            <AlertRow
              key={a.alertId}
              alert={a}
              inactive
              onOpen={() =>
                router.push({ pathname: '/alert-detail', params: { alertId: a.alertId } })
              }
              onRemove={() => handleRemove(a)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function AlertRow({
  alert,
  inactive,
  onOpen,
  onRemove,
}: {
  alert: CareAlert;
  inactive?: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const color = severityColor(alert.severity);
  return (
    <Pressable
      style={[styles.row, themedStyles.row, inactive && styles.rowInactive]}
      onPress={onOpen}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, themedStyles.title]} numberOfLines={1}>
          {alert.title}
        </Text>
        <Text style={[styles.rowSub, themedStyles.mutedText]} numberOfLines={1}>
          {STATUS_LABEL[alert.status]} · Severity {alert.severity} · {formatRelativeTime(alert.createdAt)}
        </Text>
      </View>
      <Pressable
        style={styles.removeBtn}
        hitSlop={12}
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel="Remove alert from log"
      >
        <Text style={[styles.removeText, themedStyles.mutedText]}>×</Text>
      </Pressable>
    </Pressable>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    title: {
      color: theme.appText,
    },
    mutedText: {
      color: theme.appTextMuted,
    },
    count: {
      color: theme.appTextMuted,
      backgroundColor: theme.appControlSurface,
    },
    sectionLabel: {
      color: theme.appSectionText,
    },
    row: {
      borderTopColor: theme.appBorder,
    },
  });
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 18,
    marginBottom: 24,
    ...AppTheme.shadow,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  title: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  count: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: '900',
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  section: {
    marginBottom: 10,
  },
  sectionLabel: {
    color: AppTheme.colors.sectionText,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  sectionLabelInactive: {
    opacity: 0.7,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
  },
  rowInactive: {
    opacity: 0.7,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  rowSub: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  removeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  removeText: {
    color: AppTheme.colors.textMuted,
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 22,
  },
  emptyText: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
});
