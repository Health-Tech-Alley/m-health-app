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
  Alert,
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
  retrievePlanChunks,
  formatCitationsForPrompt,
  buildRetrievalQuery,
  type RetrievedCitation,
} from '@/clinical-evidence/retrieval-helper';
import { DEFAULT_SLM_MODEL_ID, MODEL_CATALOG } from '@/inference/model-catalog';
import { isModelInstalled } from '@/services/model-storage';
import type { SlmTaskLease } from '@/services/slm/slm-task-queue';
import { stripControlTokens } from '@/utils/stripControlTokens';
import type { CareIntentDefinition, AnyIntentOutput } from '@/services/carePlan/intentCatalog';
import type { PatientRecordSnapshot } from '@/data/types';
import { runIntent, type RunIntentResult } from '@/services/carePlan/intentRouter';
import { runSlmCompletion } from '@/services/carePlan/careSlmAdapter';
import { formatAnswerWithCollapsedSources } from '@/clinical-evidence/citation-display';

export interface CarePlanInsightSheetProps {
  visible: boolean;
  intent: CareIntentDefinition<any, any> | null;
  snapshot: PatientRecordSnapshot | null;
  onClose: () => void;
  onProposalResolved?: (result: RunIntentResult<AnyIntentOutput>) => void;
  /** Optional prefilled args from Care soft-NLU / chips (planning/40). */
  intentArgs?: Record<string, unknown>;
}

type Phase = 'idle' | 'loading' | 'thinking' | 'streaming' | 'done' | 'error';

const BODY_MAX_HEIGHT = Math.round(Dimensions.get('window').height * 0.55);

