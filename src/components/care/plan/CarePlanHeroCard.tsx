/**
 * Care plan hero card (Care tab hero rework).
 *
 * Merges the old patient strip + plan header into one hero: the plan's
 * identity ("Elena's Care Plan"), tri-state status word, and the Plan Pulse
 * ring. Light indigo/periwinkle surface — the only tinted card on the tab,
 * so the plan reads as the centerpiece, not another white card.
 *
 * The Dashboard keeps its own patient card; nothing here duplicates it.
 */

import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import type { PlanPulse } from '@/services/carePlan/planPulseService';
import type { CarePlanViewModel } from '@/services/carePlan/carePlanViewModel';
import { PlanPulseRing } from './PlanPulseRing';

const STATUS_WORD_LABEL: Record<PlanPulse['statusWord'], string> = {
  activated: 'Activated',
  needs_review: 'Needs review',
  view_only: 'View only',
};

const STATUS_WORD_COLOR: Record<PlanPulse['statusWord'], string> = {
  activated: AppTheme.colors.brand,
  needs_review: AppTheme.colors.attentionAmber,
  view_only: AppTheme.colors.textMuted,
};

export interface CarePlanHeroCardProps {
  vm: CarePlanViewModel;
  pulse: PlanPulse;
  patientName: string;
  patientAge: string;
  primaryDiagnosisLabel: string;
  caregiverName: string;
  caregiverRole: string;
  onShowWhatChanged?: () => void;
  whatChangedCount?: number;
  /** Play the one-time entrance (fade/slide + ring sweep + spine draw). */
  playEntrance?: boolean;
  reduceMotion?: boolean;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function possessive(name: string): string {
  return `${name}\u2019s`;
}

export function CarePlanHeroCard({
  vm,
  pulse,
  patientName,
  patientAge,
  primaryDiagnosisLabel,
  caregiverName,
  caregiverRole,
  onShowWhatChanged,
  whatChangedCount = 0,
  playEntrance = false,
  reduceMotion = false,
}: CarePlanHeroCardProps) {
  // State-created Animated.Value (render-safe; refs trip react-hooks/refs).
  const [entrance] = useState(() => new Animated.Value(playEntrance && !reduceMotion ? 0 : 1));

  useEffect(() => {
    if (!playEntrance || reduceMotion) return;
    Animated.timing(entrance, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [playEntrance, reduceMotion, entrance]);

  const animatedStyle = {
    opacity: entrance,
    transform: [
      {
        translateY: entrance.interpolate({
          inputRange: [0, 1],
          outputRange: [16, 0],
        }),
      },
    ],
  };

  return (
    <Animated.View
      style={[styles.card, animatedStyle]}
      accessible
      accessibilityLabel={`${possessive(firstName(patientName))} care plan, ${STATUS_WORD_LABEL[pulse.statusWord]}, plan pulse ${pulse.score} out of 100`}
    >
      {/* Socket on the bottom-left — the spine drops out of the hero here. */}
      <View style={styles.spineSocket} />

      <View style={styles.topRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.eyebrow}>Care plan</Text>
          <Text style={styles.title} numberOfLines={2}>
            {possessive(firstName(patientName))} Care Plan
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: STATUS_WORD_COLOR[pulse.statusWord] }]} />
            <Text style={[styles.statusWord, { color: STATUS_WORD_COLOR[pulse.statusWord] }]}>
              {STATUS_WORD_LABEL[pulse.statusWord]}
            </Text>
          </View>
        </View>
        <PlanPulseRing
          score={pulse.score}
          attention={pulse.attention}
          playEntrance={playEntrance}
          reduceMotion={reduceMotion}
        />
      </View>

      <View style={styles.divider} />

      <Text style={styles.metaLine} numberOfLines={2}>
        {vm.versionLabel} · Updated {vm.updatedLabel}
      </Text>
      <Text style={styles.metaLine} numberOfLines={2}>
        {patientName}, {patientAge} · {primaryDiagnosisLabel}
      </Text>
      <Text style={styles.metaLine} numberOfLines={1}>
        Caregiver {caregiverName} · {caregiverRole}
      </Text>

      {onShowWhatChanged && whatChangedCount > 0 ? (
        <Pressable
          style={styles.whatChangedButton}
          onPress={onShowWhatChanged}
          accessibilityRole="button"
          accessibilityLabel={`What changed, ${whatChangedCount} recent decisions`}
        >
          <Text style={styles.whatChangedButtonText}>What changed ({whatChangedCount})</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.heroSurface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.heroAccentSoft,
    padding: 18,
    marginBottom: 14,
    overflow: 'visible',
    ...AppTheme.shadow,
  },
  spineSocket: {
    position: 'absolute',
    // Centered on the card frame, halfway between the screen edge and content.
    left: -7,
    bottom: -7,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: AppTheme.colors.heroAccent,
    borderWidth: 2.5,
    borderColor: AppTheme.colors.heroSurface,
    zIndex: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
  },
  eyebrow: {
    color: AppTheme.colors.heroAccent,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    opacity: 0.75,
  },
  title: {
    color: AppTheme.colors.heroAccent,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '900',
    marginTop: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusWord: {
    fontSize: 13,
    fontWeight: '900',
  },
  divider: {
    height: 1,
    backgroundColor: AppTheme.colors.heroAccentSoft,
    marginVertical: 12,
  },
  metaLine: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 2,
  },
  whatChangedButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: AppTheme.colors.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppTheme.colors.heroAccentSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  whatChangedButtonText: {
    color: AppTheme.colors.heroAccent,
    fontSize: 12,
    fontWeight: '900',
  },
});
