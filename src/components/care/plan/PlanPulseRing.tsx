/**
 * PlanPulseRing — the care plan's living indicator (Care tab hero rework).
 *
 * A ring of arc ticks swept to the Plan Pulse score (0–100) with the score
 * number in the center. Color encodes attention: teal calm, amber review,
 * red urgent. A slow breathing pulse runs only when attention is not calm —
 * motion with meaning, and visually distinct from the SLM's filled status
 * dot (a ring, not a dot).
 *
 * Pure RN Animated (same segment geometry as SlmStatusIcon — no SVG dep).
 * Entrance sweep plays once when `playEntrance` is set; reduced-motion
 * renders the final state immediately.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';


import { AppTheme } from '@/constants/theme';
import type { PlanPulseAttention } from '@/services/carePlan/planPulseService';

const SEGMENTS = 36;
const RING_SIZE = 72;
const TICK_WIDTH = 3.5;
const TICK_HEIGHT = 9;
const SWEEP_MS = 650;
const SWEEP_DELAY_MS = 200;

const ATTENTION_COLORS: Record<PlanPulseAttention, string> = {
  calm: AppTheme.colors.brand,
  review: AppTheme.colors.attentionAmber,
  urgent: AppTheme.colors.danger,
};

const ATTENTION_LABELS: Record<PlanPulseAttention, string> = {
  calm: 'all caught up',
  review: 'needs your review',
  urgent: 'urgent context active',
};

export interface PlanPulseRingProps {
  /** 0–100. */
  score: number;
  attention: PlanPulseAttention;
  /** Play the 0→score entrance sweep once on mount. */
  playEntrance?: boolean;
  /** Skip sweep + pulse (accessibility reduced motion). */
  reduceMotion?: boolean;
}

export function PlanPulseRing({
  score,
  attention,
  playEntrance = false,
  reduceMotion = false,
}: PlanPulseRingProps) {
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const color = ATTENTION_COLORS[attention];

  // State-created Animated.Values (render-safe; refs trip react-hooks/refs).
  const playSweep = playEntrance && !reduceMotion;
  const [sweep] = useState(() => new Animated.Value(playSweep ? 0 : clampedScore));
  const [displayScore, setDisplayScore] = useState(playSweep ? 0 : clampedScore);
  const entranceDoneRef = useRef(!playSweep);

  // Display value follows the animated sweep via listener (subscription —
  // setState happens in the callback, not the effect body).
  useEffect(() => {
    const listenerId = sweep.addListener(({ value }) => {
      setDisplayScore(Math.round(value));
    });
    return () => sweep.removeListener(listenerId);
  }, [sweep]);

  // Entrance sweep (mount-only).
  useEffect(() => {
    if (!playSweep) return;
    const timer = setTimeout(() => {
      Animated.timing(sweep, {
        toValue: clampedScore,
        duration: SWEEP_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(() => {
        entranceDoneRef.current = true;
      });
    }, SWEEP_DELAY_MS);
    return () => clearTimeout(timer);
    // Mount-only by design; later score changes snap via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Post-entrance score changes snap to the new value (listener updates
  // the displayed number).
  useEffect(() => {
    if (!entranceDoneRef.current) return;
    sweep.setValue(clampedScore);
  }, [clampedScore, sweep]);

  // Attention breathing pulse — review slow, urgent faster, calm still.
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduceMotion || attention === 'calm') {
      pulse.setValue(1);
      return;
    }
    const half = attention === 'urgent' ? 450 : 1400;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: half,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: half,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(1);
    };
  }, [attention, reduceMotion, pulse]);

  const litSegments = Math.round((displayScore / 100) * SEGMENTS);
  const ticks = useMemo(
    () =>
      Array.from({ length: SEGMENTS }, (_, i) => {
        const angle = (i / SEGMENTS) * 360 - 90;
        const lit = i < litSegments;
        return (
          <View
            key={i}
            style={[
              styles.tick,
              {
                backgroundColor: lit ? color : AppTheme.colors.heroAccentSoft,
                opacity: lit ? 1 : 0.45,
                transform: [
                  { rotate: `${angle}deg` },
                  { translateY: -(RING_SIZE / 2 - TICK_HEIGHT / 2) },
                ],
              },
            ]}
          />
        );
      }),
    [litSegments, color],
  );

  return (
    <Animated.View
      style={[styles.wrap, { opacity: pulse }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Plan pulse ${clampedScore} out of 100, ${ATTENTION_LABELS[attention]}`}
    >
      <View style={styles.ringWrap}>
        {ticks}
        <Text style={[styles.scoreText, { color }]}>{displayScore}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: RING_SIZE,
    height: RING_SIZE,
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    position: 'absolute',
    width: TICK_WIDTH,
    height: TICK_HEIGHT,
    borderRadius: TICK_WIDTH,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '900',
  },
});
