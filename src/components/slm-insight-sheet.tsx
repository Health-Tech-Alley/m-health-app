/**
 * SlmInsightSheet — reusable transient-SLM bottom sheet.
 *
 * Used for on-demand SLM explanations that are NOT the main alert-explain flow
 * (safety-note explanations, custom-med checks, etc.).
 *
 * Lifecycle (controlled load/unload):
 *   - On open: acquires an SLM lease via the task queue (auto-loads the default
 *     model in Demo mode). A persistent status line shows the current phase
 *     (loading model / thinking / generating / done / error) plus the model id.
 *   - As tokens stream, the answer is rendered below the echoed prompt and the
 *     view auto-scrolls to keep the latest output visible.
 *   - On close: the lease is released. In Demo (auto) policy the task queue's
 *     auto-unload timer takes over, unloading the model after idle. The sheet
 *     itself never owns the model.
 *
 * Renders with the caregiver system context (patient record) so answers are
 * personalized. Falls back to the mock assistant when the native SLM is
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
import { useSLM } from '@/contexts/slm-context';
import type { SlmTaskReason, SlmTaskLease } from '@/services/slm/slm-task-queue';
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
  const { acquireSlm, provider } = slm;
  const { snapshot } = usePatientRecord();
  const [phase, setPhase] = useState<Phase>('idle');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const leaseRef = useRef<SlmTaskLease | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const ranRef = useRef(false);

  const runExplain = useCallback(async () => {
    setPhase('loading');
    setAnswer('');
    setError(null);
    setSource(null);
    setActiveModelId(slm.currentModelId);

    // Acquire an SLM lease (auto-loads the default model in Demo mode).
    try {
      leaseRef.current = await acquireSlm(reason);
      setActiveModelId(slm.currentModelId);
    } catch (err) {
      // SLM not ready (manual policy) or load failed — fall back to mock so the
      // UX is still demonstrable on Track A.
      console.warn('[SlmInsightSheet] SLM lease failed, using mock:', err);
      leaseRef.current = null;
      setSource('mock');
      const mock = await askCaregiverAssistantMock(prompt, {});
      setAnswer(mock.answer);
      setPhase('done');
      return;
    }

    setPhase('thinking');

    const controller = new AbortController();
    abortRef.current = controller;
    let firstTokenSeen = false;

    try {
      const context = snapshot
        ? buildCaregiverAssistantContextFromSnapshot(snapshot)
        : {};
      const systemContext = buildCaregiverSystemContext(context);

      // Prefer the native provider when a model is actually loaded. We check
      // the provider directly (getModelInfo()) rather than slm.loadStatus:
      // after `await acquireSlm` the continuation runs as a microtask, before
      // React re-renders, so slm.loadStatus may still read 'loading' even
      // though the model just loaded successfully. A granted lease implies the
      // provider is loaded.
      if (provider.getModelInfo()) {
        setSource('native');
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
        if (!firstTokenSeen) {
          setAnswer(stripControlTokens(result.text).answer);
        }
        setPhase('done');
      } else {
        // Lease granted but provider reports no loaded model (unexpected) —
        // fall back to mock so the UX is still demonstrable.
        setSource('mock');
        const mock = await askCaregiverAssistantMock(prompt, context);
        // Simulate streaming for visual continuity.
        for (const word of mock.answer.split(' ')) {
          if (!firstTokenSeen) {
            firstTokenSeen = true;
            setPhase('streaming');
          }
          setAnswer((prev) => (prev ? `${prev} ${word}` : word));
          await new Promise((r) => setTimeout(r, 20));
        }
        setPhase('done');
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setPhase('done');
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  }, [acquireSlm, provider, snapshot, prompt, reason, slm.currentModelId]);

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
    const handle = setTimeout(() => { void runExplain(); }, 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Auto-scroll to the bottom as the answer streams in.
  useEffect(() => {
    if (!visible) return;
    if (phase !== 'streaming' && phase !== 'done') return;
    if (!answer) return;
    // Defer to next frame so the new content has been laid out.
    const handle = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: phase === 'streaming' });
    }, 16);
    return () => clearTimeout(handle);
  }, [visible, phase, answer]);

  // Release the lease on close / unmount.
  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    leaseRef.current?.release();
    leaseRef.current = null;
    onClose();
  }, [onClose]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      leaseRef.current?.release();
      leaseRef.current = null;
    };
  }, []);

  const statusLabel = deriveStatusLabel(phase, source, activeModelId, slm.currentModelId, error);
  const statusTone = deriveStatusTone(phase);
  const inProgress = phase === 'loading' || phase === 'thinking' || phase === 'streaming';

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

            {answer.length > 0 ? (
              <MarkdownRenderer size="large">{stripControlTokens(answer).answer}</MarkdownRenderer>
            ) : !inProgress && phase !== 'error' ? (
              <Text style={styles.emptyText}>No response yet.</Text>
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
  const modelTag = modelId ? ` · ${modelId}` : source === 'mock' ? ' · mock' : '';
  switch (phase) {
    case 'idle':
      return 'Preparing…';
    case 'loading':
      return modelId ? `Loading model${modelTag}…` : 'Loading assistant…';
    case 'thinking':
      return `Thinking${modelTag}…`;
    case 'streaming':
      return `Generating${modelTag}…`;
    case 'done':
      return `Complete${modelTag}${source === 'mock' ? ' (mock)' : ''}`;
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
