/**
 * SlmStatusIcon — small status dot for the SLM lifecycle.
 *
 * Colors (D1):
 *   - grey    — idle (unloaded, e.g. after background or load error)
 *   - amber   — loading (startup load or re-load), pulses
 *   - green   — ready
 *   - red     — error
 *
 * When Concierge chat is in its post-blur unload grace (doc 34 chat grace),
 * a ring around the dot depletes from full circle → empty over the countdown.
 */
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSLM, type ChatUnloadGrace } from '@/contexts/slm-context';

const COLORS = {
  ready: '#22C55E',
  loading: '#F59E0B',
  error: '#EF4444',
  idle: '#9CA3AF',
} as const;

const LABELS = {
  ready: 'Concierge ready',
  loading: 'Concierge loading',
  error: 'Concierge error — tap to retry',
  idle: 'Concierge idle',
} as const;

const RING_SIZE = 22;
const DOT_SIZE = 10;
const RING_BORDER = 2.5;
/** Number of arc segments for the depleting ring (pure RN, no SVG). */
const RING_SEGMENTS = 28;

export interface SlmStatusIconProps {
  /** When true, render the small status dot only (no label). */
  compact?: boolean;
  /** Optional tap handler — used to retry on 'error'. */
  onPress?: () => void;
  /** Optional override for the accessibility label. */
  accessibilityLabel?: string;
}

type GraceUi = { progress: number; secondsLeft: number };

function useGraceUi(grace: ChatUnloadGrace | null): GraceUi {
  // progress is driven only by rAF callbacks (external subscription), never
  // by a synchronous setState in the effect body.
  const [ui, setUi] = useState<GraceUi>({ progress: 0, secondsLeft: 0 });
  const graceKey = grace ? `${grace.endsAt}:${grace.durationMs}` : '';

  useEffect(() => {
    if (!graceKey || !grace) {
      // Clear via microtask so the effect body itself stays pure.
      const t = setTimeout(() => setUi({ progress: 0, secondsLeft: 0 }), 0);
      return () => clearTimeout(t);
    }

    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const remaining = grace.endsAt - Date.now();
      const progress = Math.max(0, Math.min(1, remaining / grace.durationMs));
      const secondsLeft = progress > 0 ? Math.max(1, Math.ceil(remaining / 1000)) : 0;
      setUi({ progress, secondsLeft });
      if (progress > 0) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [graceKey, grace]);

  return ui;
}

export function SlmStatusIcon({ compact = true, onPress, accessibilityLabel }: SlmStatusIconProps) {
  const {
    loadStatus,
    currentModelId,
    loadError,
    loadModel,
    chatUnloadGrace,
  } = useSLM();
  const color = COLORS[loadStatus];
  const { progress: graceProgress, secondsLeft: graceSecondsLeft } = useGraceUi(chatUnloadGrace);
  const graceActive = graceProgress > 0;

  const label =
    accessibilityLabel ??
    (graceActive
      ? 'Concierge staying loaded briefly after leaving chat'
      : LABELS[loadStatus]);

  // Subtle pulse on 'loading' so the dot doesn't look like a static UI element.
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (loadStatus !== 'loading') {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [loadStatus, pulse]);

  const opacity =
    loadStatus === 'loading'
      ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] })
      : 1;

  const visibleSegments = useMemo(
    () => Math.max(0, Math.ceil(graceProgress * RING_SEGMENTS)),
    [graceProgress],
  );

  const handlePress =
    onPress ??
    (loadStatus === 'error'
      ? () => {
          void loadModel(currentModelId ?? 'gemma-4-e2b');
        }
      : undefined);

  const ringSegments =
    graceActive
      ? Array.from({ length: RING_SEGMENTS }, (_, i) => {
          const show = i < visibleSegments;
          if (!show) return null;
          const angle = (i / RING_SEGMENTS) * 360 - 90;
          return (
            <View
              key={i}
              style={[
                styles.ringSegment,
                {
                  backgroundColor: COLORS.ready,
                  opacity: 0.35 + 0.65 * graceProgress,
                  transform: [
                    { rotate: `${angle}deg` },
                    { translateY: -(RING_SIZE / 2 - RING_BORDER) },
                  ],
                },
              ]}
            />
          );
        })
      : null;

  const core = (
    <View style={styles.ringWrap}>
      {ringSegments}
      <Animated.View
        style={[
          styles.dot,
          { backgroundColor: color, opacity },
        ]}
      />
    </View>
  );

  if (compact) {
    return (
      <Pressable
        accessibilityRole={handlePress ? 'button' : 'image'}
        accessibilityLabel={label}
        onPress={handlePress}
        style={styles.compactWrap}
        hitSlop={6}
      >
        {core}
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole={handlePress ? 'button' : 'image'}
      accessibilityLabel={label}
      onPress={handlePress}
      style={styles.fullWrap}
    >
      {core}
      <Text style={styles.label} numberOfLines={1}>
        {graceActive
          ? `Concierge cool-down ${graceSecondsLeft}s`
          : label}
        {!graceActive && loadError ? `: ${loadError.slice(0, 60)}` : null}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compactWrap: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: RING_SIZE + 4,
    minHeight: RING_SIZE + 4,
  },
  fullWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringSegment: {
    position: 'absolute',
    width: RING_BORDER,
    height: RING_BORDER + 1,
    borderRadius: RING_BORDER,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  label: {
    fontSize: 12,
    color: '#526866',
    fontWeight: '600',
  },
});
