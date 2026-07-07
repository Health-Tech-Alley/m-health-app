/**
 * SlmStatusIcon — small status dot for the SLM lifecycle.
 *
 * Colors (D1):
 *   - grey    — idle (unloaded, e.g. after 30s background or load error)
 *   - amber   — loading (startup load or re-load), pulses
 *   - green   — ready
 *   - red     — error
 *
 * Render in the tab header, in the Concierge screen header, and in any other
 * place that benefits from showing the model state at a glance.
 */
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSLM } from '@/contexts/slm-context';

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

export interface SlmStatusIconProps {
  /** When true, render the small status dot only (no label). */
  compact?: boolean;
  /** Optional tap handler — used to retry on 'error'. */
  onPress?: () => void;
  /** Optional override for the accessibility label. */
  accessibilityLabel?: string;
}

export function SlmStatusIcon({ compact = true, onPress, accessibilityLabel }: SlmStatusIconProps) {
  const { loadStatus, currentModelId, loadError, loadModel } = useSLM();
  const color = COLORS[loadStatus];
  const label = accessibilityLabel ?? LABELS[loadStatus];

  // Subtle pulse on 'loading' so the dot doesn't look like a static UI element.
  // Hold the AnimatedValue as state so the .interpolate() result is stable
  // for render (avoids the refs-during-render lint rule).
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (loadStatus !== 'loading') {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [loadStatus, pulse]);

  const opacity = loadStatus === 'loading' ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) : 1;

  const handlePress = onPress ?? (loadStatus === 'error' ? () => { void loadModel(currentModelId ?? 'gemma-4-e2b'); } : undefined);

  const dot = (
    <Animated.View
      style={[
        styles.dot,
        { backgroundColor: color, opacity },
      ]}
    />
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
        {dot}
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
      {dot}
      <Text style={styles.label} numberOfLines={1}>
        {label}
        {loadError ? `: ${loadError.slice(0, 60)}` : null}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compactWrap: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  label: {
    fontSize: 12,
    color: '#526866',
    fontWeight: '600',
  },
});
