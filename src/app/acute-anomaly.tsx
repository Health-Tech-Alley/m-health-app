/**
 * Acute anomaly flow demo screen.
 *
 * Demonstrates the end-to-end orchestration path:
 *   1. Simulate a vitals sample.
 *   2. Orchestrator checks thresholds and creates an alert (severity 1–3).
 *   3. For non-emergency alerts, caregiver taps "Explain with SLM".
 *   4. SLM returns an explanation + optional multiple-choice clarifying question.
 *   5. Caregiver answers the question; orchestrator re-runs with the new fact.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { severityColor } from '@/constants/user-terms';
import { ThinkingIndicator } from '@/components/concierge/ThinkingIndicator';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { CitationList } from '@/components/common/CitationList';
import {
  useOrchestrator,
  useOrchestratorPatientId,
} from '@/contexts/orchestrator-context';
import { useSLM } from '@/contexts/slm-context';
import { getActiveAlerts, resolveAllAlerts, updateAlertStatus } from '@/data';
import type { Alert } from '@/data/types';
import { getEventBus, type OrchestrationEvent, type AgentProposal } from '@/orchestration';
import type { SlmTaskLease } from '@/services/slm/slm-task-queue';

const SWIPE_THRESHOLD = 80;

function SwipeableAlertRow({
  alert,
  onExplain,
  onDismiss,
}: {
  alert: Alert;
  onExplain: (alertId: string) => void;
  onDismiss: (alertId: string) => void;
}) {
  const [translateX] = useState(() => new Animated.Value(0));

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return (
            Math.abs(gestureState.dx) > 10 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
          );
        },
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dx < 0) {
            translateX.setValue(gestureState.dx);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx < -SWIPE_THRESHOLD) {
            Animated.timing(translateX, {
              toValue: -300,
              duration: 200,
              useNativeDriver: true,
            }).start(() => onDismiss(alert.alertId));
          } else {
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [translateX, onDismiss, alert.alertId],
  );

  const color = severityColor(alert.severity);

  return (
    <View style={styles.swipeableRow}>
      <View style={styles.swipeBackground}>
        <Text style={styles.swipeText}>Dismissed</Text>
      </View>
      <Animated.View
        style={[styles.alertRowContainer, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}>
        <View style={[styles.severityDot, { backgroundColor: color }]} />
        <View style={styles.alertBody}>
          <Text style={styles.alertTitle}>{alert.title}</Text>
          <Text style={styles.muted}>{alert.body}</Text>
          {alert.severity < 3 && (
            <Pressable
              style={[styles.button, styles.secondaryButton]}
              onPress={() => onExplain(alert.alertId)}>
              <Text style={styles.secondaryButtonText}>Ask Concierge to explain</Text>
            </Pressable>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

export default function AcuteAnomalyScreen() {
  const orchestrator = useOrchestrator();
  const { acquireSlm } = useSLM();
  /** Screen-scoped explain lease so demo uses task queue (doc 34), not raw loadModel. */
  const explainLeaseRef = useRef<SlmTaskLease | null>(null);

  const patientId = useOrchestratorPatientId();
  const [alerts, setAlerts] = useState<Alert[]>(() => getActiveAlerts(patientId));
  const [logs, setLogs] = useState<string[]>(() => {
    if (patientId) return [];
    return ['No patient seeded yet. Onboarding profile may be empty.'];
  });

  const [spo2, setSpo2] = useState('86');
  const [heartRate, setHeartRate] = useState('110');
  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const bus = getEventBus();
    const unsub1 = bus.subscribe('vitals_sample', () => {
      setTimeout(() => setAlerts(getActiveAlerts(patientId)), 200);
    });
    const unsub2 = bus.subscribe('ml_alert_created', () => {
      setTimeout(() => setAlerts(getActiveAlerts(patientId)), 200);
    });
    return () => {
      unsub1();
      unsub2();
    };
  }, [patientId]);

  const log = useCallback((message: string) => {
    setLogs((prev) => [...prev, message]);
  }, []);

  const refreshAlerts = useCallback(
    (pid: string) => {
      setAlerts(getActiveAlerts(pid));
    },
    [],
  );

  const simulateVitals = useCallback(() => {
    if (!patientId) {
      log('No patientId. Seed the database from onboarding first.');
      return;
    }

    const now = new Date().toISOString();
    // Publish SpO2 as 0–100 percent (canonical on bus + thresholds).
    const spo2Event: Extract<OrchestrationEvent, { type: 'vitals_sample' }> = {
      type: 'vitals_sample',
      patientId,
      sampleId: `sample-${Date.now()}`,
      sampleType: 'spo2',
      value: Number(spo2),
      unit: '%',
      recordedAt: now,
    };
    getEventBus().publish(spo2Event);
    log(`Published SpO2 ${spo2}% event`);

    const hrEvent: Extract<OrchestrationEvent, { type: 'vitals_sample' }> = {
      type: 'vitals_sample',
      patientId,
      sampleId: `sample-${Date.now() + 1}`,
      sampleType: 'heart_rate',
      value: Number(heartRate),
      unit: 'bpm',
      recordedAt: now,
    };
    getEventBus().publish(hrEvent);
    log(`Published HR ${heartRate} bpm event`);

    // Ambient ML needs ≥3 sample types; include RR so evaluate can run.
    const rrEvent: Extract<OrchestrationEvent, { type: 'vitals_sample' }> = {
      type: 'vitals_sample',
      patientId,
      sampleId: `sample-${Date.now() + 2}`,
      sampleType: 'respiratory_rate',
      value: 28,
      unit: 'rpm',
      recordedAt: now,
    };
    getEventBus().publish(rrEvent);
    log('Published RR 28 rpm event');

    setTimeout(() => refreshAlerts(patientId), 50);
  }, [patientId, spo2, heartRate, log, refreshAlerts]);

  const releaseExplainLease = useCallback(() => {
    explainLeaseRef.current?.release();
    explainLeaseRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      releaseExplainLease();
    };
  }, [releaseExplainLease]);

  const explainAlert = useCallback(
    async (alertId: string) => {
      setLoading(true);
      setProposal(null);
      try {
        // Doc 34: lease-driven load (RAM gate + refcount), not raw loadModel.
        if (!explainLeaseRef.current) {
          explainLeaseRef.current = await acquireSlm('explain_alert');
          log('Concierge lease acquired for explain.');
        }
        const result = await orchestrator.explainAlert(alertId, 'caregiver-1');
        setProposal(result);
        log(`Concierge explanation received. Citations: ${result.citations.length}`);
        // Keep lease while clarifying UI is open; release if no follow-up question.
        if (!result.clarifyingQuestion) {
          releaseExplainLease();
        }
      } catch (err) {
        log(`Explain failed: ${err instanceof Error ? err.message : String(err)}`);
        releaseExplainLease();
      } finally {
        setLoading(false);
      }
    },
    [orchestrator, acquireSlm, log, releaseExplainLease],
  );

  const answerQuestion = useCallback(
    async (option: string) => {
      if (!proposal?.clarifyingQuestion) return;
      setLoading(true);
      try {
        const alertId = alerts[0]?.alertId;
        if (!alertId) return;
        if (!explainLeaseRef.current) {
          explainLeaseRef.current = await acquireSlm('explain_alert');
        }
        const result = await orchestrator.answerClarifyingQuestion(
          alertId,
          'caregiver-1',
          proposal.clarifyingQuestion.questionId,
          option,
        );
        setProposal(result);
        log('Clarifying question answered; Concierge re-ran.');
        if (!result.clarifyingQuestion) {
          releaseExplainLease();
        }
      } catch (err) {
        log(`Answer failed: ${err instanceof Error ? err.message : String(err)}`);
        releaseExplainLease();
      } finally {
        setLoading(false);
      }
    },
    [proposal, alerts, orchestrator, log, acquireSlm, releaseExplainLease],
  );

  const dismissAlert = useCallback(
    (alertId: string) => {
      updateAlertStatus(alertId, 'resolved');
      setAlerts((prev) => prev.filter((a) => a.alertId !== alertId));
      log(`Alert ${alertId} dismissed`);
    },
    [log],
  );

  const clearAllAlerts = useCallback(() => {
    resolveAllAlerts(patientId);
    setAlerts([]);
    setProposal(null);
    releaseExplainLease();
    log('All alerts cleared');
  }, [patientId, log, releaseExplainLease]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Acute Anomaly Flow</Text>
        <Text style={styles.subtitle}>
          Simulate vitals, watch the Concierge create alerts, then ask the Concierge for an
          explanation with optional clarifying questions.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Simulate Vitals</Text>
          <View style={styles.row}>
            <Text style={styles.label}>SpO2 (%)</Text>
            <TextInput
              style={styles.input}
              value={spo2}
              onChangeText={setSpo2}
              keyboardType="numeric"
              maxLength={3}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Heart rate (bpm)</Text>
            <TextInput
              style={styles.input}
              value={heartRate}
              onChangeText={setHeartRate}
              keyboardType="numeric"
              maxLength={3}
            />
          </View>
          <Pressable style={styles.button} onPress={simulateVitals}>
            <Text style={styles.buttonText}>Send vitals to Concierge</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Active Alerts</Text>
            {alerts.length > 0 && (
              <Pressable onPress={clearAllAlerts} style={styles.clearButton}>
                <Text style={styles.clearButtonText}>Clear All</Text>
              </Pressable>
            )}
          </View>
          {alerts.length === 0 ? (
            <Text style={styles.muted}>No active alerts. Swipe left on an alert to dismiss it.</Text>
          ) : (
            alerts.map((alert) => (
              <SwipeableAlertRow
                key={alert.alertId}
                alert={alert}
                onExplain={explainAlert}
                onDismiss={dismissAlert}
              />
            ))
          )}
        </View>

        {loading && (
          <View style={styles.card}>
            <ThinkingIndicator text="" />
          </View>
        )}

        {proposal && (
          <View style={styles.explanationCard}>
            <View style={styles.explanationHeader}>
              <Text style={styles.explanationEyebrow}>Concierge analysis</Text>
              <Text style={styles.explanationTitle}>Alert explanation</Text>
            </View>

            <View style={styles.answerContainer}>
              <MarkdownRenderer size="large">{proposal.message}</MarkdownRenderer>
            </View>

            {proposal.citations.length > 0 && (
              <CitationList
                sources={proposal.citations.map((c) => ({ label: c }))}
                collapsible
                defaultExpanded
                compact
              />
            )}

            {proposal.clarifyingQuestion && (
              <View style={styles.questionSection}>
                <Text style={styles.sectionTitle}>Clarifying Question</Text>
                <Text style={styles.questionText}>{proposal.clarifyingQuestion.question}</Text>
                {proposal.clarifyingQuestion.options.map((option) => (
                  <Pressable
                    key={option}
                    style={styles.optionButton}
                    onPress={() => answerQuestion(option)}>
                    <Text style={styles.optionText}>{option}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Trace Log</Text>
          {logs.map((l, i) => (
            <Text key={i} style={styles.logLine}>
              • {l}
            </Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#EEF7F6',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#123433',
  },
  subtitle: {
    color: '#526866',
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#123433',
  },
  clearButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#FEE4E2',
  },
  clearButtonText: {
    color: '#B42318',
    fontWeight: '700',
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    width: 140,
    color: '#526866',
    fontWeight: '600',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D9E7E5',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: '#123433',
  },
  button: {
    backgroundColor: '#0E6F68',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#0E6F68',
    marginTop: 10,
  },
  secondaryButtonText: {
    color: '#0E6F68',
    fontWeight: '700',
    fontSize: 15,
  },
  muted: {
    color: '#526866',
    fontSize: 14,
  },
  swipeableRow: {
    overflow: 'hidden',
  },
  swipeBackground: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    left: 0,
    backgroundColor: '#B42318',
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 20,
    borderRadius: 12,
  },
  swipeText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  alertRowContainer: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#12343315',
    backgroundColor: '#FFFFFF',
  },
  severityDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  alertBody: {
    flex: 1,
    gap: 4,
  },
  alertTitle: {
    fontWeight: '700',
    color: '#123433',
  },
  explanationCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 0,
    overflow: 'hidden',
  },
  explanationHeader: {
    backgroundColor: '#0E6F68',
    padding: 20,
  },
  explanationEyebrow: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
    opacity: 0.8,
  },
  explanationTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  answerContainer: {
    padding: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D9E7E5',
  },
  citationsSection: {
    padding: 16,
    backgroundColor: '#F7FAF9',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D9E7E5',
  },
  sectionTitle: {
    color: '#0E6F68',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  citation: {
    color: '#526866',
    fontSize: 13,
    lineHeight: 20,
  },
  questionSection: {
    padding: 20,
    gap: 12,
  },
  questionText: {
    color: '#123433',
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 22,
  },
  optionButton: {
    borderWidth: 1,
    borderColor: '#D9E7E5',
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#F7FAF9',
  },
  optionText: {
    color: '#123433',
    fontSize: 15,
    fontWeight: '500',
  },
  logLine: {
    color: '#526866',
    fontSize: 12,
    lineHeight: 18,
  },
});
