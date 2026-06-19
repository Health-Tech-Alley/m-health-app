/**
 * Themed renderer for the full UC2 decision-layer result.
 *
 * Surfaces everything the decision layer returns so the Care Management
 * harness can exercise and inspect every branch: pipeline path + emergency
 * reason, AE score / threshold / ratio, initial -> post-HITL anomaly types
 * (with a diff when HITL reclassified), top contributing features with
 * observed/imputed/derived provenance, the final decision block, and a
 * collapsible raw MCP / SLM payload viewer.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import type { UC2DecisionResult } from '@/ml-models/uc2-decision-layer';

const SEVERITY_COLOR: Record<number, string> = {
  3: AppTheme.colors.danger,
  2: AppTheme.colors.warning,
  1: AppTheme.colors.brand,
  0: AppTheme.colors.textMuted,
};

const QUALITY_COLOR: Record<string, string> = {
  observed: AppTheme.colors.brand,
  imputed: AppTheme.colors.warning,
  derived: AppTheme.colors.blueGray,
};

type Props = {
  result: UC2DecisionResult;
  /** Pre-HITL result, used to show a diff after the caregiver applies HITL. */
  initialResult?: UC2DecisionResult | null;
};

export function DecisionResultPanel({ result, initialResult }: Props) {
  const [payloadsOpen, setPayloadsOpen] = useState(false);
  const scoreRatio =
    result.aeScore !== null && result.threshold > 0
      ? result.aeScore / result.threshold
      : null;

  const typeChanged =
    initialResult &&
    initialResult.postHitlAnomalyType !== result.postHitlAnomalyType;

  return (
    <View style={styles.panel}>
      {/* Pipeline + emergency */}
      <Row label="Pipeline">
        <Text style={styles.valueText}>{result.emergencyResult.pipelinePath}</Text>
        {result.emergencyResult.emergency && result.emergencyResult.reason && (
          <View style={[styles.badge, { backgroundColor: SEVERITY_COLOR[3] }]}>
            <Text style={styles.badgeText}>
              EMERGENCY · {result.emergencyResult.reason}
            </Text>
          </View>
        )}
      </Row>

      {/* Score / threshold / ratio */}
      <Row label="AE score">
        <Text style={styles.monoValue}>
          {result.aeScore !== null ? result.aeScore.toFixed(3) : 'n/a'}
        </Text>
      </Row>
      <Row label="Threshold">
        <Text style={styles.monoValue}>{result.threshold.toFixed(3)}</Text>
      </Row>
      <Row label="Score ratio">
        <Text style={styles.monoValue}>
          {scoreRatio !== null ? scoreRatio.toFixed(2) : 'n/a'}
        </Text>
      </Row>
      <Row label="Anomaly">
        <View
          style={[
            styles.badge,
            { backgroundColor: result.isAnomaly ? SEVERITY_COLOR[3] : SEVERITY_COLOR[0] },
          ]}
        >
          <Text style={styles.badgeText}>
            {result.isAnomaly ? 'ANOMALOUS' : 'NORMAL'}
          </Text>
        </View>
      </Row>

      {/* Anomaly types */}
      <Row label="Initial type">
        <Text style={styles.valueText}>{result.initialAnomalyType}</Text>
      </Row>
      <Row label="Post-HITL type">
        <Text style={[styles.valueText, typeChanged && { color: AppTheme.colors.brand }]}>
          {result.postHitlAnomalyType}
        </Text>
        {typeChanged && initialResult && (
          <Text style={styles.diffText}>
            (was {initialResult.postHitlAnomalyType})
          </Text>
        )}
      </Row>

      {/* Top features with provenance */}
      <Text style={styles.sectionLabel}>Top contributing features</Text>
      {result.topFeatureEvidence.length === 0 ? (
        <Text style={styles.muted}>n/a (emergency path bypassed ML)</Text>
      ) : (
        result.topFeatureEvidence.map((f) => {
          const quality = result.featureQuality[f.feature] ?? 'observed';
          return (
            <View key={f.feature} style={styles.featureRow}>
              <Text style={styles.featureName}>{f.feature}</Text>
              <Text style={styles.monoValue}>{f.importance.toFixed(2)}</Text>
              <View
                style={[styles.qualityDot, { backgroundColor: QUALITY_COLOR[quality] ?? AppTheme.colors.textMuted }]}
              />
              <Text style={styles.qualityText}>{quality}</Text>
            </View>
          );
        })
      )}

      {/* Final decision */}
      <Text style={styles.sectionLabel}>Final decision</Text>
      <Row label="Notification">
        <Text style={styles.valueText}>
          {result.finalDecision.final_notification_type}
        </Text>
      </Row>
      <Row label="Level">
        <Text style={styles.valueText}>
          {result.finalDecision.final_notification_level ?? '—'}
        </Text>
      </Row>
      <Row label="Severity">
        <View
          style={[styles.badge, { backgroundColor: SEVERITY_COLOR[result.finalDecision.final_severity] ?? SEVERITY_COLOR[0] }]}
        >
          <Text style={styles.badgeText}>
            {result.finalDecision.final_severity}
          </Text>
        </View>
      </Row>
      {result.finalDecision.final_notification_title ? (
        <Text style={styles.titleText}>
          {result.finalDecision.final_notification_title}
        </Text>
      ) : null}
      {result.finalDecision.final_notification_body ? (
        <Text style={styles.bodyText}>
          {result.finalDecision.final_notification_body}
        </Text>
      ) : null}
      <Row label="SLM refinement queued">
        <Text style={styles.valueText}>
          {result.finalDecision.slm_refinement_queued ? 'yes' : 'no'}
        </Text>
      </Row>
      {result.finalDecision.refinement_reason && (
        <Text style={styles.muted}>{result.finalDecision.refinement_reason}</Text>
      )}

      {/* Raw payloads (collapsible) */}
      <Pressable
        style={styles.payloadToggle}
        onPress={() => setPayloadsOpen((v) => !v)}
      >
        <Text style={styles.payloadToggleText}>
          {payloadsOpen ? '▾' : '▸'} Raw payloads
        </Text>
      </Pressable>
      {payloadsOpen && (
        <ScrollView style={styles.payloadBox}>
          {result.initialMCPPayload && (
            <>
              <Text style={styles.payloadLabel}>Initial MCP payload</Text>
              <Text style={styles.payloadJson}>
                {JSON.stringify(result.initialMCPPayload, null, 2)}
              </Text>
            </>
          )}
          {result.finalSLMPayload && (
            <>
              <Text style={styles.payloadLabel}>Final SLM payload</Text>
              <Text style={styles.payloadJson}>
                {JSON.stringify(result.finalSLMPayload, null, 2)}
              </Text>
            </>
          )}
          {!result.initialMCPPayload && !result.finalSLMPayload && (
            <Text style={styles.muted}>No payloads (no prompt shown / no alert).</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValue}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.lg,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: AppTheme.spacing.lg,
    gap: AppTheme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.sm,
    flexWrap: 'wrap',
  },
  rowLabel: {
    width: 130,
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rowValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.sm,
    flexWrap: 'wrap',
  },
  valueText: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  monoValue: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  muted: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
  },
  diffText: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },
  badge: {
    paddingHorizontal: AppTheme.spacing.sm,
    paddingVertical: 2,
    borderRadius: AppTheme.radius.sm,
  },
  badgeText: {
    color: AppTheme.colors.white,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  sectionLabel: {
    color: AppTheme.colors.brand,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: AppTheme.spacing.sm,
    marginBottom: 2,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.sm,
    paddingVertical: 3,
  },
  featureName: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 13,
  },
  qualityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  qualityText: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  titleText: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  bodyText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  payloadToggle: {
    marginTop: AppTheme.spacing.sm,
    paddingVertical: AppTheme.spacing.xs,
  },
  payloadToggleText: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: '800',
  },
  payloadBox: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: AppTheme.radius.md,
    padding: AppTheme.spacing.md,
    maxHeight: 320,
  },
  payloadLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginTop: 6,
    marginBottom: 4,
  },
  payloadJson: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: AppTheme.colors.text,
    lineHeight: 16,
  },
});
