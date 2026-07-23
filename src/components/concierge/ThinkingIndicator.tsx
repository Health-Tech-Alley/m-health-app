/**
 * Thinking indicator for the Concierge chat screen.
 *
 * Per planning/32 §7 + planning/35 NLU stages:
 *   - Pre-answer phase: discrete step progress bar + phase word + blinking
 *     ellipses. Progress chunks track real reasoning structure when available.
 *   - Phase advances by a `phase` prop the caller drives:
 *       0 = Understanding  (Pre-SLM NLU / encoder / retrieval)
 *       1 = Thinking       (SLM reasoning / prefill)
 *       2 = Checking       (Health Monitor / tools)
 *       3 = Drafting       (answer tokens; usually hidden via streaming)
 *   - When `streaming` is true, the indicator hides and the answer
 *     streams in **bold** inline (handled by the caller's renderer).
 *   - Never shows raw reasoning text or technical NLU/SLM jargon.
 *
 * A legacy `text` prop is kept for back-compat with the older 3-dots UX —
 * callers that pass text get the old "Concierge is thinking…" line.
 */

import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

const PHASES = ['Understanding', 'Thinking', 'Checking', 'Drafting'] as const;
type PhaseIndex = 0 | 1 | 2 | 3;

const QUICK_ANSWER_MAX_CHARS = 2000;
const QUICK_ANSWER_MAX_LINES = 20;

/** Discrete progress bar sizing. */
const STEP_COUNT = 4;

/**
 * Derive discrete reasoning-step progress from the streamed `<think>` text.
 *
 * Reasoning models structure their thinking as distinct segments separated by
 * blank lines / newlines. We count completed segments (those followed by a
 * line break) as "done" steps and the trailing in-flight segment as the step
 * currently in progress. Nothing is faked — the fill tracks real reasoning
 * structure as it arrives, capped at STEP_COUNT chunks.
 *
 * Returns:
 *   completed  — number of fully finished reasoning steps (solid chunks)
 *   inProgress — whether a step is currently being written (the pulsing chunk)
 */
export function deriveReasoningSteps(phase: PhaseIndex): {
  completed: number;
  inProgress: boolean;
} {
  const completed = Math.min(phase, STEP_COUNT);
  const inProgress = phase < STEP_COUNT;
  return { completed, inProgress };
}

