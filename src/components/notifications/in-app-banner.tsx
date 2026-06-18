/**
 * In-app notification banner.
 *
 * Subscribes to `onInAppBanner` from the notification fallback emitter and
 * shows a dismissible banner that slides in from the top of the screen.
 * Used when native `expo-notifications` is unavailable (Track A) and as a
 * supplementary surface for immediate-dispatch notifications.
 *
 * Theme-aware (brand teal #0E6F68 for normal, red for severity-3 critical).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { onInAppBanner, type InAppBannerPayload } from '@/services/notifications';

const BRAND_TEAL = '#0E6F68';
const CRITICAL_RED = '#B3261E';
const AUTO_DISMISS_MS = 8000;

interface VisibleBanner extends InAppBannerPayload {
  key: number;
}

export function InAppBanner() {
  const [banner, setBanner] = useState<VisibleBanner | null>(null);
  const slideY = useMemo(() => new Animated.Value(-400), []);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef(0);

  const animateOut = (onDone?: () => void) => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    Animated.timing(slideY, {
      toValue: -400,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      onDone?.();
    });
  };

  const show = (payload: InAppBannerPayload) => {
    keyRef.current += 1;
    setBanner({ ...payload, key: keyRef.current });
  };

  const dismiss = () => {
    animateOut(() => setBanner(null));
  };

  useEffect(() => {
    const unsubscribe = onInAppBanner(show);
    return unsubscribe;
  }, []);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!banner) return;
    slideY.setValue(-400);
    Animated.timing(slideY, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();

    if (banner.severity !== 3) {
      hideTimer.current = setTimeout(() => {
        dismiss();
      }, AUTO_DISMISS_MS);
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [banner?.key]);
  /* eslint-enable react-hooks/exhaustive-deps */

  if (!banner) return null;

  const isCritical = banner.severity === 3;
  const accent = isCritical ? CRITICAL_RED : BRAND_TEAL;

  return (
    <SafeAreaView edges={['top']} style={styles.wrapper} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.banner,
          { backgroundColor: accent, transform: [{ translateY: slideY }] },
        ]}>
        <View style={styles.content}>
          <Text style={styles.title} numberOfLines={1}>
            {isCritical ? '⚠️ ' : ''}
            {banner.title}
          </Text>
          <Text style={styles.body} numberOfLines={3}>
            {banner.body}
          </Text>
        </View>
        <Pressable
          hitSlop={12}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification">
          <Text style={styles.closeBtn}>✕</Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  banner: {
    marginHorizontal: Spacing.two,
    marginTop: Spacing.two,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  content: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  body: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  closeBtn: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: Spacing.one,
  },
});
