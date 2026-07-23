/**
 * PlanPulseRing — visual size of how populated the care plan (ADCP) is.
 *
 * Arc ticks sweep to the population fill (0–100). No center number — a score
 * read as something to "improve." Color matches the hero title indigo so it
 * reads as plan identity, not a completion metric. A soft indigo breath keeps
 * the ring feeling alive without looking like a progress score.
 *
 * Pure RN Animated (same segment geometry as SlmStatusIcon — no SVG dep).
 * Entrance sweep plays once when `playEntrance` is set; reduced-motion
 * renders the final state immediately.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import type { PlanPulseAttention } from '@/services/carePlan/planPulseService';

const SEGMENTS = 36;
const RING_SIZE = 72;
const TICK_WIDTH = 3.5;
const TICK_HEIGHT = 9;
const SWEEP_MS = 650;
const SWEEP_DELAY_MS = 200;
const BREATH_HALF_MS = 1600;

/** Same indigo as "Mike's Care Plan" hero title. */
const ARC_COLOR = AppTheme.colors.heroAccent;
const ARC_TRACK = AppTheme.colors.heroAccentSoft;

const FILL_LABELS: { max: number; label: string }[] = [
  { max: 15, label: 'lightly filled' },
  { max: 40, label: 'partly filled' },
  { max: 70, label: 'well filled' },
  { max: 100, label: 'richly filled' },
];

function fillLabel(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  for (const row of FILL_LABELS) {
    if (s <= row.max) return row.label;
  }
  return 'richly filled';
}

export interface PlanPulseRingProps {
  /** 0–100 population fill (how much plan content is present). */
  score: number;
  /** Kept for API compat; does not recolor the arc (avoids "score" cues). */
  attention: PlanPulseAttention;
  /** Play the 0→fill entrance sweep once on mount. */
  playEntrance?: boolean;
  /** Skip sweep + pulse (accessibility reduced motion). */
  reduceMotion?: boolean;
}

export function PlanPulseRing({
  score,
  attention: _attention,
  playEntrance = false,
  reduceMotion = false,
}: PlanPulseRingProps) {
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));

  const playSweep = playEntrance && !reduceMotion;
  const [sweep] = useState(() => new Animated.Value(playSweep ? 0 : clampedScore));
  const [displayFill, setDisplayFill] = useState(playSweep ? 0 : clampedScore);
  const entranceDoneRef = useRef(!playSweep);

  // Soft living glow (opacity breath) — indigo only, always on unless reduced motion.
  const [glow] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const listenerId = sweep.addListener(({ value }) => {
      setDisplayFill(Math.round(value));
    });
    return () => sweep.removeListener(listenerId);
  }, [sweep]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!entranceDoneRef.current) return;
    sweep.setValue(clampedScore);
  }, [clampedScore, sweep]);

  useEffect(() => {
    if (reduceMotion) {
      glow.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 0.62,
          duration: BREATH_HALF_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 1,
          duration: BREATH_HALF_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      glow.setValue(1);
    };
  }, [reduceMotion, glow]);

  const litSegments = Math.round((displayFill / 100) * SEGMENTS);
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
                backgroundColor: lit ? ARC_COLOR : ARC_TRACK,
                opacity: lit ? 1 : 0.55,
                transform: [
                  { rotate: `${angle}deg` },
                  { translateY: -(RING_SIZE / 2 - TICK_HEIGHT / 2) },
                ],
              },
            ]}
          />
        );
      }),
    [litSegments],
  );

  return (
    <Animated.View
      style={[styles.wrap, { opacity: glow }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Care plan ${fillLabel(clampedScore)}`}
    >
      <View style={styles.ringWrap}>{ticks}</View>
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
});
