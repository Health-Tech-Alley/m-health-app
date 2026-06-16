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

import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MarkdownRenderer } from '@/components/markdown-renderer';
import {
  useOrchestrator,
  useOrchestratorPatientId,
} from '@/contexts/orchestrator-context';
import { useSLM } from '@/contexts/slm-context';
import { getActiveAlerts } from '@/data';
import type { Alert } from '@/data/types';
import { getEventBus, type OrchestrationEvent, type AgentProposal } from '@/orchestration';

export default function AcuteAnomalyScreen() {
  const orchestrator = useOrchestrator();
  const slm = useSLM();

  const patientId = useOrchestratorPatientId();
  const [alerts, setAlerts] = useState<Alert[]>(() => getActiveAlerts(patientId));
  const [logs, setLogs] = useState<string[]>(() => {
    if (patientId) return [];
    return ['No patient seeded yet. Onboarding profile may be empty.'];
  });

  const [spo2, setSpo2] = useState('86');
  const [heartRate, setHeartRate] = useState('95');
  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [loading, setLoading] = useState(false);

  function log(message: string): void {
    setLogs((prev) => [...prev, message]);
  }

  function refreshAlerts(pid: string): void {
    setAlerts(getActiveAlerts(pid));
  }

  function simulateVitals(): void {
    if (!patientId) {
      log('No patientId. Seed the database from onboarding first.');
      return;
    }

    const now = new Date().toISOString();
    const spo2Event: Extract<OrchestrationEvent, { type: 'vitals_sample' }> = {
      type: 'vitals_sample',
      patientId,
      sampleId: `sample-${Date.now()}`,
      sampleType: 'spo2',
      value: Number(spo2) / 100,
      unit: 'fraction',
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

    // Give the orchestrator a tick to process, then refresh.
    setTimeout(() => refreshAlerts(patientId), 50);
  }

  async function explainAlert(alertId: string): Promise<void> {
    setLoading(true);
    setProposal(null);
    try {
      if (slm.loadStatus !== 'ready') {
        await slm.loadModel(CAREGIVER_SLM_MODEL_ID);
      }
      const result = await orchestrator.explainAlert(alertId, 'caregiver-1');
      setProposal(result);
      log(`SLM explanation received. Citations: ${result.citations.length}`);
    } catch (err) {
      log(`Explain failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function answerQuestion(option: string): Promise<void> {
    if (!proposal?.clarifyingQuestion) return;
    setLoading(true);
    try {
      const alertId = alerts[0]?.alertId;
      if (!alertId) return;
      const result = await orchestrator.answerClarifyingQuestion(
        alertId,
        'caregiver-1',
        proposal.clarifyingQuestion.questionId,
        option,
      );
      setProposal(result);
      log('Clarifying question answered; SLM re-ran.');
    } catch (err) {
      log(`Answer failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Acute Anomaly Flow</Text>
        <Text style={styles.subtitle}>
          Simulate vitals, watch the orchestrator create alerts, then ask the SLM for an
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
            <Text style={styles.buttonText}>Send vitals to orchestrator</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Active Alerts</Text>
          {alerts.length === 0 ? (
            <Text style={styles.muted}>No active alerts.</Text>
          ) : (
            alerts.map((alert) => (
              <View key={alert.alertId} style={styles.alertRow}>
                <View
                style={[
                  styles.severityDot,
                  {
                    backgroundColor:
                      alert.severity === 3 ? '#B42318' : alert.severity === 2 ? '#B54708' : '#0E6F68',
                  },
                ]}
              />
                <View style={styles.alertBody}>
                  <Text style={styles.alertTitle}>{alert.title}</Text>
                  <Text style={styles.muted}>{alert.body}</Text>
                  {alert.severity < 3 && (
                    <Pressable
                      style={[styles.button, styles.secondaryButton]}
                      onPress={() => explainAlert(alert.alertId)}>
                      <Text style={styles.secondaryButtonText}>Explain with SLM</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ))
          )}
        </View>

        {loading && (
          <View style={styles.card}>
            <Text style={styles.muted}>Loading SLM explanation…</Text>
          </View>
        )}

        {proposal && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>SLM Explanation</Text>
            <View style={styles.answerBox}>
              <MarkdownRenderer size="large">{proposal.message}</MarkdownRenderer>
            </View>

            {proposal.citations.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Citations</Text>
                {proposal.citations.map((c) => (
                  <Text key={c} style={styles.citation}>
                    [{c}]
                  </Text>
                ))}
              </>
            )}

            {proposal.clarifyingQuestion && (
              <>
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
              </>
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

const CAREGIVER_SLM_MODEL_ID = 'healthgpt-pro-4b';

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
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#123433',
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
  alertRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#12343315',
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
  answerBox: {
    backgroundColor: '#F7FAF9',
    borderRadius: 16,
    padding: 16,
  },
  sectionTitle: {
    color: '#0E6F68',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  citation: {
    color: '#526866',
    fontSize: 13,
  },
  questionText: {
    color: '#123433',
    fontWeight: '700',
    fontSize: 15,
  },
  optionButton: {
    borderWidth: 1,
    borderColor: '#D9E7E5',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#F7FAF9',
  },
  optionText: {
    color: '#123433',
    fontSize: 14,
  },
  logLine: {
    color: '#526866',
    fontSize: 12,
    lineHeight: 18,
  },
});
