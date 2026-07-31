import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MainTabHeader } from '@/components/MainTabHeader';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { AppTheme, MaxContentWidth, Spacing } from '@/constants/theme';

import { V2_FIXTURES } from './health-monitor-demo-controller';
import type { HealthMonitorDemoAction, HealthMonitorDemoState, V2Toggle } from './types';

type ViewProps = {
  state: HealthMonitorDemoState;
  dispatch: (action: HealthMonitorDemoAction) => void;
  onRun: () => void;
  onSLM: () => void;
  mlReady: boolean;
  slmReady: boolean;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function ResultRow({ label, value, tone }: { label: string; value?: string | number | null; tone?: 'danger' | 'warning' | 'ok' }) {
  if (value === undefined || value === null || value === '') return null;
  const color =
    tone === 'danger' ? AppTheme.colors.danger :
    tone === 'warning' ? AppTheme.colors.warning :
    tone === 'ok' ? AppTheme.colors.brand :
    AppTheme.colors.text;
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={[styles.resultValue, { color }]}>
        {typeof value === 'number' ? value.toFixed(3) : String(value)}
      </Text>
    </View>
  );
}

export function HealthMonitorDemoView({
  state,
  dispatch,
  onRun,
  onSLM,
  mlReady,
  slmReady,
}: ViewProps) {
  const running = state.status === 'running';
  const hasResult = state.v2Result !== null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <MainTabHeader
          title="Health Monitor Playground"
          eyebrow="UC2 v2 Demo"
          subtitle="Toggle v2 features and run the decision pipeline."
          icon="assistant"
        />

        <Section title="Scenario">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.fixtureScroll}>
            {V2_FIXTURES.map((f) => {
              const selected = state.selectedFixtureId === f.id;
              return (
                <Pressable
                  key={f.id}
                  style={[styles.fixtureChip, selected && styles.fixtureChipSelected]}
                  onPress={() =>
                    dispatch({
                      type: 'select-fixture',
                      payload: {
                        fixtureId: f.id,
                        raw: f.raw,
                        profile: f.profile,
                        caregiver: f.caregiver,
                        history: f.history,
                      },
                    })
                  }>
                  <Text
                    style={[styles.fixtureChipText, selected && styles.fixtureChipTextSelected]}>
                    {f.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Section>

        <Section title="v2 Features">
          {(
            [
              { key: 'useEhrThresholds' as keyof V2Toggle, label: 'EHR Thresholds' },
              { key: 'useHitlMatrix' as keyof V2Toggle, label: 'HITL Matrix' },
              { key: 'useRecurrence' as keyof V2Toggle, label: 'Recurrence Risk' },
              { key: 'usePersonalizedThresholds' as keyof V2Toggle, label: 'Personalized Thresholds' },
            ] as const
          ).map(({ key, label }) => (
            <View key={key} style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>{label}</Text>
              <Switch
                value={state.toggles[key]}
                onValueChange={(value) =>
                  dispatch({ type: 'toggle', payload: { key, value } })
                }
                trackColor={{ false: AppTheme.colors.chip, true: AppTheme.colors.brand }}
              />
            </View>
          ))}

          <Pressable
            style={[styles.primaryButton, (!state.raw || running || !mlReady) && styles.primaryButtonDisabled]}
            disabled={!state.raw || running || !mlReady}
            onPress={onRun}>
            <Text style={styles.primaryButtonText}>
              {running ? 'Running…' : !mlReady ? 'ML Model Loading…' : 'Run v2 Pipeline'}
            </Text>
          </Pressable>

          {state.status === 'error' && state.error ? (
            <Text style={styles.errorText}>Error: {state.error}</Text>
          ) : null}
        </Section>

        {hasResult && state.v2Result ? (
          <Section title="v2 Pipeline Result">            <ResultRow
              label="Emergency"
              value={state.v2Result.emergency.is_emergency ? `YES: ${state.v2Result.emergency.reason}` : 'No'}
              tone={state.v2Result.emergency.is_emergency ? 'danger' : 'ok'}
            />
            {state.v2Result.ae ? (
              <>
                <ResultRow
                  label="AE Score"
                  value={`${state.v2Result.ae.ae_score.toFixed(3)} (threshold ${state.v2Result.ae.ae_threshold.toFixed(3)})`}
                />
                <ResultRow
                  label="Anomaly"
                  value={state.v2Result.ae.is_anomaly ? 'Yes' : 'No'}
                  tone={state.v2Result.ae.is_anomaly ? 'warning' : 'ok'}
                />
              </>
            ) : null}
            {state.v2Result.sensor_classification ? (
              <>
                <ResultRow label="Sensor Type" value={state.v2Result.sensor_classification.sensor_anomaly_type} />
                <ResultRow label="Pre-HITL Severity" value={state.v2Result.sensor_classification.pre_hitl_severity} />
              </>
            ) : null}
            {state.v2Result.caregiver_hitl ? (
              <>
                <ResultRow label="HITL Max Delta" value={`+${state.v2Result.caregiver_hitl.max_matrix_delta}`} />
                <ResultRow
                  label="HITL Critical Route"
                  value={state.v2Result.caregiver_hitl.critical_route_triggered ? 'Yes' : 'No'}
                  tone={state.v2Result.caregiver_hitl.critical_route_triggered ? 'danger' : undefined}
                />
                {state.v2Result.caregiver_hitl.observation_reasons.length > 0 ? (
                  <ResultRow label="HITL Reasons" value={state.v2Result.caregiver_hitl.observation_reasons.join('; ')} />
                ) : null}
              </>
            ) : null}
            {state.v2Result.personalized_thresholds ? (
              <ResultRow label="Personalized Floor" value={state.v2Result.personalized_thresholds.personalized_threshold_severity_floor} />
            ) : null}
            {state.v2Result.recurrence ? (
              <>
                <ResultRow label="Recurrence Floor" value={state.v2Result.recurrence.recurrence_severity_floor} />
                <ResultRow label="Same-class Count" value={state.v2Result.recurrence.same_class_count} />
              </>
            ) : null}
            <ResultRow label="Final Decision" value={state.v2Result.final_decision.final_notification_type} />
            <ResultRow label="Final Severity" value={state.v2Result.final_decision.post_hitl_severity} />
            <ResultRow label="Notification" value={state.v2Result.final_decision.final_notification_title} />
          </Section>
        ) : null}

        <Section title="Concierge Explanation">
          <Pressable
            style={[styles.primaryButton, (!hasResult || !slmReady) && styles.primaryButtonDisabled]}
            disabled={!hasResult || !slmReady}
            onPress={onSLM}>
            <Text style={styles.primaryButtonText}>
              {state.slmStatus === 'streaming'
                ? 'Streaming…'
                : !slmReady
                  ? 'Load Concierge to explain'
                  : 'Ask the Concierge'}
            </Text>
          </Pressable>
          {state.slmStatus === 'streaming' && state.slmExplanation ? (
            <Text style={styles.streamingText}>{state.slmExplanation}</Text>
          ) : null}
          {state.slmStatus === 'done' && state.slmFinalText ? (
            <View style={styles.markdownContainer}>
              <MarkdownRenderer size="large">{state.slmFinalText}</MarkdownRenderer>
            </View>
          ) : null}
          {state.slmStatus === 'error' && state.slmError ? (
            <Text style={styles.errorText}>Error: {state.slmError}</Text>
          ) : null}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  section: {
    gap: Spacing.two,
  },
  sectionTitle: {
    color: AppTheme.colors.sectionText,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sectionCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.lg,
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    ...AppTheme.shadow,
  },
  fixtureScroll: {
    gap: Spacing.two,
  },
  fixtureChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: AppTheme.radius.pill,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.chip,
    marginRight: Spacing.two,
  },
  fixtureChipSelected: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  fixtureChipText: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  fixtureChipTextSelected: {
    color: AppTheme.colors.white,
    fontWeight: '800',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.one,
  },
  toggleLabel: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  primaryButton: {
    paddingVertical: Spacing.three,
    borderRadius: AppTheme.radius.md,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: AppTheme.colors.brand,
    marginTop: 4,
  },
  primaryButtonDisabled: {
    backgroundColor: AppTheme.colors.chip,
  },
  primaryButtonText: {
    color: AppTheme.colors.white,
    fontWeight: '800',
    fontSize: 15,
  },
  errorText: {
    color: AppTheme.colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AppTheme.colors.border,
  },
  resultLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  resultValue: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'monospace',
    flexShrink: 1,
    textAlign: 'right',
  },
  streamingText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    lineHeight: 21,
    fontStyle: 'italic',
  },
  markdownContainer: {
    marginTop: Spacing.two,
  },
});
