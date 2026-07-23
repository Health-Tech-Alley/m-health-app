/**
 * "Your Decisions" section — caregiver-facing history of recent overrides,
 * acknowledgements, and observations. Replaces the raw audit log view in
 * the normal (non-dev) mode per planning/29_hitl-promotion-plan.md.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import {
  decisionDisplayLine,
  listCaregiverDecisions,
  type CaregiverDecisionRow,
} from '@/hooks/usePendingReviews';

type Props = {
  patientFirstName: string;
  /** Show all rows expanded by default. Defaults to a 3-row preview. */
  limit?: number;
  initiallyExpanded?: boolean;
};

function formatRelativeDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diffMs = Date.now() - t;
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) {
    const hours = Math.round(diffMs / (60 * 60 * 1000));
    if (hours <= 0) return 'just now';
    if (hours === 1) return '1 hour ago';
    return `${hours} hours ago`;
  }
  if (diffMs < 7 * day) {
    const days = Math.round(diffMs / day);
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }
  return new Date(t).toLocaleDateString();
}

export function YourDecisionsSection({
  patientFirstName,
  limit = 20,
  initiallyExpanded = false,
}: Props) {
  const [rows] = useState<CaregiverDecisionRow[]>(() => listCaregiverDecisions(limit));
  const [open, setOpen] = useState(initiallyExpanded);

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.header}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Collapse your decisions' : 'Expand your decisions'}
      >
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>Your decisions</Text>
          <Text style={styles.subtitle}>
            Recent overrides, observations, and confirmations.
          </Text>
        </View>
        <Text style={styles.chevron}>{open ? '\u25BE' : '\u25B8'}</Text>
      </Pressable>

      {open ? (
        rows.length === 0 ? (
          <Text style={styles.emptyText}>
            No decisions yet. When you act on alerts, your choices will show up here so you can see your pattern over time.
          </Text>
        ) : (
          <View style={styles.list}>
            {rows.map((row) => (
              <View key={row.actionId} style={styles.row}>
                <Text style={styles.line}>
                  {decisionDisplayLine(row, patientFirstName)}
                </Text>
                <Text style={styles.meta}>{formatRelativeDate(row.createdAt)}</Text>
              </View>
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E4E7EC',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  headerText: { flex: 1, gap: 2 },
  eyebrow: {
    color: AppTheme.colors.brand,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  subtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
  },
  chevron: {
    color: AppTheme.colors.textSoft,
    fontSize: 18,
    fontWeight: '700',
  },
  emptyText: {
    padding: 16,
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  list: { borderTopWidth: 1, borderTopColor: '#E4E7EC' },
  row: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F4F4',
    gap: 4,
  },
  line: {
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  meta: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
  },
});
