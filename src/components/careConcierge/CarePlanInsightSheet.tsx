/**
 * CarePlanInsightSheet — bottom sheet used by the Care Concierge intent
 * router (planning/39 P2).
 *
 * Modeled on `SlmInsightSheet` (transient lease + load/recover UX) but adds:
 *   - Renders the SLM answer as Markdown OR as a proposal diff (when the
 *     intent yields one).
 *   - Always includes a "Confirm" / "Reject" affordance when a pending
 *     proposal has been enqueued.
 *   - Fail-closed when no native SLM is loaded (no fake clinical text).
 *
 * Care SLM is on the regular lease path (NOT the fast path / NOT the
 * importance router).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { MarkdownRenderer } from '@/components/markdown-renderer';
import { AppTheme } from '@/constants/theme';
import { useSLM } from '@/contexts/slm-context';
import { usePatientRecord } from '@/contexts/patient-record-context';
import { useSettings } from '@/contexts/settings-context';
import {
  retrieveClinicalChunksViaBm25,
  retrievePlanChunks,
  formatCitationsForPrompt,
  buildRetrievalQuery,
  type RetrievedCitation,
} from '@/clinical-evidence/retrieval-helper';
import { useOrchestratorRetriever } from '@/contexts/orchestrator-context';
import { DEFAULT_SLM_MODEL_ID, MODEL_CATALOG } from '@/inference/model-catalog';
import { isModelInstalled } from '@/services/model-storage';
import type { SlmTaskLease } from '@/services/slm/slm-task-queue';
import { stripControlTokens } from '@/utils/stripControlTokens';
import type { CareIntentDefinition, AnyIntentOutput } from '@/services/carePlan/intentCatalog';
import type { PatientRecordSnapshot } from '@/data/types';
import { runIntent, type RunIntentResult } from '@/services/carePlan/intentRouter';
import { runSlmCompletion } from '@/services/carePlan/careSlmAdapter';

export interface CarePlanInsightSheetProps {
  visible: boolean;
  intent: CareIntentDefinition<any, any> | null;
  snapshot: PatientRecordSnapshot | null;
  onClose: () => void;
  onProposalResolved?: (result: RunIntentResult<AnyIntentOutput>) => void;
}

type Phase = 'idle' | 'loading' | 'thinking' | 'streaming' | 'done' | 'error';

const BODY_MAX_HEIGHT = Math.round(Dimensions.get('window').height * 0.55);

export function CarePlanInsightSheet({
  visible,
  intent,
  snapshot,
  onClose,
  onProposalResolved,
}: CarePlanInsightSheetProps) {
  const slm = useSLM();
  const {
    acquireSlm,
    loadModel: slmLoadModel,
    currentModelId: slmCurrentModelId,
  } = slm;
  const { settings } = useSettings();
  const { snapshot: liveSnapshot } = usePatientRecord();
  const retriever = useOrchestratorRetriever();
  const defaultModelId = settings.demoDefaultModelId ?? DEFAULT_SLM_MODEL_ID;
  const [phase, setPhase] = useState<Phase>('idle');
  const [answer, setAnswer] = useState('');
  const [finalText, setFinalText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [result, setResult] = useState<RunIntentResult<AnyIntentOutput> | null>(null);
  const [proposalResolvedAt, setProposalResolvedAt] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef(false);
  const leaseRef = useRef<SlmTaskLease | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const [panY] = useState(() => new Animated.Value(0));
  const dragThreshold = 90;
  const effectiveSnapshot = snapshot ?? liveSnapshot;

  /**
   * Align with SlmInsightSheet (E3): acquire lease, else load any installed
   * model and re-acquire. Fail closed with a recovery hint — never fake text.
   */
  const ensureModelAndLease = useCallback(async (): Promise<SlmTaskLease | null> => {
    try {
      return await acquireSlm('care_concierge');
    } catch {
      /* fall through */
    }
    const installed = MODEL_CATALOG.filter(isModelInstalled);
    if (installed.length === 0) return null;
    const preferred = installed.find((m) => m.id === defaultModelId) ?? installed[0];
    try {
      await slmLoadModel(preferred.id);
    } catch {
      return null;
    }
    await new Promise((r) => setTimeout(r, 0));
    if (cancelRef.current) return null;
    try {
      return await acquireSlm('care_concierge');
    } catch {
      return null;
    }
  }, [acquireSlm, defaultModelId, slmLoadModel]);

  const runExplain = useCallback(async () => {
    if (!intent || !effectiveSnapshot) return;
    setPhase('loading');
    setAnswer('');
    setFinalText(null);
    setError(null);
    setResult(null);
    setProposalResolvedAt(null);
    cancelRef.current = false;
    leaseRef.current?.release();
    leaseRef.current = null;

    const lease = await ensureModelAndLease();
    if (cancelRef.current) {
      lease?.release();
      return;
    }
    leaseRef.current = lease;
    setCurrentModelId(slmCurrentModelId);

    const activeProvider = slm.provider;
    if (!activeProvider?.getModelInfo()) {
      lease?.release();
      leaseRef.current = null;
      const installed = MODEL_CATALOG.filter(isModelInstalled);
      setError(
        installed.length === 0
          ? 'Concierge is unavailable — no model is installed. Open Models to download one, then retry.'
          : 'Concierge could not load a model. Open Models, load Concierge, then retry this intent.',
      );
      setPhase('error');
      return;
    }

    try {
      abortRef.current = new AbortController();
      setPhase('thinking');

      const conditionName = effectiveSnapshot.primaryCondition?.name;
      const args: Record<string, unknown> = {};
      const retrievalQuery = buildRetrievalQuery(conditionName, intent.caregiverLabel);
      const patientId = effectiveSnapshot.patient?.patientId ?? '';
      // P4 plan-first: ADCP section chunks before literature so answers ground
      // in *this* patient's plan, then clinical evidence.
      const planCitations: RetrievedCitation[] = patientId
        ? retrievePlanChunks(patientId, retrievalQuery, 4)
        : [];
      const literatureCitations = await retrieveClinicalChunksViaBm25(
        retriever,
        retrievalQuery,
        3,
        patientId || undefined,
      );
      const citationKey = (c: RetrievedCitation) =>
        c.docId || c.sourceId || c.resourceId || c.text.slice(0, 48);
      const seen = new Set(planCitations.map(citationKey));
      const mergedCitations: RetrievedCitation[] = [
        ...planCitations,
        ...literatureCitations.filter((c) => {
          const key = citationKey(c);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      ];
      const citationBlock = formatCitationsForPrompt(mergedCitations);

      // Run the intent router with the SLM completion channel.
      const routerResult = await runIntent<AnyIntentOutput>({
        snapshot: effectiveSnapshot,
        intent: intent.intentId,
        args,
        completePrompt: async (params) => {
          const enrichedUser = citationBlock
            ? `${params.userPrompt}\n\nClinical knowledge:\n${citationBlock}`
            : params.userPrompt;
          let firstToken = false;
          setCurrentModelId(slmCurrentModelId);
          const text = await runSlmCompletion({
            provider: activeProvider,
            systemContext: params.systemContext,
            userPrompt: enrichedUser,
            signal: abortRef.current?.signal,
          });
          if (!firstToken) {
            firstToken = true;
            setPhase('streaming');
          }
          if (!cancelRef.current) setAnswer(text);
          return text;
        },
      });

      if (cancelRef.current) return;
      const outputAny = routerResult.output as { explanation?: string };
      const cleaned = stripControlTokens(outputAny?.explanation ?? answer).answer;
      setFinalText(cleaned);
      setResult(routerResult);
      setPhase('done');
    } catch (err) {
      if (cancelRef.current || abortRef.current?.signal.aborted) {
        setPhase('done');
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  }, [
    intent,
    effectiveSnapshot,
    ensureModelAndLease,
    slm.provider,
    slmCurrentModelId,
    retriever,
    answer,
  ]);

  useEffect(() => {
    if (!visible) return;
    const handle = setTimeout(() => {
      void runExplain();
    }, 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, intent?.intentId]);

  useEffect(() => {
    if (!visible) return;
    if (phase !== 'streaming' && phase !== 'done') return;
    const text = finalText ?? answer;
    if (!text) return;
    const handle = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: phase === 'streaming' });
    }, 16);
    return () => clearTimeout(handle);
  }, [visible, phase, answer, finalText]);

  const handleClose = useCallback(() => {
    cancelRef.current = true;
    abortRef.current?.abort();
    leaseRef.current?.release();
    leaseRef.current = null;
    onClose();
  }, [onClose]);

  useEffect(() => {
    return () => {
      cancelRef.current = true;
      abortRef.current?.abort();
      leaseRef.current?.release();
      leaseRef.current = null;
    };
  }, []);

  useEffect(() => {
    panY.setValue(0);
  }, [visible, panY]);

  /* eslint-disable react-hooks/exhaustive-deps --
     PanResponder.create returns handlers that capture refs/closures intentionally;
     recreating on every callback change would tear down the gesture. */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_evt, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_evt, g) => {
          if (g.dy > 0) panY.setValue(g.dy);
        },
        onPanResponderRelease: (_evt, g) => {
          if (g.dy > dragThreshold) {
            handleClose();
          } else {
            Animated.spring(panY, { toValue: 0, useNativeDriver: true }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(panY, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [handleClose, panY],
  );

  const statusLabel = deriveStatusLabel(phase, currentModelId, error);
  const statusTone = deriveStatusTone(phase);
  const inProgress = phase === 'loading' || phase === 'thinking' || phase === 'streaming';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY: panY }] }]}>
          <View {...panResponder.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>{intent?.caregiverLabel ?? 'Care Concierge'}</Text>
              <Pressable style={styles.closeButton} onPress={handleClose} hitSlop={12}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.statusRow, { backgroundColor: statusTone.bg }]}>
            {inProgress ? (
              <ActivityIndicator color={statusTone.fg} size="small" />
            ) : (
              <View style={[styles.statusDot, { backgroundColor: statusTone.fg }]} />
            )}
            <Text style={[styles.statusText, { color: statusTone.fg }]} numberOfLines={2}>
              {statusLabel}
            </Text>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {phase === 'error' ? (
              <Text style={styles.errorText}>
                Couldn&apos;t run this intent: {error}
              </Text>
            ) : null}

            {(phase === 'loading' || phase === 'thinking') ? (
              <Text style={styles.thinkingText}>Thinking…</Text>
            ) : null}

            {phase === 'streaming' ? (
              <Text style={styles.streamingText}>{answer || '…'}</Text>
            ) : null}

            {phase === 'done' && finalText ? (
              <MarkdownRenderer size="large">{finalText}</MarkdownRenderer>
            ) : null}

            {result && result.enqueuedProposalIds.length > 0 ? (
              <View style={styles.proposalBlock}>
                <Text style={styles.proposalKicker}>Plan proposal queued</Text>
                <Text style={styles.proposalMeta}>
                  Concierge drafted a plan update. Confirm below to send to ML vetting.
                </Text>
                <View style={styles.proposalActions}>
                  <Pressable
                    style={[styles.proposalButton, styles.confirmButton]}
                    onPress={() => {
                      setProposalResolvedAt(new Date().toISOString());
                      onProposalResolved?.(result);
                    }}
                  >
                    <Text style={styles.confirmText}>Send to ML vetting</Text>
                  </Pressable>
                </View>
                {proposalResolvedAt ? (
                  <Text style={styles.proposalResolved}>Sent — refresh to see updated plan.</Text>
                ) : null}
              </View>
            ) : null}

            {result?.enqueuedProposalIds?.length === 0 && phase === 'done' ? (
              <Text style={styles.explanationOnlyNote}>
                No plan change suggested — explanation only.
              </Text>
            ) : null}
          </ScrollView>

          {phase === 'done' && finalText ? (
            <Text style={styles.footnote}>
              Concierge guidance — not a diagnosis. Confirm any plan change with the care team.
            </Text>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

function deriveStatusLabel(phase: Phase, modelId: string | null, error: string | null): string {
  const modelTag = modelId ? ` · ${modelId}` : '';
  switch (phase) {
    case 'idle':
      return 'Preparing…';
    case 'loading':
      return modelId ? `Loading model · ${modelId}…` : 'Loading Concierge…';
    case 'thinking':
      return `Thinking${modelTag}…`;
    case 'streaming':
      return `Generating${modelTag}…`;
    case 'done':
      return `Complete${modelTag}`;
    case 'error':
      return `Error: ${error ?? 'unknown'}`;
    default:
      return '';
  }
}

function deriveStatusTone(phase: Phase): { fg: string; bg: string } {
  switch (phase) {
    case 'error':
      return { fg: AppTheme.colors.danger, bg: AppTheme.colors.dangerLight };
    case 'done':
      return { fg: AppTheme.colors.brandDark, bg: AppTheme.colors.brandSoft };
    case 'idle':
    case 'loading':
    case 'thinking':
    case 'streaming':
    default:
      return { fg: AppTheme.colors.brand, bg: AppTheme.colors.brandSoft };
  }
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    backgroundColor: AppTheme.colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingBottom: 24,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: AppTheme.colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 16,
    fontWeight: '900',
    flex: 1,
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: AppTheme.colors.softSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: AppTheme.colors.textSoft,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '900',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
  },
  body: {
    maxHeight: BODY_MAX_HEIGHT,
    paddingHorizontal: 20,
  },
  bodyContent: {
    paddingBottom: 12,
  },
  thinkingText: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    fontStyle: 'italic',
  },
  streamingText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  errorText: {
    color: AppTheme.colors.danger,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 8,
  },
  footnote: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  proposalBlock: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: AppTheme.colors.brandSoft,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  proposalKicker: {
    color: AppTheme.colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  proposalMeta: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  proposalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  proposalButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  confirmButton: {
    backgroundColor: AppTheme.colors.brand,
  },
  confirmText: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: '900',
  },
  proposalResolved: {
    color: AppTheme.colors.brandDark,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 8,
  },
  explanationOnlyNote: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 12,
  },
});
