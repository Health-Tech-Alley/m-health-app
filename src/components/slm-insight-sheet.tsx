/**
 * SlmInsightSheet — reusable transient-SLM bottom sheet.
 *
 * Used for on-demand SLM explanations that are NOT the main alert-explain flow
 * (safety-note explanations, custom-med checks, etc.).
 *
 * Lifecycle (controlled load/unload):
 *   - On open: acquires an SLM lease via the task queue (auto-loads the default
 *     model in Demo mode). While the model is loading or the answer hasn't
 *     started streaming, a "Thinking…" indicator is shown.
 *   - As tokens stream, the answer is rendered; once streaming begins the
 *     answer occupies the space the thinking indicator used.
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

export function SlmInsightSheet({
  visible,
  onClose,
  title,
  prompt,
  reason = 'safety_note_explain',
}: SlmInsightSheetProps) {
  const slm = useSLM();
  const { snapshot } = usePatientRecord();
  const [phase, setPhase] = useState<Phase>('idle');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const leaseRef = useRef<SlmTaskLease | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runExplain = useCallback(async () => {
    setPhase('loading');
    setAnswer('');
    setError(null);

    // Acquire an SLM lease (auto-loads the default model in Demo mode).
    try {
      leaseRef.current = await slm.acquireSlm(reason);
    } catch (err) {
      // SLM not ready (manual policy) or load failed — fall back to mock so the
      // UX is still demonstrable on Track A.
      console.warn('[SlmInsightSheet] SLM lease failed, using mock:', err);
      leaseRef.current = null;
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

      // Prefer the native provider when ready.
      if (slm.loadStatus === 'ready') {
        const result = await slm.provider.chat(
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
        // Provider not ready (Track A / not auto-loaded) — mock.
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
  }, [slm, snapshot, prompt, reason]);

  // Kick off the explanation when the sheet becomes visible. Deferred to a
  // microtask so we don't trigger setState synchronously inside the effect
  // (which would cause cascading renders).
  useEffect(() => {
    if (!visible) return;
    const handle = setTimeout(() => { void runExplain(); }, 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

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

  const showingThinking = phase === 'loading' || phase === 'thinking';

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

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {showingThinking ? (
              <View style={styles.thinkingRow}>
                <ActivityIndicator color={AppTheme.colors.brand} size="small" />
                <Text style={styles.thinkingText}>
                  {phase === 'loading' ? 'Loading assistant…' : 'Thinking…'}
                </Text>
              </View>
            ) : null}

            {phase === 'error' ? (
              <Text style={styles.errorText}>
                Couldn&apos;t generate an explanation: {error}
              </Text>
            ) : null}

            {answer.length > 0 ? (
              <MarkdownRenderer size="large">{stripControlTokens(answer).answer}</MarkdownRenderer>
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
  body: {
    paddingHorizontal: 20,
  },
  bodyContent: {
    paddingBottom: 12,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  thinkingText: {
    color: AppTheme.colors.brand,
    fontSize: 14,
    fontWeight: '900',
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
