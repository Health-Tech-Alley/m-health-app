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
 *     the model id or a "(mock)" tag.
 *   - As tokens stream, the raw token stream is shown live (like the SLM prompt
 *     demo screen). When generation completes, the streamed text is replaced by
 *     the rendered Markdown answer.
 *   - On close: the lease is released. In auto policy the task queue's
 *     auto-unload timer takes over; if the sheet loaded the model explicitly
 *     without a queue lease, it unloads it on close (auto policy only). The
 *     sheet itself never owns the model beyond this task.
 *
 * Renders with the caregiver system context (patient record) so answers are
 * personalized. Falls back to a streaming mock when the native SLM is
 * unavailable (Track A) so the UX is always demonstrable.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { MarkdownRenderer } from '@/components/markdown-renderer';
import { AppTheme } from '@/constants/theme';
import { usePatientRecord } from '@/contexts/patient-record-context';
import { useSettings } from '@/contexts/settings-context';
import { useSLM } from '@/contexts/slm-context';
import { MODEL_CATALOG } from '@/inference/model-catalog';
import type { SlmTaskReason, SlmTaskLease } from '@/services/slm/slm-task-queue';
import { isModelInstalled } from '@/services/model-storage';
import {
  buildCaregiverAssistantContextFromSnapshot,
  buildCaregiverSystemContext,
  askCaregiverAssistantMock,
} from '@/services/slm/slmService';
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
type Source = 'native' | 'mock';

const MOCK_STREAM_DELAY_MS = 25;

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
  const defaultModelId = settings.demoDefaultModelId ?? 'healthgpt-pro-4b';

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

  /**
   * Ensure a model is loaded and return a lease when possible.
   *
   * 1. Try `acquireSlm` — in auto policy this auto-loads the default model.
   * 2. If that throws (manual policy, or default model not installed), look for
   *    any installed model and load it explicitly, then acquire a lease so the
   *    queue still tracks auto-unload. A microtask flush lets the queue's config
   *    effect run before the second acquire.
   * 3. If no model can be loaded, returns a null lease — caller falls back to
   *    the streaming mock.
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

  const streamMock = useCallback(
    async (text: string): Promise<void> => {
      setPhase('thinking');
      const words = text.split(' ');
      let first = true;
      for (const word of words) {
        if (cancelRef.current) return;
        if (first) {
          first = false;
          setPhase('streaming');
        }
        setAnswer((prev) => (prev ? `${prev} ${word}` : word));
        await new Promise((r) => setTimeout(r, MOCK_STREAM_DELAY_MS));
      }
    },
    [],
  );

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
        const result = await provider.chat(
          [
            { role: 'system', content: systemContext },
            { role: 'user', content: prompt },
          ],
          (token) => {
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              setPhase('streaming');
            }
            setAnswer((prev) => prev + token);
          },
          controller.signal,
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

    // No native model available — fall back to a streaming mock so the UX
    // matches the SLM prompt demo screen (tokens stream, then the answer is
    // rendered as Markdown when done).
    setSource('mock');
    try {
      const mock = await askCaregiverAssistantMock(prompt, context);
      if (cancelRef.current) return;
      await streamMock(mock.answer);
      if (cancelRef.current) return;
      const cleaned = stripControlTokens(mock.answer).answer;
      setAnswer(cleaned);
      setFinalText(cleaned);
      setPhase('done');
    } catch (err) {
      if (cancelRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [
    ensureModelAndLease,
    provider,
    snapshot,
    prompt,
    currentModelId,
    streamMock,
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
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable style={styles.closeButton} onPress={handleClose} hitSlop={12}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          <View style={styles.handle} />

          {/* Persistent status line — always visible so the caregiver knows
              exactly what the assistant is doing right now. */}
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
          >
            {/* Echo the prompt so the caregiver sees what was asked. */}
            {prompt.length > 0 ? (
              <View style={styles.promptBlock}>
                <Text style={styles.promptLabel}>You asked</Text>
                <Text style={styles.promptText}>{prompt}</Text>
              </View>
            ) : null}

            <Text style={styles.answerLabel}>Assistant response</Text>

            {phase === 'error' ? (
              <Text style={styles.errorText}>
                Couldn&apos;t generate an explanation: {error}
              </Text>
            ) : null}

            {phase === 'thinking' ? (
              <Text style={styles.thinkingText}>Thinking…</Text>
            ) : null}

            {phase === 'streaming' ? (
              <Text style={styles.streamingText}>{answer || '…'}</Text>
            ) : null}

            {phase === 'done' ? (
              finalText ? (
                <MarkdownRenderer size="large">{finalText}</MarkdownRenderer>
              ) : answer ? (
                <Text style={styles.answerText}>{answer}</Text>
              ) : (
                <Text style={styles.emptyText}>No response yet.</Text>
              )
            ) : null}

            {phase !== 'error' &&
            phase !== 'done' &&
            phase !== 'streaming' &&
            phase !== 'thinking' ? (
              <Text style={styles.emptyText}>Waiting for the assistant…</Text>
            ) : null}
          </ScrollView>

          {phase === 'streaming' || phase === 'done' ? (
            <Text style={styles.footnote}>
              Assistant guidance — not a diagnosis. Confirm with the care team.
            </Text>
          ) : null}
        </Pressable>
      </Pressable>
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
  const mockSuffix = source === 'mock' ? ' (mock)' : '';
  const modelTag = modelId ? ` · ${modelId}` : '';
  switch (phase) {
    case 'idle':
      return 'Preparing…';
    case 'loading':
      return modelId ? `Loading model · ${modelId}…` : 'Loading assistant…';
    case 'thinking':
      return `Thinking${modelTag}${mockSuffix}…`;
    case 'streaming':
      return `Generating${modelTag}${mockSuffix}…`;
    case 'done':
      return `Complete${modelTag}${mockSuffix}`;
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
  sheet: {
    backgroundColor: AppTheme.colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '85%',
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
