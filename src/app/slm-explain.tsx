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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { ThinkingIndicator } from '@/components/concierge/ThinkingIndicator';
import { AiSuggestsTagline } from '@/components/AiSuggestsTagline';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import {
  useOrchestrator,
  useOrchestratorPatientId,
} from '@/contexts/orchestrator-context';
import { useSLM } from '@/contexts/slm-context';
import {
  getAlertById,
  getUc3TrajectoryResultById,
  getUc4PriorityCardSummaryById,
  insertCaregiverAction,
} from '@/data';
import type { NextStepActionId } from '@/data/types';
import { DEFAULT_SLM_MODEL_ID } from '@/inference/model-catalog';
import type { AgentProposal } from '@/orchestration';
import { executeNextStep, type NextStepExecutionResult } from '@/orchestration/next-steps';
import type { SlmTaskLease } from '@/services/slm/slm-task-queue';

const TEAL = '#0E6F68';
const BG = '#EEF7F6';
const DARK = '#123433';
const MUTED = '#526866';
const RED = '#B42318';
const AMBER = '#E1A53C';
const GREEN = '#0F7A4A';

function isModelLoadError(error: string | null): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return (
    lower.includes('no native slm') ||
    lower.includes('model unavailable') ||
    lower.includes('not installed') ||
    lower.includes('ram') ||
    lower.includes('memory') ||
    lower.includes('mmap') ||
    lower.includes('unable to load') ||
    lower.includes('failed to load') ||
    lower.includes('load attempts failed') ||
    lower.includes('model not loaded') ||
    lower.includes('slm is not ready') ||
    lower.includes('not ready') ||
    lower.includes('context is full') ||
    lower.includes('context window')
  );
}

function formatLoadFailureMessage(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes('ram') ||
    lower.includes('memory') ||
    lower.includes('mmap') ||
    lower.includes('2.9') ||
    lower.includes('contiguous')
  ) {
    return (
      `${raw}\n\n` +
      'Tips: close other apps, unload Concierge from Models/Settings if it is half-loaded, ' +
      'then retry. Prefer Gemma-4-E2B (~2.4 GB) if a larger model is selected.'
    );
  }
  if (lower.includes('not installed') || lower.includes('not found')) {
    return (
      `${raw}\n\n` +
      'Open Models and download the default Concierge model, then tap Load Concierge.'
    );
  }
  return raw;
}

const CAREGIVER_SLM_MODEL_ID = DEFAULT_SLM_MODEL_ID;

type ExplanationTarget =
  | { kind: 'alert'; alert: NonNullable<ReturnType<typeof getAlertById>> }
  | { kind: 'uc3'; result: NonNullable<ReturnType<typeof getUc3TrajectoryResultById>> }
  | { kind: 'uc4'; card: NonNullable<ReturnType<typeof getUc4PriorityCardSummaryById>> }
  | { kind: 'unavailable'; message: string };

