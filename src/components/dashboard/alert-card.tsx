/**
 * Reusable alert card.
 *
 * Renders a single alert in a list with a severity-colored left border,
 * title, body, timestamp, and a "View" affordance. Used by the Dashboard,
 * Care, and Schedule screens.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Alert } from '@/data/types';

const SEVERITY_COLOR: Record<Alert['severity'], string> = {
  3: '#B42318',
  2: '#B54708',
  1: '#0E6F68',
};

const SEVERITY_LABEL: Record<Alert['severity'], string> = {
  3: 'Emergency',
  2: 'Urgent',
  1: 'Info',
};

export type AlertCardProps = {
  alert: Alert;
  onPress: (alertId: string) => void;
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function AlertCard({ alert, onPress }: AlertCardProps) {
  const color = SEVERITY_COLOR[alert.severity] ?? '#0E6F68';

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => onPress(alert.alertId)}
      accessibilityRole="button"
      accessibilityLabel={`Alert: ${alert.title}`}
    >
      <View style={[styles.leftBorder, { backgroundColor: color }]} />
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Text style={styles.severityLabel}>{SEVERITY_LABEL[alert.severity]}</Text>
          <Text style={styles.time}>{formatTime(alert.createdAt)}</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {alert.title}
        </Text>
        {alert.body ? (
          <Text style={styles.bodyText} numberOfLines={3}>
            {alert.body}
          </Text>
        ) : null}
        <View style={styles.footer}>
          <Text style={[styles.viewButton, { color }]}>View →</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E4E7EC',
  },
  pressed: {
    opacity: 0.85,
  },
  leftBorder: {
    width: 4,
  },
  body: {
    flex: 1,
    padding: 14,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  severityLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#526866',
  },
  time: {
    marginLeft: 'auto',
    fontSize: 12,
    color: '#526866',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#123433',
    lineHeight: 22,
  },
  bodyText: {
    fontSize: 14,
    color: '#526866',
    lineHeight: 20,
  },
  footer: {
    marginTop: 2,
  },
  viewButton: {
    fontSize: 14,
    fontWeight: '700',
  },
});
