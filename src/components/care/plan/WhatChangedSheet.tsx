/**
 * Recent plan-changes bottom sheet (Care hero).
 *
 * Backdrop fades independently of the sheet slide (same pattern as SlmInsightSheet).
 * Swipe down on the handle/header to dismiss.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppTheme } from '@/constants/theme';
import type { CarePlanHistoryItem } from '@/services/carePlan/carePlanViewModel';

export interface WhatChangedSheetProps {
  visible: boolean;
  items: CarePlanHistoryItem[];
  onClose: () => void;
}

const WINDOW_H = Dimensions.get('window').height;
const SHEET_APPROX = Math.min(WINDOW_H * 0.7, 520);
const OPEN_MS = 280;
const CLOSE_MS = 220;
const DRAG_THRESHOLD = 80;

export function WhatChangedSheet({ visible, items, onClose }: WhatChangedSheetProps) {
  const [mounted, setMounted] = useState(false);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const visibleRef = useRef(visible);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  const [backdropOpacity] = useState(() => new Animated.Value(0));
  const [sheetTranslateY] = useState(() => new Animated.Value(SHEET_APPROX));
  const [dragY] = useState(() => new Animated.Value(0));

  const animateOpen = useCallback(() => {
    closingRef.current = false;
    sheetTranslateY.setValue(SHEET_APPROX);
    backdropOpacity.setValue(0);
    dragY.setValue(0);
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(sheetTranslateY, {
        toValue: 0,
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, sheetTranslateY, dragY]);

  const animateClose = useCallback(
    (then?: () => void) => {
      if (closingRef.current) return;
      closingRef.current = true;
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: CLOSE_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(sheetTranslateY, {
          toValue: SHEET_APPROX,
          duration: CLOSE_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished) {
          closingRef.current = false;
          return;
        }
        setTimeout(() => {
          setMounted(false);
          closingRef.current = false;
          then?.();
        }, 0);
      });
    },
    [backdropOpacity, sheetTranslateY],
  );

  const requestClose = useCallback(() => {
    animateClose(() => onCloseRef.current());
  }, [animateClose]);

  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => {
        setMounted(true);
        setTimeout(() => animateOpen(), 16);
      }, 0);
      return () => clearTimeout(t);
    }
    if (mounted && !visible) {
      // Parent flipped visible off — animate out without calling onClose again.
      animateClose();
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /* eslint-disable react-hooks/refs -- PanResponder fires at event time */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) =>
          g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => {
          if (g.dy > 0) dragY.setValue(g.dy);
        },
        onPanResponderRelease: (_e, g) => {
          if (g.dy > DRAG_THRESHOLD || g.vy > 1.1) {
            requestClose();
          } else {
            Animated.spring(dragY, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 0,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        },
      }),
    [dragY, requestClose],
  );
  /* eslint-enable react-hooks/refs */

  if (!mounted) return null;

  const title =
    items.length === 1 ? '1 recent change' : `${items.length} recent changes`;

  return (
    <Modal visible transparent animationType="none" onRequestClose={requestClose}>
      <View style={styles.overlay} pointerEvents="box-none">
        <Animated.View
          style={[styles.backdropFill, { opacity: backdropOpacity }]}
          pointerEvents="none"
        />
        <Pressable style={styles.backdropHit} onPress={requestClose} />
        <Animated.View
          style={[
            styles.sheet,
            {
              transform: [{ translateY: Animated.add(sheetTranslateY, dragY) }],
            },
          ]}
        >
          <View {...panResponder.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Pressable
                style={styles.closeButton}
                onPress={requestClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.subtitle}>
            Plan decisions you confirmed or updated. Your living care plan sits on top of the
            health record — the full audit log is in Settings.
          </Text>
          <ScrollView
            style={styles.body}
            showsVerticalScrollIndicator
            bounces
            keyboardShouldPersistTaps="handled"
          >
            {items.length === 0 ? (
              <Text style={styles.empty}>No plan decisions recorded yet.</Text>
            ) : (
              items.map((item) => (
                <View key={item.id} style={styles.row}>
                  <Text style={styles.bullet}>{'\u2022'}</Text>
                  <View style={styles.textBlock}>
                    <Text style={styles.summary}>{item.summary}</Text>
                    <Text style={styles.at}>{item.at.slice(0, 10)}</Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropFill: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  backdropHit: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    backgroundColor: AppTheme.colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingBottom: 24,
    paddingHorizontal: 20,
    maxHeight: '70%',
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
    marginBottom: 4,
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
  subtitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginBottom: 10,
  },
  body: {
    flexGrow: 0,
  },
  empty: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: '700',
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
  },
  bullet: {
    color: AppTheme.colors.brand,
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
  },
  textBlock: {
    flex: 1,
  },
  summary: {
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  at: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
});