export default function SlmExplainScreen() {
  const router = useRouter();
  const orchestrator = useOrchestrator();
  const slm = useSLM();
  const patientId = useOrchestratorPatientId();
  const {
    alertId,
    resultId,
    cardId,
    mode,
    patientId: routePatientId,
  } = useLocalSearchParams<{
    alertId?: string;
    resultId?: string;
    cardId?: string;
    mode?: string;
    patientId?: string;
  }>();

  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [traceOpen, setTraceOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideText, setOverrideText] = useState('');
  const [stepResult, setStepResult] = useState<NextStepExecutionResult | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const log = useCallback((msg: string) => setLogs((prev) => [...prev, msg]), []);

  const target = useMemo<ExplanationTarget>(() => {
    const requestedPatientId = routePatientId?.trim();
    const validatePatient = (targetPatientId: string, label: string): string | null => {
      if (requestedPatientId && requestedPatientId !== patientId) {
        return `This ${label} link is stale for the active patient. Switch back to the original patient or reopen the result.`;
      }
      if (targetPatientId !== patientId) {
        return `This ${label} belongs to a different patient. Switch back to that patient to view it.`;
      }
      return null;
    };

    if (alertId) {
      const alert = getAlertById(alertId);
      if (!alert) return { kind: 'unavailable', message: 'Alert not found.' };
      const mismatch = validatePatient(alert.patientId, 'alert');
      return mismatch ? { kind: 'unavailable', message: mismatch } : { kind: 'alert', alert };
    }

    if (mode === 'rehab_trajectory' && resultId) {
      const result = getUc3TrajectoryResultById(resultId);
      if (!result) return { kind: 'unavailable', message: 'Rehab trajectory result not found.' };
      const mismatch = validatePatient(result.patientId, 'rehab trajectory result');
      return mismatch ? { kind: 'unavailable', message: mismatch } : { kind: 'uc3', result };
    }

    if (mode === 'uc4_priority' && cardId) {
      const card = getUc4PriorityCardSummaryById(cardId);
      if (!card) return { kind: 'unavailable', message: 'Care focus card not found.' };
      const mismatch = validatePatient(card.patientId, 'care focus card');
      return mismatch ? { kind: 'unavailable', message: mismatch } : { kind: 'uc4', card };
    }

    return { kind: 'unavailable', message: 'No Concierge explanation target was selected.' };
  }, [alertId, cardId, mode, patientId, resultId, routePatientId]);

  const alert = target.kind === 'alert' ? target.alert : null;
  const acquireSlm = slm.acquireSlm;
  const screenLeaseRef = useRef<SlmTaskLease | null>(null);
  const explainStartedRef = useRef(false);

  /**
   * Single entry: one screen lease (loads model once via task queue), then explain.
   * Do NOT also call loadModel / ensureReady in parallel — dual initLlama crashes iOS.
   */
  const explain = useCallback(async () => {
    if (target.kind === 'unavailable') {
      setProposal(null);
      setStepResult(null);
      setError(target.message);
      log(`Explain unavailable: ${target.message}`);
      return;
    }

    setLoading(true);
    setError(null);
    setProposal(null);
    setStepResult(null);

    const reason =
      target.kind === 'uc3'
        ? 'explain_rehab_trajectory'
        : target.kind === 'uc4'
          ? 'uc4_provider_summary_rewrite'
          : 'explain_alert';

    let lease: SlmTaskLease | null = screenLeaseRef.current;
    try {
      if (!lease) {
        log('Loading Concierge (single screen lease)…');
        lease = await acquireSlm(reason);
        screenLeaseRef.current = lease;
        log('Concierge ready.');
      }

      if (slm.provider.getModelInfo() === null) {
        throw new Error(
          slm.loadError ??
            'Concierge model is not loaded. Free memory, unload other apps, then retry.',
        );
      }

      if (target.kind === 'uc3') {
        log('Requesting Concierge rehab trajectory explanation...');
        const result = await orchestrator.explainRehabTrajectory(
          target.result.resultId,
          'caregiver-1',
        );
        setProposal(result);
        log(`Explanation received. Citations: ${result.citations.length}.`);
        return;
      }

      if (target.kind === 'uc4') {
        log('Requesting Concierge care focus explanation...');
        const result = await orchestrator.explainUc4PriorityCard(
          target.card.cardId,
          'caregiver-1',
        );
        setProposal(result);
        log(`Explanation received. Citations: ${result.citations.length}.`);
        return;
      }

      log('Requesting Concierge explanation…');
      const result = await orchestrator.explainAlert(target.alert.alertId, 'caregiver-1');
      setProposal(result);
      log(`Explanation received. Citations: ${result.citations.length}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = formatLoadFailureMessage(msg);
      setError(friendly);
      log(`Explain failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [acquireSlm, orchestrator, log, target, slm.provider, slm.loadError]);

  // E3 HOTFIX: recovery CTA when native SLM failed to load.
  const handleLoadConcierge = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      screenLeaseRef.current?.release();
      screenLeaseRef.current = null;
      try {
        await slm.unloadModel();
      } catch {
        // ignore
      }
      // Brief yield so native release can finish before re-mmap.
      await new Promise((r) => setTimeout(r, 400));
      log(`Loading Concierge model ${CAREGIVER_SLM_MODEL_ID}…`);
      await slm.loadModel(CAREGIVER_SLM_MODEL_ID);
      log('Concierge loaded. Retrying explanation…');
      explainStartedRef.current = false;
      await explain();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(formatLoadFailureMessage(msg));
      log(`Load failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [slm, explain, log]);

  // Reset auto-run when the explain target changes (new result / card / alert).
  const targetKey =
    target.kind === 'uc3'
      ? `uc3:${target.result.resultId}`
      : target.kind === 'uc4'
        ? `uc4:${target.card.cardId}`
        : target.kind === 'alert'
          ? `alert:${target.alert.alertId}`
          : `unavailable:${target.message}`;

  useEffect(() => {
    explainStartedRef.current = false;
  }, [targetKey]);

  // One auto-run per target; lease released on unmount only.
  useEffect(() => {
    if (target.kind === 'unavailable') {
      // Defer so the state update does not run synchronously within the
      // effect (react-hooks/set-state-in-effect).
      const errorTimer = setTimeout(() => setError(target.message), 0);
      return () => clearTimeout(errorTimer);
    }
    if (explainStartedRef.current) return;
    explainStartedRef.current = true;
    const timer = setTimeout(() => {
      void explain();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [explain, target, targetKey]);

  useEffect(() => {
    return () => {
      screenLeaseRef.current?.release();
      screenLeaseRef.current = null;
      explainStartedRef.current = false;
    };
  }, []);

  const answerQuestion = useCallback(
    async (option: string) => {
      if (!alert || !proposal?.clarifyingQuestion) return;
      setLoading(true);
      setError(null);
      try {
        log(`Answering clarifying question: ${option}`);
        const result = await orchestrator.answerClarifyingQuestion(
          alert.alertId,
          'caregiver-1',
          proposal.clarifyingQuestion.questionId,
          option,
        );
        setProposal(result);
        log('Clarifying question answered; Concierge re-ran.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        log(`Answer failed: ${msg}`);
      } finally {
        setLoading(false);
      }
    },
    [alert, proposal, orchestrator, log],
  );

  const runNextStep = useCallback(
    async (actionId: NextStepActionId) => {
      if (!alert) return;
      setLoading(true);
      setError(null);
      try {
        const result = await executeNextStep(actionId, {
          patientId,
          alertId: alert.alertId,
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
    [alert, patientId, log],
  );

  const saveOverride = useCallback(() => {
    if (!alert || !overrideText.trim()) return;
    insertCaregiverAction({
      actionId: `act-${Date.now()}`,
      alertId: alert.alertId,
      patientId,
      caregiverId: 'caregiver-1',
      type: 'override',
      payloadJson: JSON.stringify({ note: overrideText.trim() }),
      createdAt: new Date().toISOString(),
    });
    log('Override recorded.');
    setFeedback('Thanks. I\u2019ll learn from your feedback.');
    setOverrideText('');
    setOverrideOpen(false);
  }, [alert, patientId, overrideText, log]);

  const confirmProposal = useCallback(() => {
    if (!alert) return;
    insertCaregiverAction({
      actionId: `act-${Date.now()}`,
      alertId: alert.alertId,
      patientId,
      caregiverId: 'caregiver-1',
      type: 'ask_slm',
      payloadJson: JSON.stringify({ confirmed: true }),
      createdAt: new Date().toISOString(),
    });
    log('Caregiver confirmed the Concierge explanation.');
    setFeedback('Got it. The next step is in your hands.');
  }, [alert, patientId, log]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backLink}>← Back</Text>
          </Pressable>
          <Text style={styles.topTitle}>Concierge</Text>
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
            <ThinkingIndicator text="" />
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorEyebrow}>Concierge unavailable</Text>
            <Text style={styles.errorText}>{error}</Text>
            {isModelLoadError(error) ? (
              <View style={styles.errorActions}>
                <Pressable
                  style={[styles.retryButton, styles.primaryButton]}
                  onPress={handleLoadConcierge}
                  accessibilityRole="button"
                  accessibilityLabel="Load Concierge"
                >
                  <Text style={styles.buttonText}>Unload & reload Concierge</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    void slm.unloadModel();
                    router.push('/models');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Open Models"
                >
                  <Text style={styles.secondaryButtonText}>Open Models</Text>
                </Pressable>
              </View>
            ) : null}
            <Pressable style={styles.retryButton} onPress={() => void explain()}>
              <Text style={styles.buttonText}>Retry</Text>
            </Pressable>
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

        {/* HITL controls — promoted per planning/29 */}
        {proposal ? (
          <View style={styles.hitlCard}>
            <AiSuggestsTagline variant="outline" />
            <View style={styles.hitlHeaderRow}>
              <Text style={styles.hitlTitle}>Your review</Text>
              {alert ? (
                <Text style={styles.hitlEyebrow}>
                  {alert.title}
                </Text>
              ) : null}
            </View>
            <Text style={styles.hitlHint}>
              The Concierge suggested the explanation above. Confirm if it matches what you see, or tell us why it\u2019s off.
            </Text>
            <View style={styles.hitlActions}>
              <Pressable
                style={[styles.hitlPrimaryButton, loading && styles.disabledButton]}
                onPress={confirmProposal}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Confirm the Concierge explanation"
              >
                <Text style={styles.hitlPrimaryText}>Looks right, proceed</Text>
              </Pressable>
              <Pressable
                style={styles.hitlSecondaryButton}
                onPress={() => setOverrideOpen(true)}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="I disagree with the Concierge"
              >
                <Text style={styles.hitlSecondaryText}>I disagree</Text>
              </Pressable>
            </View>
            <Text style={styles.tagline}>The Concierge suggests. You decide.</Text>
            {feedback ? (
              <View style={styles.feedbackBox}>
                <Text style={styles.feedbackText}>{feedback}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

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
  errorEyebrow: {
    color: RED,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  errorText: {
    color: RED,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  primaryButton: {
    backgroundColor: TEAL,
  },
  secondaryButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD9D7',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  secondaryButtonText: {
    color: TEAL,
    fontWeight: '700',
    fontSize: 14,
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
  hitlCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E4E7EC',
    padding: 18,
    gap: 12,
  },
  hitlHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hitlTitle: {
    color: DARK,
    fontSize: 17,
    fontWeight: '800',
  },
  hitlEyebrow: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 8,
  },
  hitlHint: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },
  tagline: {
    fontSize: 11,
    color: MUTED,
    fontStyle: 'italic',
    marginTop: 8,
    textAlign: 'center',
  },
  hitlActions: {
    flexDirection: 'row',
    gap: 10,
  },
  hitlPrimaryButton: {
    flex: 2,
    backgroundColor: GREEN,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  hitlPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  hitlSecondaryButton: {
    flex: 1,
    backgroundColor: AMBER,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  hitlSecondaryText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  disabledButton: { opacity: 0.5 },
  feedbackBox: {
    backgroundColor: '#F7FAF9',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#D9E7E5',
  },
  feedbackText: {
    color: TEAL,
    fontStyle: 'italic',
    fontSize: 13,
    lineHeight: 18,
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