export function CarePlanInsightSheet({
  visible,
  intent,
  snapshot,
  onClose,
  onProposalResolved,
  intentArgs,
}: CarePlanInsightSheetProps) {
  const slm = useSLM();
  const {
    acquireSlm,
    loadModel: slmLoadModel,
    unloadModel: slmUnloadModel,
    currentModelId: slmCurrentModelId,
    taskQueue,
    policy: slmPolicy,
  } = slm;
  const { settings } = useSettings();
  const { snapshot: liveSnapshot } = usePatientRecord();
  const defaultModelId = settings.demoDefaultModelId ?? DEFAULT_SLM_MODEL_ID;
  const [phase, setPhase] = useState<Phase>('idle');
  const [answer, setAnswer] = useState('');
  const [finalText, setFinalText] = useState<string | null>(null);
  const [sourceLabels, setSourceLabels] = useState<string[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [result, setResult] = useState<RunIntentResult<AnyIntentOutput> | null>(null);
  const [proposalResolvedAt, setProposalResolvedAt] = useState<string | null>(null);
  const citationChunksRef = useRef<RetrievedCitation[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef(false);
  const leaseRef = useRef<SlmTaskLease | null>(null);
  const loadedBySheetRef = useRef(false);
  const ranRef = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const answerAccRef = useRef('');

  const [panY] = useState(() => new Animated.Value(0));
  const dragThreshold = 90;
  const effectiveSnapshot = snapshot ?? liveSnapshot;

  const releaseLease = useCallback(() => {
    const hadLease = leaseRef.current !== null;
    leaseRef.current?.release();
    leaseRef.current = null;
    // If we loaded the model explicitly and never got a queue lease, unload
    // under auto policy so Care doesn't pin RAM after dismiss.
    if (
      loadedBySheetRef.current &&
      !hadLease &&
      slmPolicy === 'auto' &&
      taskQueue.activeLeaseCount === 0
    ) {
      void slmUnloadModel();
    }
    loadedBySheetRef.current = false;
  }, [slmPolicy, slmUnloadModel, taskQueue]);

  /**
   * Align with SlmInsightSheet (E3): single-flight lease via task queue.
   * Never call loadModel in parallel with another path (dual initLlama OOMs iOS).
   */
  const ensureModelAndLease = useCallback(async (): Promise<SlmTaskLease | null> => {
    loadedBySheetRef.current = false;
    try {
      return await acquireSlm('care_concierge');
    } catch {
      /* fall through to explicit load */
    }
    const installed = MODEL_CATALOG.filter(isModelInstalled);
    if (installed.length === 0) return null;
    const preferred = installed.find((m) => m.id === defaultModelId) ?? installed[0];
    try {
      await slmLoadModel(preferred.id);
    } catch {
      return null;
    }
    loadedBySheetRef.current = true;
    // Let React commit loadStatus='ready' so the queue grants a tracked lease.
    await new Promise((r) => setTimeout(r, 0));
    if (cancelRef.current) return null;
    try {
      return await acquireSlm('care_concierge');
    } catch {
      // Proceed without lease only if provider is actually ready; close path
      // will unload if we loaded without a lease.
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
    answerAccRef.current = '';
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
    // Prefer provider.getModelInfo() over loadStatus — after await, React may
    // not have re-rendered yet (same pattern as SlmInsightSheet).
    if (!activeProvider?.getModelInfo()) {
      lease?.release();
      leaseRef.current = null;
      const installed = MODEL_CATALOG.filter(isModelInstalled);
      setError(
        installed.length === 0
          ? 'Concierge is unavailable — no model is installed. Open Models to download one, then retry.'
          : 'Concierge could not load a model. Free memory, open Models, load Concierge, then retry.',
      );
      setPhase('error');
      return;
    }

    try {
      abortRef.current = new AbortController();
      setPhase('thinking');

      const conditionName = effectiveSnapshot.primaryCondition?.name;
      const args: Record<string, unknown> = { ...(intentArgs ?? {}) };
      const retrievalQuery = buildRetrievalQuery(conditionName, intent.caregiverLabel);
      const patientId = effectiveSnapshot.patient?.patientId ?? '';
      // Plan-only RAG, tightly capped — ADCP assembler already carries priorities/meds.
      const planCitations: RetrievedCitation[] = (
        patientId ? retrievePlanChunks(patientId, retrievalQuery, 2) : []
      ).map((c) => ({
        ...c,
        text: c.text.length > 280 ? `${c.text.slice(0, 280)}…` : c.text,
      }));
      citationChunksRef.current = planCitations;
      const citationBlock = formatCitationsForPrompt(planCitations, 600);

      const routerResult = await runIntent<AnyIntentOutput>({
        snapshot: effectiveSnapshot,
        intent: intent.intentId,
        args,
        completePrompt: async (params) => {
          // Intent system already has compact ADCP + meds + UC slices.
          // Do not stack full caregiver+tools+NLU system (blows n_ctx).
          const systemContext = params.systemContext;
          const userPrompt = citationBlock
            ? `${params.userPrompt}\n\n${citationBlock}`
            : params.userPrompt;
          let firstToken = false;
          setCurrentModelId(slmCurrentModelId);
          answerAccRef.current = '';
          const text = await runSlmCompletion({
            provider: activeProvider,
            systemContext,
            userPrompt,
            signal: abortRef.current?.signal,
            onToken: (token) => {
              if (cancelRef.current) return;
              if (!firstToken) {
                firstToken = true;
                setPhase('streaming');
              }
              answerAccRef.current += token;
              setAnswer(answerAccRef.current);
            },
          });
          if (!cancelRef.current) setAnswer(text);
          return text;
        },
      });

      if (cancelRef.current) return;
      const outputAny = routerResult.output as { explanation?: string };
      const raw =
        outputAny?.explanation?.trim() ||
        answerAccRef.current ||
        '';
      const cleaned = stripControlTokens(raw).answer;
      const collapsed = formatAnswerWithCollapsedSources(
        cleaned,
        citationChunksRef.current,
      );
      setFinalText(collapsed.displayText || null);
      setSourceLabels(collapsed.sourceLabels);
      setSourcesOpen(false);
      setResult(routerResult);
      setPhase('done');
    } catch (err) {
      if (cancelRef.current || abortRef.current?.signal.aborted) {
        setPhase('idle');
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    } finally {
      abortRef.current = null;
      // One-off Care intent explain: release lease immediately so Concierge
      // can unload under auto/dynamic policy (do not wait for sheet dismiss).
      leaseRef.current?.release();
      leaseRef.current = null;
      loadedBySheetRef.current = false;
    }
  }, [
    intent,
    intentArgs,
    effectiveSnapshot,
    ensureModelAndLease,
    slm.provider,
    slmCurrentModelId,
  ]);

  // One auto-run per open+intent; StrictMode-safe via ranRef.
  useEffect(() => {
    if (!visible) {
      ranRef.current = false;
      return;
    }
    if (ranRef.current) return;
    ranRef.current = true;
    const handle = setTimeout(() => {
      void runExplain();
    }, 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, intent?.intentId]);

  // When parent hides the sheet without handleClose (e.g. proposal resolve),
  // still abort work and drop the lease so the task queue can unload.
  useEffect(() => {
    if (visible) return;
    cancelRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    releaseLease();
    // Defer so the state update does not run synchronously within the effect
    // (react-hooks/set-state-in-effect).
    const handle = setTimeout(() => setPhase('idle'), 0);
    return () => clearTimeout(handle);
  }, [visible, releaseLease]);

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

  const phaseRef = useRef<Phase>('idle');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const performClose = useCallback(() => {
    cancelRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    releaseLease();
    ranRef.current = false;
    onClose();
  }, [onClose, releaseLease]);

  const handleClose = useCallback(() => {
    const running =
      phaseRef.current === 'loading' ||
      phaseRef.current === 'thinking' ||
      phaseRef.current === 'streaming';
    if (running) {
      Alert.alert(
        'Stop Concierge?',
        'Concierge is still generating. Closing now will cancel this explanation.',
        [
          { text: 'Keep going', style: 'cancel' },
          { text: 'Stop', style: 'destructive', onPress: performClose },
        ],
      );
      return;
    }
    performClose();
  }, [performClose]);

  const handleRetryLoad = useCallback(async () => {
    setPhase('loading');
    setError(null);
    cancelRef.current = false;
    try {
      releaseLease();
      try {
        await slmUnloadModel();
      } catch {
        /* ignore */
      }
      // Brief yield so native mmap can release before re-load (iOS OOM path).
      await new Promise((r) => setTimeout(r, 400));
      if (cancelRef.current) return;
      ranRef.current = false;
      ranRef.current = true;
      await runExplain();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [releaseLease, slmUnloadModel, runExplain]);

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

  /* eslint-disable react-hooks/refs --
     PanResponder callbacks fire at event time, not during render;
     handleClose/panY are captured, not invoked. Same pattern as
     SlmInsightSheet's swipe-to-dismiss. */
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
              <View>
                <Text style={styles.errorText}>
                  Couldn&apos;t run this intent: {error}
                </Text>
                <Pressable
                  style={styles.retryButton}
                  onPress={() => {
                    void handleRetryLoad();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading Concierge"
                >
                  <Text style={styles.retryButtonText}>Retry Concierge load</Text>
                </Pressable>
              </View>
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

            {phase === 'done' && sourceLabels.length > 0 ? (
              <View style={styles.sourcesBlock}>
                <Pressable
                  style={styles.sourcesToggle}
                  onPress={() => setSourcesOpen((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: sourcesOpen }}
                  accessibilityLabel={`Sources, ${sourceLabels.length}`}
                >
                  <Text style={styles.sourcesToggleText}>
                    Sources ({sourceLabels.length})
                  </Text>
                  <Text style={styles.sourcesChevron}>{sourcesOpen ? '▾' : '▸'}</Text>
                </Pressable>
                {sourcesOpen
                  ? sourceLabels.map((label) => (
                      <Text key={label} style={styles.sourceRow}>
                        {'\u2022'} {label}
                      </Text>
                    ))
                  : null}
              </View>
            ) : null}

            {phase === 'done' || phase === 'error' ? (
              <Pressable
                style={styles.regenerateButton}
                onPress={() => {
                  void runExplain();
                }}
                accessibilityRole="button"
                accessibilityLabel="Regenerate"
              >
                <Text style={styles.regenerateButtonText}>Regenerate</Text>
              </Pressable>
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
                      // Always release lease via handleClose — parent may only
                      // flip visible=false without calling onClose itself.
                      handleClose();
                    }}
                  >
                    <Text style={styles.confirmText}>Send for your review</Text>
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
  retryButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: '900',
  },
  errorText: {
    color: AppTheme.colors.danger,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 8,
  },
  sourcesBlock: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    paddingTop: 12,
  },
  sourcesToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  sourcesToggleText: {
    color: AppTheme.colors.brandDark,
    fontSize: 13,
    fontWeight: '900',
  },
  sourcesChevron: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: '900',
  },
  sourceRow: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
    fontWeight: '600',
  },
  regenerateButton: {
    marginTop: 16,
    alignSelf: 'flex-start',
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  regenerateButtonText: {
    color: AppTheme.colors.brandDark,
    fontSize: 13,
    fontWeight: '900',
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
