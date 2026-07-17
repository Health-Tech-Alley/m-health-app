/**
 * SlmInsightSheet — reusable transient-SLM bottom sheet.
 *
 * Used for on-demand SLM explanations that are NOT the main alert-explain flow
 * (safety-note explanations, custom-med checks, etc.).
 *
 * Lifecycle (controlled load/unload):
 *   - On open: acquires an SLM lease via the task queue (auto-loads the default
 *     model in Demo/auto policy). If the lease fails (Developer/manual policy
 *     with no model loaded, or the default model isn't installed), the sheet
 *     explicitly loads an installed model when available so the UX works on a
 *     dev build (Track B) regardless of mode. A persistent status line shows the
 *     current phase (loading model / thinking / generating / done / error) plus
 *     the model id when available.
 *   - As tokens stream, the raw token stream is shown live (like the SLM prompt
 *     demo screen). When generation completes, the streamed text is replaced by
 *     the rendered Markdown answer.
 *   - On close: the lease is released. In auto policy the task queue's
 *     auto-unload timer takes over; if the sheet loaded the model explicitly
 *     without a queue lease, it unloads it on close (auto policy only). The
 *     sheet itself never owns the model beyond this task.
 *
 * Renders with the caregiver system context (patient record) so answers are
 * personalized. If no native model is available, the sheet reports an
 * unavailable/error state instead of generating replacement text.
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
import { CONCIERGE_GENERATION_DEEP } from '@/constants/concierge';
import { AppTheme } from '@/constants/theme';
import { usePatientRecord } from '@/contexts/patient-record-context';
import { useSettings } from '@/contexts/settings-context';
import { useSLM } from '@/contexts/slm-context';
import { DEFAULT_SLM_MODEL_ID, MODEL_CATALOG } from '@/inference/model-catalog';
import type { SlmTaskReason, SlmTaskLease } from '@/services/slm/slm-task-queue';
import { isModelInstalled } from '@/services/model-storage';
import {
  buildCaregiverAssistantContextFromSnapshot,
  buildCaregiverSystemContext,
} from '@/services/slm/slmService';
import {
  retrieveClinicalChunksViaBm25,
  formatCitationsForPrompt,
  buildRetrievalQuery,
} from '@/clinical-evidence/retrieval-helper';
import { useOrchestratorRetriever } from '@/contexts/orchestrator-context';
import { stripControlTokens } from '@/utils/stripControlTokens';

export interface SlmInsightSheetProps {
  visible: boolean;
  onClose: () => void;
  /** What this explanation is for (used as the lease reason + header). */
  title: string;
  /** The user prompt sent to the SLM. */
  prompt: string;
  /** Lease reason — defaults to 'safety_note_explain'. */
  reason?: SlmTaskReason;
}

type Phase = 'idle' | 'loading' | 'thinking' | 'streaming' | 'done' | 'error';
type Source = 'native';

// Points-based cap for the scrollable answer area. A definite (non-percentage)
// maxHeight guarantees the ScrollView bounds + scrolls regardless of the
// surrounding flex layout — the fragile part of the previous implementation.
const BODY_MAX_HEIGHT = Math.round(Dimensions.get('window').height * 0.5);

