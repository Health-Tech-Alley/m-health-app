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

import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import type { AppLanguage, TranslateFn } from '@/localization/i18n';
import type { PlanPulse } from '@/services/carePlan/planPulseService';
import type { CarePlanViewModel } from '@/services/carePlan/carePlanViewModel';
import { formatPossessive, getFirstName } from '@/utils/patientDisplay';
import { PlanPulseRing } from './PlanPulseRing';

const STATUS_WORD_COLOR: Record<PlanPulse['statusWord'], string> = {
  activated: AppTheme.colors.brand,
  needs_review: AppTheme.colors.attentionAmber,
  view_only: AppTheme.colors.textMuted,
};

/** Dark-mode status words: pale periwinkle family so the tinted card keeps contrast. */
const DARK_STATUS_WORD_COLOR: Record<PlanPulse['statusWord'], string> = {
  activated: AppTheme.colors.brandPale,
  needs_review: '#FBBF24',
  view_only: '#A5B4FC',
};

function statusWordLabel(status: PlanPulse['statusWord'], t: TranslateFn): string {
  switch (status) {
    case 'activated':
      return t('care.hero.status.activated');
    case 'needs_review':
      return t('care.hero.status.needsReview');
    case 'view_only':
      return t('care.hero.status.viewOnly');
  }
}

function formatCarePlanTitle(patientName: string, language: AppLanguage, t: TranslateFn): string {
  const firstName = getFirstName(patientName);
  const name = language === 'es' ? firstName : formatPossessive(firstName);
  return t('care.hero.planTitle', { name });
}

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
  const { language, t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.appBackground === '#000000';
  const themedStyles = useMemo(() => createThemedStyles(isDark), [isDark]);
  const statusWordColor = isDark
    ? DARK_STATUS_WORD_COLOR[pulse.statusWord]
    : STATUS_WORD_COLOR[pulse.statusWord];
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

  const planTitle = formatCarePlanTitle(patientName, language, t);
  const caregiverLine =
    caregiverName && caregiverName !== 'Not provided'
      ? caregiverRole && caregiverRole !== 'Not provided'
        ? t('care.hero.caredForByWithRole', { caregiverName, role: caregiverRole })
        : t('care.hero.caredForBy', { caregiverName })
      : null;
  const recentChangesLabel =
    whatChangedCount === 1
      ? t('care.hero.recentChange.one')
      : t('care.hero.recentChange.many', { count: whatChangedCount });
  const statusLabel = statusWordLabel(pulse.statusWord, t);

  return (
    <Animated.View
      style={[styles.card, themedStyles.card, animatedStyle]}
      accessible
      accessibilityLabel={`${planTitle}, ${statusLabel}`}
    >
      {/* Socket on the bottom-left — the spine drops out of the hero here. */}
      <View style={[styles.spineSocket, themedStyles.spineSocket]} />

      <View style={styles.topRow}>
        <View style={styles.titleBlock}>
          <Text style={[styles.eyebrow, themedStyles.eyebrow]}>{t('care.hero.carePlan')}</Text>
          <Text style={[styles.title, themedStyles.title]} numberOfLines={2}>
            {planTitle}
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusWordColor }]} />
            <Text style={[styles.statusWord, { color: statusWordColor }]}>
              {statusLabel}
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

      <View style={[styles.divider, themedStyles.divider]} />

      <Text style={[styles.metaLine, themedStyles.metaLine]} numberOfLines={2}>
        {t('care.hero.updated', { version: vm.versionLabel, updated: vm.updatedLabel })}
      </Text>
      <Text style={[styles.metaLine, themedStyles.metaLine]} numberOfLines={2}>
        {patientName}, {patientAge} · {primaryDiagnosisLabel}
      </Text>
      {caregiverLine ? (
        <Text style={[styles.metaLine, themedStyles.metaLine]} numberOfLines={1}>
          {caregiverLine}
        </Text>
      ) : null}

      {onShowWhatChanged && whatChangedCount > 0 ? (
        <Pressable
          style={[styles.whatChangedButton, themedStyles.whatChangedButton]}
          onPress={onShowWhatChanged}
          accessibilityRole="button"
          accessibilityLabel={recentChangesLabel}
        >
          <Text style={[styles.whatChangedButtonText, themedStyles.whatChangedButtonText]}>{recentChangesLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

/**
 * Dark overlay: keeps the hero's indigo identity (it stays the only tinted
 * card) but moves it to a deep indigo surface so it is not a light island
 * on the default-dark Care tab.
 */
function createThemedStyles(isDark: boolean) {
  if (!isDark) return {};
  return {
    card: {
      backgroundColor: '#1E1B4B',
      borderColor: '#312E81',
      elevation: 0,
      shadowOpacity: 0,
    },
    spineSocket: { borderColor: '#1E1B4B' },
    eyebrow: { color: '#C7D2FE' },
    title: { color: '#E0E7FF' },
    divider: { backgroundColor: '#312E81' },
    metaLine: { color: '#A5B4FC' },
    whatChangedButton: { backgroundColor: '#312E81', borderColor: '#4338CA' },
    whatChangedButtonText: { color: '#C7D2FE' },
  };
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
