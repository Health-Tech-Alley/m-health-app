import { useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { getEventBus } from '@/orchestration/event-bus';
import type { OrchestrationEvent } from '@/orchestration/events';

const CRITICAL_RED = '#B3261E';

type HypotheticalCriticalEvent = Extract<OrchestrationEvent, { type: 'slm_hypothetical_critical' }>;

export function HypotheticalCriticalBanner() {
  const [event, setEvent] = useState<HypotheticalCriticalEvent | null>(null);
  const slideY = useMemo(() => new Animated.Value(-400), []);

  const animateOut = (onDone?: () => void) => {
    Animated.timing(slideY, {
      toValue: -400,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      onDone?.();
    });
  };

  const dismiss = () => {
    if (event) {
      const bus = getEventBus();
      bus.publish({
        type: 'caregiver_ground_truth',
        alertId: event.alertId,
        patientId: event.patientId,
        observation: 'Caregiver dismissed hypothetical critical alert',
        action: 'dismiss_critical_hypothetical',
        at: new Date().toISOString(),
      });
    }
    animateOut(() => setEvent(null));
  };

  const confirm = () => {
    if (event) {
      const bus = getEventBus();
      bus.publish({
        type: 'caregiver_ground_truth',
        alertId: event.alertId,
        patientId: event.patientId,
        observation: 'Caregiver confirmed hypothetical critical alert',
        action: 'confirm_critical_hypothetical',
        at: new Date().toISOString(),
      });
    }
    animateOut(() => setEvent(null));
  };

  useEffect(() => {
    const bus = getEventBus();
    const unsub = bus.subscribe('slm_hypothetical_critical', (e) => {
      if (e.type === 'slm_hypothetical_critical') {
        setEvent(e);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!event) return;
    slideY.setValue(-400);
    Animated.timing(slideY, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [event?.alertId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!event) return null;

  const vitalsEntries = Object.entries(event.hypotheticalVitals)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(', ');

  return (
    <SafeAreaView edges={['top']} style={styles.wrapper} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.banner,
          { backgroundColor: CRITICAL_RED, transform: [{ translateY: slideY }] },
        ]}>
        <View style={styles.content}>
          <Text style={styles.title} numberOfLines={1}>
            Critical alert — is this real?
          </Text>
          <Text style={styles.body} numberOfLines={3}>
            Health Monitor severity {event.mlResult.severity}
            {vitalsEntries ? ` — ${vitalsEntries}` : ''}. Confirm only if this is
            happening now (not a what-if). Confirm opens the emergency dialogue.
          </Text>
          <View style={styles.buttonRow}>
            <Pressable onPress={confirm} style={styles.confirmButton}>
              <Text style={styles.confirmText}>Yes — this is real</Text>
            </Pressable>
            <Pressable onPress={dismiss} style={styles.dismissButton}>
              <Text style={styles.dismissText}>No — hypothetical</Text>
            </Pressable>
          </View>
        </View>
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
    zIndex: 1000,
  },
  banner: {
    marginHorizontal: Spacing.two,
    marginTop: Spacing.two,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
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
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  confirmButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  confirmText: {
    color: CRITICAL_RED,
    fontSize: 14,
    fontWeight: '700',
  },
  dismissButton: {
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  dismissText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