export function SlmInsightSheet({
  visible,
  onClose,
  title,
  prompt,
  reason = 'safety_note_explain',
}: SlmInsightSheetProps) {
  const slm = useSLM();
  // Pull only the stable pieces used inside runExplain so the callback doesn't
  // churn on every render (the `slm` value object is recreated each render).
  const {
    acquireSlm,
    provider,
    loadModel: slmLoadModel,
    unloadModel: slmUnloadModel,
    policy: slmPolicy,
    taskQueue,
    currentModelId,
  } = slm;
  const { snapshot } = usePatientRecord();
  const { settings } = useSettings();
  const retriever = useOrchestratorRetriever();
  const defaultModelId = settings.demoDefaultModelId ?? DEFAULT_SLM_MODEL_ID;

  const [phase, setPhase] = useState<Phase>('idle');
  const [answer, setAnswer] = useState('');
  const [finalText, setFinalText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const leaseRef = useRef<SlmTaskLease | null>(null);
  // True when the sheet loaded the model itself (not via the task queue's
  // auto-load). Used to unload on close when no queue lease tracks it.
  const loadedBySheetRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const ranRef = useRef(false);

  // Swipe-down-to-dismiss: the sheet translates with a downward drag on the
  // handle/header; releasing past the threshold closes it. Kept on the handle
  // area only so the ScrollView below keeps scrolling normally.
  const [panY] = useState(() => new Animated.Value(0));
  const dragThreshold = 90;

  /**
   * Ensure a model is loaded and return a lease when possible.
   *
   * 1. Try `acquireSlm` — in auto policy this auto-loads the default model.
   * 2. If that throws (manual policy, or default model not installed), look for
   *    any installed model and load it explicitly, then acquire a lease so the
   *    queue still tracks auto-unload. A microtask flush lets the queue's config
   *    effect run before the second acquire.
   * 3. If no model can be loaded, returns a null lease and the caller reports
   *    Concierge as unavailable.
   */
  const ensureModelAndLease = useCallback(async (): Promise<SlmTaskLease | null> => {
    loadedBySheetRef.current = false;

    try {
      const lease = await acquireSlm(reason);
      return lease;
    } catch {
      // Fall through to explicit load.
    }

    const installed = MODEL_CATALOG.filter(isModelInstalled);
    if (installed.length === 0) {
      return null;
    }

    const preferred =
      installed.find((m) => m.id === defaultModelId) ?? installed[0];

    try {
      await slmLoadModel(preferred.id);
    } catch {
      return null;
    }

    loadedBySheetRef.current = true;

    // Give React a tick to commit the loadStatus change and run the task-queue
    // config effect, so acquire() sees 'ready' and grants a lease (which lets
    // the queue handle auto-unload instead of the sheet doing it manually).
    await new Promise((r) => setTimeout(r, 0));
    if (cancelRef.current) return null;

    try {
      return await acquireSlm(reason);
    } catch {
      // Queue still not seeing ready (timing) — proceed without a lease; the
      // sheet will unload the model it loaded on close (auto policy only).
      return null;
    }
  }, [acquireSlm, reason, defaultModelId, slmLoadModel]);

  const runExplain = useCallback(async () => {
    setPhase('loading');
    setAnswer('');
    setFinalText(null);
    setError(null);
    setSource(null);
    setActiveModelId(currentModelId);
    cancelRef.current = false;

    const lease = await ensureModelAndLease();
    if (cancelRef.current) {
      lease?.release();
      return;
    }
    leaseRef.current = lease;
    setActiveModelId(currentModelId);

    const context = snapshot
      ? buildCaregiverAssistantContextFromSnapshot(snapshot)
      : {};

    // Retrieve clinical knowledge chunks from the knowledge cache (cache-only,
    // no live supplement — this is a transient sheet and latency matters).
    // Query: patient's primary condition + the prompt text (which contains the
    // safety consideration or med-check question).
    const conditionName = snapshot?.primaryCondition?.name;
    const retrievalQuery = buildRetrievalQuery(conditionName, prompt);
    const citations = await retrieveClinicalChunksViaBm25(
      retriever,
      retrievalQuery,
      3,
      snapshot?.patient?.patientId,
    );
    const citationBlock = formatCitationsForPrompt(citations);
    const enrichedPrompt = citationBlock
      ? `${prompt}\n\n${citationBlock}\n\nGround your answer in the clinical knowledge above. Cite sources in brackets like [PMID-12345678].`
      : prompt;

    // Prefer the native provider when a model is actually loaded. We check the
    // provider directly (getModelInfo()) rather than slm.loadStatus: after
    // awaiting a load the continuation runs as a microtask, before React
    // re-renders, so slm.loadStatus may still read 'loading'. A loaded provider
    // implies the model is ready.
    if (provider.getModelInfo()) {
      setSource('native');
      setPhase('thinking');

      const controller = new AbortController();
      abortRef.current = controller;
      let firstTokenSeen = false;

      try {
        const systemContext = buildCaregiverSystemContext(context);
        // Single mode: always deep. The fast path was removed app-wide, so the
        // insight sheet no longer branches on query complexity — the model
        // reasons fully (unlimited budget) then emits the complete answer.
        const generation = CONCIERGE_GENERATION_DEEP;
        const result = await provider.chat(
          [
            { role: 'system', content: systemContext },
            { role: 'user', content: enrichedPrompt },
          ],
          (token) => {
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              setPhase('streaming');
            }
            setAnswer((prev) => prev + token);
          },
          controller.signal,
          generation,
        );
        if (cancelRef.current) return;
        const cleaned = stripControlTokens(result.text).answer;
        setAnswer(cleaned);
        setFinalText(cleaned);
        setPhase('done');
      } catch (err) {
        if (cancelRef.current || controller.signal.aborted) {
          setPhase('done');
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      } finally {
        abortRef.current = null;
      }
      return;
    }

    // No native model available; do not synthesize replacement text.
    setError('Concierge is unavailable because no native SLM model is loaded.');
    setPhase('error');
  }, [
    ensureModelAndLease,
    provider,
    snapshot,
    prompt,
    currentModelId,
    retriever,
  ]);

  // Kick off the explanation when the sheet becomes visible. Deferred to a
  // microtask so we don't trigger setState synchronously inside the effect
  // (which would cause cascading renders). Guarded with a ref so StrictMode's
  // double-invoke doesn't run the async work twice.
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
  }, [visible]);

  // Auto-scroll to the bottom as the answer streams in.
  useEffect(() => {
    if (!visible) return;
    if (phase !== 'streaming' && phase !== 'done') return;
    const text = finalText ?? answer;
    if (!text) return;
    // Defer to next frame so the new content has been laid out.
    const handle = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: phase === 'streaming' });
    }, 16);
    return () => clearTimeout(handle);
  }, [visible, phase, answer, finalText]);

  // Release the lease on close / unmount.
  const handleClose = useCallback(() => {
    cancelRef.current = true;
    abortRef.current?.abort();
    leaseRef.current?.release();
    const hadLease = leaseRef.current !== null;
    leaseRef.current = null;

    // If the sheet loaded the model explicitly and the queue isn't tracking it
    // (no lease), unload it on close in auto policy so we don't leave RAM
    // pinned. In manual/Developer policy, leave it loaded (developer manages).
    if (
      loadedBySheetRef.current &&
      !hadLease &&
      slmPolicy === 'auto' &&
      taskQueue.activeLeaseCount === 0
    ) {
      void slmUnloadModel();
    }
    loadedBySheetRef.current = false;

    onClose();
  }, [onClose, slmPolicy, slmUnloadModel, taskQueue]);

  // Reset the drag offset whenever the sheet opens/closes so a previous
  // partial drag doesn't linger.
  useEffect(() => {
    panY.setValue(0);
  }, [visible, panY]);

  /* eslint-disable react-hooks/refs -- PanResponder callbacks fire at event
     time, not during render; handleClose/panY are captured, not invoked. */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_evt, g) =>
          g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
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
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    return () => {
      cancelRef.current = true;
      abortRef.current?.abort();
      leaseRef.current?.release();
      leaseRef.current = null;
    };
  }, []);

  const statusLabel = deriveStatusLabel(
    phase,
    source,
    activeModelId,
    currentModelId,
    error,
  );
  const statusTone = deriveStatusTone(phase);
  const inProgress =
    phase === 'loading' || phase === 'thinking' || phase === 'streaming';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        {/* Tappable backdrop fills the space above the sheet (sheet is pinned
            to the bottom by the column's flex). Tapping the sheet itself never
            hits this, so the sheet stays open. */}
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <Animated.View style={[styles.sheet, { transform: [{ translateY: panY }] }]}>
          {/* Drag handle + header — swipe down here to dismiss. */}
          <View style={styles.dragArea} {...panResponder.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Pressable style={styles.closeButton} onPress={handleClose} hitSlop={12}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
          </View>

          {/* Persistent status line — always visible (pinned, outside the
              scroll) so the caregiver always sees the model state. */}
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

          {/* Scrollable body — bounded by a points-based maxHeight so it always
              scrolls reliably regardless of the sheet's content height. */}
          <ScrollView
            ref={scrollRef}
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {prompt.length > 0 ? (
              <View style={styles.promptBlock}>
                <Text style={styles.promptLabel}>You asked</Text>
                <Text style={styles.promptText}>{prompt}</Text>
              </View>
            ) : null}

            <Text style={styles.answerLabel}>Concierge response</Text>

            {phase === 'error' ? (
              <Text style={styles.errorText}>
                Couldn&apos;t generate an explanation: {error}
              </Text>
            ) : null}

            {(phase === 'loading' || phase === 'thinking') ? (
              <Text style={styles.thinkingText}>Thinking…</Text>
            ) : null}

            {/* Streaming: raw token stream in faded italic (like the Concierge tab). */}
            {phase === 'streaming' ? (
              <Text style={styles.streamingText}>{answer || '…'}</Text>
            ) : null}

            {/* Done: the cleaned answer rendered as Markdown (bold/headers). */}
            {phase === 'done' ? (
              finalText ? (
                <MarkdownRenderer size="large">{finalText}</MarkdownRenderer>
              ) : answer ? (
                <Text style={styles.answerText}>{answer}</Text>
              ) : (
                <Text style={styles.emptyText}>No response.</Text>
              )
            ) : null}
          </ScrollView>

          {phase === 'streaming' || phase === 'done' ? (
            <Text style={styles.footnote}>
              Concierge guidance — not a diagnosis. Confirm with the care team.
            </Text>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

function deriveStatusLabel(
  phase: Phase,
  source: Source | null,
  activeModelId: string | null,
  currentModelId: string | null,
  error: string | null,
): string {
  const modelId = activeModelId ?? currentModelId;
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
  dragArea: {
    paddingHorizontal: 20,
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
  promptBlock: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  promptLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  promptText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    lineHeight: 20,
  },
  answerLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: 'uppercase',
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
  answerText: {
    color: AppTheme.colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  emptyText: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
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
});
