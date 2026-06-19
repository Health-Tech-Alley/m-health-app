/**
 * Batch parity runner for the Care Management harness.
 *
 * Runs every scenario in the library through the full UC2 decision layer
 * (with each scenario's preset observation codes + caregiver action applied),
 * then renders a summary table of expected vs actual for every decision-layer
 * branch. This is the interactive counterpart to the jest parity suite and
 * makes regressions visible without running tests.
 *
 * Themed with AppTheme brand teal. Status badges are colored by pass/fail.
 */
import { Pressable, ScrollView, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { SCENARIOS } from '@/ml-models/alert-autoencoder/mock-scenarios';
import type { BatchParityRow } from './types';

export type BatchParityRunnerProps = {
  running: boolean;
  rows: BatchParityRow[];
  onRun: () => void;
  style?: ViewStyle;
};

export function BatchParityRunner({ running, rows, onRun, style }: BatchParityRunnerProps) {
  const passed = rows.filter((r) => r.pass).length;
  const failed = rows.length - passed;

  return (
    <View style={[styles.panel, style]}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionLabel}>Batch parity runner</Text>
        <Pressable
          onPress={onRun}
          disabled={running}
          style={[styles.runButton, running && styles.runButtonDisabled]}>
          <Text style={styles.runText}>
            {running ? `Running ${rows.length}/${SCENARIOS.length}\u2026` : 'Run all scenarios'}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.muted}>
        Runs every scenario through the full UC2 layer (with each scenario&apos;s
        preset HITL) and compares expected vs actual metadata.
      </Text>

      {rows.length > 0 && (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>
            {passed}/{rows.length} passed
          </Text>
          {failed > 0 && <Text style={styles.summaryFail}>{failed} failed</Text>}
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.cell, styles.cellName]}>Scenario</Text>
            <Text style={styles.cell}>Pipeline</Text>
            <Text style={styles.cell}>Initial type</Text>
            <Text style={styles.cell}>Post-HITL</Text>
            <Text style={styles.cell}>Notification</Text>
            <Text style={styles.cell}>Sev</Text>
            <Text style={styles.cell}>Result</Text>
          </View>
          {rows.map((row) => (
            <View key={row.scenarioId} style={styles.tableRow}>
              <Text style={[styles.cell, styles.cellName, styles.cellText]} numberOfLines={1}>
                {row.scenarioName}
              </Text>
              <Text style={[styles.cell, styles.cellText]} numberOfLines={1}>
                {row.actualPipelinePath ?? '—'}
              </Text>
              <Text style={[styles.cell, styles.cellText]} numberOfLines={1}>
                {row.actualInitialAnomalyType ?? '—'}
              </Text>
              <Text style={[styles.cell, styles.cellText]} numberOfLines={1}>
                {row.actualPostHitlAnomalyType ?? '—'}
              </Text>
              <Text style={[styles.cell, styles.cellText]} numberOfLines={1}>
                {row.actualFinalNotificationType ?? '—'}
              </Text>
              <Text style={[styles.cell, styles.cellText]} numberOfLines={1}>
                {row.actualSeverity ?? '—'}
              </Text>
              <Text
                style={[
                  styles.cell,
                  styles.cellText,
                  row.pass ? styles.pass : styles.fail,
                ]}>
                {row.pass ? 'PASS' : 'FAIL'}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: AppTheme.spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: AppTheme.spacing.sm,
  },
  sectionLabel: {
    color: AppTheme.colors.brand,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  muted: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
  },
  runButton: {
    backgroundColor: AppTheme.colors.brand,
    paddingHorizontal: AppTheme.spacing.md,
    paddingVertical: AppTheme.spacing.sm,
    borderRadius: AppTheme.radius.md,
  },
  runButtonDisabled: {
    backgroundColor: AppTheme.colors.chip,
  },
  runText: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: '800',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: AppTheme.spacing.md,
  },
  summaryText: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  summaryFail: {
    color: AppTheme.colors.danger,
    fontSize: 13,
    fontWeight: '800',
  },
  tableScroll: {
    marginTop: 4,
  },
  table: {
    minWidth: 720,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: AppTheme.colors.border,
    paddingBottom: 4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AppTheme.colors.border,
  },
  cell: {
    width: 120,
    fontSize: 11,
    color: AppTheme.colors.textMuted,
    fontWeight: '700',
  },
  cellName: {
    width: 160,
  },
  cellText: {
    color: AppTheme.colors.text,
    fontWeight: '600',
  },
  pass: {
    color: AppTheme.colors.brand,
    fontWeight: '900',
  },
  fail: {
    color: AppTheme.colors.danger,
    fontWeight: '900',
  },
});