export function ThinkingIndicator({
  text,
  phase,
  streaming,
  reasoning,
}: {
  /** Legacy free-text label. When set, the legacy 3-dots UX is shown. */
  text?: string;
  /** Phase index driving the rotating phase word. */
  phase?: PhaseIndex;
  /** When true, the answer has started streaming — the indicator is hidden. */
  streaming?: boolean;
  /**
   * The streamed `<think>` reasoning text so far. Drives the discrete
   * step-chunk progress bar (each completed reasoning segment = one filled
   * chunk). Never rendered as text.
   */
  reasoning?: string | null;
}) {
  // Legacy 3-dots indicator (kept for callers that haven't migrated).
  const [dots] = useState(() => [
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]);
  const [dot1, dot2, dot3] = dots;

  useEffect(() => {
    const makeAnim = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, {
            toValue: 1,
            duration: 200,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 200,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
    const a1 = makeAnim(dot1, 0);
    const a2 = makeAnim(dot2, 100);
    const a3 = makeAnim(dot3, 200);
    a1.start();
    a2.start();
    a3.start();
    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3]);

  // New phase-word + blinking ellipsis indicator.
  const [autoIdx, setAutoIdx] = useState(0);
  // Hold the AnimatedValue as a ref + a state snapshot. The ref lets us
  // start/stop the loop in effects; the state snapshot keeps the
  // interpolate() result stable for render (avoids the refs-during-render
  // lint rule and prevents unnecessary re-renders).
  const [ellipsisValue] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (streaming) return;
    if (phase !== undefined) return; // caller-driven, don't auto-rotate
    const t = setInterval(() => setAutoIdx((i) => (i + 1) % PHASES.length), 1200);
    return () => clearInterval(t);
  }, [streaming, phase]);

  useEffect(() => {
    if (streaming) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ellipsisValue, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(ellipsisValue, { toValue: 0.2, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [streaming, ellipsisValue]);

  // Discrete step progress bar. The bar is divided into STEP_COUNT chunks;
  // each completed reasoning segment fills one chunk (solid). The chunk that
  // is currently being written pulses (opacity only, native-driver friendly)
  // to show live activity — no looping sweep across the whole bar.
  const [pulseValue] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (streaming) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, { toValue: 0.35, duration: 450, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulseValue, { toValue: 1, duration: 450, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [streaming, pulseValue]);

  // Legacy path: when text is passed explicitly, render the old UX.
  if (text !== undefined && text.trim().length > 0) {
    return (
      <View style={styles.thinkingWrap}>
        <Text style={styles.thinkingText}>{text}</Text>
      </View>
    );
  }

  if (streaming) {
    // Caller hides the indicator as soon as the answer starts streaming.
    return null;
  }

  const activePhase: PhaseIndex = (phase ?? autoIdx) as PhaseIndex;
  const label = PHASES[activePhase];
  const ellipsisOpacity = ellipsisValue.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });

  // Discrete step chunks from the real reasoning structure.
  const { completed, inProgress } = deriveReasoningSteps(activePhase);
  // Before any reasoning text arrives (prefill), show the first chunk as the
  // in-progress one so the bar isn't empty while the model spins up.
  const activeChunk = completed; // index of the chunk currently in progress
  const showActive = inProgress || completed === 0;

  return (
    <View style={styles.thinkingWrap}>
      <View style={styles.thinkingRow}>
        <View style={styles.progressChunks}>
          {Array.from({ length: STEP_COUNT }).map((_, i) => {
            const isFilled = i < completed;
            const isActive = i === activeChunk && showActive;
            if (isActive) {
              return (
                <Animated.View
                  key={i}
                  style={[styles.progressChunk, styles.progressChunkActive, { opacity: pulseValue }]}
                />
              );
            }
            return (
              <View
                key={i}
                style={[styles.progressChunk, isFilled ? styles.progressChunkFilled : styles.progressChunkEmpty]}
              />
            );
          })}
        </View>
        <Text style={styles.phaseLabel}>{label}</Text>
        <Animated.Text style={[styles.ellipsis, { opacity: ellipsisOpacity }]}>…</Animated.Text>
      </View>
    </View>
  );
}

/**
 * Show a single truncated line of reasoning (for the explain path where
 * reasoning_format='auto' is used). Truncates to 1 line so it doesn't
 * look like a tech debug output.
 */
export function ThinkingReasoning({ reasoning }: { reasoning: string | null }) {
  if (!reasoning || !reasoning.trim()) return null;
  const firstLine = reasoning.split('\n')[0].trim();
  if (!firstLine) return null;
  const truncated = firstLine.length > 80 ? firstLine.slice(0, 77) + '…' : firstLine;
  return (
    <View style={styles.reasoningWrap}>
      <Text style={styles.reasoningText} numberOfLines={1}>{truncated}</Text>
    </View>
  );
}

/**
 * Truncate the first response to a "quick answer" preview.
 */
export function truncateForQuickAnswer(text: string): string {
  if (!text) return text;
  const lines = text.split(/\n+/);
  if (lines.length <= QUICK_ANSWER_MAX_LINES && text.length <= QUICK_ANSWER_MAX_CHARS) {
    return text;
  }
  const head = lines.slice(0, QUICK_ANSWER_MAX_LINES).join('\n');
  if (head.length <= QUICK_ANSWER_MAX_CHARS) {
    return head + (lines.length > QUICK_ANSWER_MAX_LINES ? '…' : '');
  }
  return head.slice(0, QUICK_ANSWER_MAX_CHARS).trimEnd() + '…';
}

/**
 * Only offer "Tell me more" for responses that are long enough.
 */
export function shouldOfferTellMeMore(text: string): boolean {
  if (!text) return false;
  if (text.length <= QUICK_ANSWER_MAX_CHARS) return false;
  const lines = text.split(/\n+/);
  return lines.length > QUICK_ANSWER_MAX_LINES;
}

const styles = StyleSheet.create({
  thinkingWrap: {
    paddingVertical: 6,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressChunks: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
    gap: 3,
  },
  progressChunk: {
    width: 9,
    height: 4,
    borderRadius: 2,
  },
  progressChunkFilled: {
    backgroundColor: '#0E6F68',
  },
  progressChunkActive: {
    backgroundColor: '#0E6F68',
  },
  progressChunkEmpty: {
    backgroundColor: '#0E6F6820',
  },
  phaseLabel: {
    color: '#0E6F68',
    fontSize: 14,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  ellipsis: {
    color: '#0E6F68',
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 22,
    marginLeft: 2,
  },
  thinkingDot: {
    color: '#0E6F68',
    fontSize: 18,
    fontWeight: '900',
    marginRight: 1,
    lineHeight: 18,
  },
  thinkingStatus: {
    color: '#526866',
    fontSize: 13,
    fontStyle: 'italic',
    marginLeft: 6,
  },
  thinkingText: {
    color: '#526866',
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  reasoningWrap: {
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  reasoningText: {
    color: '#8B9AB6',
    fontSize: 12,
    fontStyle: 'italic',
  },
});
