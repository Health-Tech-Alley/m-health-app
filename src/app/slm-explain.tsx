/**
 * Shared SLM explanation + clarifying-question + next-steps screen.
 *
 * The tail end of all three steel threads. Loads the SLM (if needed), calls
 * `orchestrator.explainAlert`, renders the Markdown explanation with
 * citations, surfaces the optional clarifying question, and finally renders
 * the SLM-proposed next-step options. Tapping a next-step runs
 * `executeNextStep` (native deep-link / consent-gated share / in-app action)
 * and shows the result.
 *
 * HITL is always present: an "Override" button opens a note field and logs a
 * caregiver_action.
 */

import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Modal,
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
import { getAlertById, insertCaregiverAction } from '@/data';
import type { NextStepActionId } from '@/data/types';
import type { AgentProposal } from '@/orchestration';
import { executeNextStep, type NextStepExecutionResult } from '@/orchestration/next-steps';

const TEAL = '#0E6F68';
const BG = '#EEF7F6';
const DARK = '#123433';
const MUTED = '#526866';
const RED = '#B42318';

const CAREGIVER_SLM_MODEL_ID = 'healthgpt-pro-4b';

export default function SlmExplainScreen() {
  const router = useRouter();
  const orchestrator = useOrchestrator();
  const slm = useSLM();
  const patientId = useOrchestratorPatientId();
  const { alertId } = useLocalSearchParams<{ alertId: string }>();

  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [traceOpen, setTraceOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideText, setOverrideText] = useState('');
  const [stepResult, setStepResult] = useState<NextStepExecutionResult | null>(null);

  const log = useCallback((msg: string) => setLogs((prev) => [...prev, msg]), []);

  const explain = useCallback(async () => {
    if (!alertId) return;
    setLoading(true);
    setError(null);
    setProposal(null);
    setStepResult(null);
    try {
      if (slm.loadStatus !== 'ready') {
        log('Loading SLM model…');
        await slm.loadModel(CAREGIVER_SLM_MODEL_ID);
      }
      log('Requesting SLM explanation…');
      const result = await orchestrator.explainAlert(alertId, 'caregiver-1');
        setProposal(result);
        log(`Explanation received. Citations: ${result.citations.length}.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        log(`Explain failed: ${msg}`);
      } finally {
        setLoading(false);
      }
  }, [alertId, orchestrator, slm, log]);

  useEffect(() => {
    // Defer so setState happens in an async callback, not synchronously in
    // the effect body (keeps the render pure and avoids cascading renders).
    const timer = setTimeout(() => {
      void explain();
    }, 0);
    return () => clearTimeout(timer);
  }, [explain]);

  const answerQuestion = useCallback(
    async (option: string) => {
      if (!alertId || !proposal?.clarifyingQuestion) return;
      setLoading(true);
      setError(null);
      try {
        log(`Answering clarifying question: ${option}`);
        const result = await orchestrator.answerClarifyingQuestion(
          alertId,
          'caregiver-1',
          proposal.clarifyingQuestion.questionId,
          option,
        );
        setProposal(result);
        log('Clarifying question answered; SLM re-ran.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        log(`Answer failed: ${msg}`);
      } finally {
        setLoading(false);
      }
    },
    [alertId, proposal, orchestrator, slm, log],
  );

  const runNextStep = useCallback(
    async (actionId: NextStepActionId) => {
      if (!alertId) return;
      setLoading(true);
      setError(null);
      try {
        const result = await executeNextStep(actionId, {
          patientId,
          alertId,
          caregiverId: 'caregiver-1',
        });
        setStepResult(result);
        log(`Next-step "${actionId}": ${result.message}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        log(`Next-step failed: ${msg}`);
      } finally {
        setLoading(false);
      }
    },
    [alertId, patientId, log],
  );

  const saveOverride = useCallback(() => {
    if (!alertId || !overrideText.trim()) return;
    insertCaregiverAction({
      actionId: `act-${Date.now()}`,
      alertId,
      patientId,
      caregiverId: 'caregiver-1',
      type: 'override',
      payloadJson: JSON.stringify({ note: overrideText.trim() }),
      createdAt: new Date().toISOString(),
    });
    log('Override recorded.');
    setOverrideText('');
    setOverrideOpen(false);
  }, [alertId, patientId, overrideText, log]);

  const alert = alertId ? getAlertById(alertId) : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backLink}>← Back</Text>
          </Pressable>
          <Text style={styles.topTitle}>Assistant</Text>
        </View>

        {alert && (
          <View style={[styles.alertPill, { borderColor: alert.severity === 3 ? RED : TEAL }]}>
            <Text style={styles.alertPillText} numberOfLines={1}>
              {alert.title}
            </Text>
          </View>
        )}

        {loading && (
          <View style={styles.card}>
            <Text style={styles.muted}>Assistant is thinking…</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryButton} onPress={explain}>
              <Text style={styles.buttonText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {proposal && (
          <View style={styles.explanationCard}>
            <View style={styles.explanationHeader}>
              <Text style={styles.explanationEyebrow}>SLM Analysis</Text>
              <Text style={styles.explanationTitle}>Alert Explanation</Text>
            </View>

            <View style={styles.answerContainer}>
              <MarkdownRenderer size="large">{proposal.message}</MarkdownRenderer>
            </View>

            {proposal.citations.length > 0 && (
              <View style={styles.citationsSection}>
                <Text style={styles.sectionTitle}>Clinical Citations</Text>
                {proposal.citations.map((c) => (
                  <Text key={c} style={styles.citation}>
                    [{c}]
                  </Text>
                ))}
              </View>
            )}

            {proposal.clarifyingQuestion && (
              <View style={styles.questionSection}>
                <Text style={styles.sectionTitle}>Clarifying Question</Text>
                <Text style={styles.questionText}>{proposal.clarifyingQuestion.question}</Text>
                {proposal.clarifyingQuestion.options.map((option) => (
                  <Pressable
                    key={option}
                    style={styles.optionButton}
                    onPress={() => answerQuestion(option)}
                    disabled={loading}
                  >
                    <Text style={styles.optionText}>{option}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {proposal.nextSteps && proposal.nextSteps.length > 0 && (
              <View style={styles.nextStepsSection}>
                <Text style={styles.sectionTitle}>Recommended Next Steps</Text>
                {stepResult ? (
                  <View style={styles.stepResultBox}>
                    <Text
                      style={[
                        styles.stepResultText,
                        stepResult.success ? { color: TEAL } : { color: RED },
                      ]}
                    >
                      {stepResult.success ? '✓' : '✗'} {stepResult.message}
                    </Text>
                  </View>
                ) : null}
                {proposal.nextSteps.map((step) => {
                  const isDanger = step.actionId === 'call_911' || step.actionId === 'go_to_er';
                  return (
                    <Pressable
                      key={step.actionId}
                      style={[
                        styles.nextStepButton,
                        isDanger && styles.nextStepDanger,
                      ]}
                      onPress={() => runNextStep(step.actionId)}
                      disabled={loading}
                    >
                      <Text
                        style={[
                          styles.nextStepText,
                          isDanger && styles.nextStepTextDanger,
                        ]}
                      >
                        {step.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* HITL controls */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Caregiver Control</Text>
          <Pressable style={styles.overrideButton} onPress={() => setOverrideOpen(true)}>
            <Text style={styles.overrideButtonText}>Override / Add note</Text>
          </Pressable>
        </View>

        {/* Trace log (collapsible) */}
        <Pressable style={styles.traceHeader} onPress={() => setTraceOpen((v) => !v)}>
          <Text style={styles.sectionTitle}>{traceOpen ? '▾' : '▸'} Trace Log</Text>
        </Pressable>
        {traceOpen && (
          <View style={styles.card}>
            {logs.length === 0 ? (
              <Text style={styles.muted}>No trace events yet.</Text>
            ) : (
              logs.map((l, i) => (
                <Text key={i} style={styles.logLine}>
                  • {l}
                </Text>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Override modal */}
      <Modal visible={overrideOpen} animationType="slide" transparent onRequestClose={() => setOverrideOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Override / Note</Text>
            <Text style={styles.modalSubtext}>
              Record a caregiver override. This is logged as a caregiver_action and feeds the
              personalization loop.
            </Text>
            <TextInput
              style={styles.noteInput}
              value={overrideText}
              onChangeText={setOverrideText}
              placeholder="Describe your override or observation…"
              placeholderTextColor="#9AA4A8"
              multiline
              textAlignVertical="top"
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setOverrideOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSave} onPress={saveOverride}>
                <Text style={styles.buttonText}>Save override</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: BG,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 14,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backLink: {
    color: TEAL,
    fontWeight: '700',
    fontSize: 15,
  },
  topTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: DARK,
  },
  alertPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  alertPillText: {
    color: DARK,
    fontSize: 13,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E4E7EC',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: MUTED,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  muted: {
    color: MUTED,
    fontSize: 14,
  },
  errorBox: {
    backgroundColor: '#FEE4E2',
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: RED,
  },
  errorText: {
    color: RED,
    fontSize: 14,
    fontWeight: '600',
  },
  retryButton: {
    backgroundColor: TEAL,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  explanationCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E4E7EC',
  },
  explanationHeader: {
    backgroundColor: TEAL,
    padding: 18,
  },
  explanationEyebrow: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
    opacity: 0.85,
  },
  explanationTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  answerContainer: {
    padding: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D9E7E5',
  },
  citationsSection: {
    padding: 14,
    backgroundColor: '#F7FAF9',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D9E7E5',
  },
  sectionTitle: {
    color: TEAL,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  citation: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
  },
  questionSection: {
    padding: 18,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D9E7E5',
  },
  questionText: {
    color: DARK,
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
    color: DARK,
    fontSize: 15,
    fontWeight: '500',
  },
  nextStepsSection: {
    padding: 18,
    gap: 10,
  },
  stepResultBox: {
    backgroundColor: '#F7FAF9',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#D9E7E5',
  },
  stepResultText: {
    fontSize: 14,
    fontWeight: '700',
  },
  nextStepButton: {
    borderWidth: 1,
    borderColor: TEAL,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  nextStepDanger: {
    borderColor: RED,
    backgroundColor: '#FEE4E2',
  },
  nextStepText: {
    color: TEAL,
    fontSize: 15,
    fontWeight: '700',
  },
  nextStepTextDanger: {
    color: RED,
  },
  overrideButton: {
    borderWidth: 1,
    borderColor: '#D9E7E5',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  overrideButtonText: {
    color: DARK,
    fontSize: 15,
    fontWeight: '700',
  },
  traceHeader: {
    paddingVertical: 6,
  },
  logLine: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(18,52,51,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: DARK,
  },
  modalSubtext: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: '#D9E7E5',
    borderRadius: 12,
    padding: 12,
    minHeight: 120,
    fontSize: 15,
    color: DARK,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancel: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  modalCancelText: {
    color: MUTED,
    fontWeight: '700',
    fontSize: 15,
  },
  modalSave: {
    backgroundColor: TEAL,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
});
