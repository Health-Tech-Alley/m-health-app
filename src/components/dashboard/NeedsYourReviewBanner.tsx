/**
 * "Needs Your Review" banner — promoted HITL surface on the Dashboard.
 *
 * Per planning/29_hitl-promotion-plan.md: aggregate the count of pending
 * HITL items (open non-emergency alerts + pending threshold recommendations)
 * and surface a soft amber banner that scrolls the user to the relevant
 * section. This is the "first-class HITL" affordance the doc asks for.
 *
 * Updated for planning/39 §4.3 / L18 to also surface pending plan
 * proposals (ADCP) so the caregiver has one HITL count for everything.
 */

import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/AppIcon';
import { AppTheme } from '@/constants/theme';
import { severityColor } from '@/constants/user-terms';
import type { PendingReview } from '@/hooks/usePendingReviews';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import type { TranslateFn } from '@/localization/i18n';

type ReviewAlert = PendingReview['openNonEmergencyAlertItems'][number];

type Props = {
  onReviewPress?: () => void;
  reviews: PendingReview;
  variant?: 'alerts' | 'care';
};

export function NeedsYourReviewBanner({
  onReviewPress,
  reviews,
  variant = 'alerts',
}: Props) {
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  if (variant === 'alerts') {
    if (reviews.openNonEmergencyAlertItems.length === 0) {
      return null;
    }

    return (
      <View style={styles.reviewSection}>
        <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>{t('dashboard.needsReview.title')}</Text>
        <View style={styles.alertList}>
          {reviews.openNonEmergencyAlertItems.map((alert) => (
            <AlertReviewCard
              key={alert.alertId}
              alert={alert}
              t={t}
              onPress={() =>
                router.push({
                  pathname: '/alert-detail',
                  params: { alertId: alert.alertId },
                })
              }
            />
          ))}
        </View>
      </View>
    );
  }

  if (reviews.careReviewTotal === 0) {
    return null;
  }

  const breakdown = formatCareBreakdown(reviews, t);
  const hasPlanProposalsOnly =
    reviews.planProposals > 0 &&
    reviews.thresholdRecommendations === 0;
  const handleReviewPress = onReviewPress ?? (() => router.push('/settings'));

  return (
    <View style={[styles.banner, themedStyles.banner]}>
      <View style={styles.body}>
        <Text style={[styles.eyebrow, themedStyles.eyebrow]}>{t('dashboard.needsReview.title')}</Text>
        <Text style={[styles.line, themedStyles.line]}>
          {t(reviews.total === 1 ? 'dashboard.needsReview.lineOne' : 'dashboard.needsReview.lineMany', {
            breakdown,
          })}
        </Text>
        <Text style={[styles.subline, themedStyles.subline]}>
          {t('dashboard.needsReview.subline')}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={styles.reviewButton}
          onPress={handleReviewPress}
          accessibilityRole="button"
          accessibilityLabel={t('dashboard.needsReview.reviewNowA11y')}
        >
          <Text style={styles.reviewButtonText}>{t('dashboard.needsReview.reviewNow')}</Text>
        </Pressable>
        {hasPlanProposalsOnly ? (
          <Pressable
            style={styles.linkButton}
            onPress={() => router.push('/care')}
            accessibilityRole="link"
            accessibilityLabel={t('dashboard.needsReview.openCarePlanA11y')}
          >
            <Text style={[styles.linkButtonText, themedStyles.linkButtonText]}>{t('dashboard.needsReview.openCarePlan')}</Text>
          </Pressable>
        ) : null}
        {reviews.thresholdRecommendations > 0 ? (
          <Pressable
            style={styles.linkButton}
            onPress={() => router.push('/settings')}
            accessibilityRole="link"
            accessibilityLabel={t('dashboard.needsReview.openThresholdsA11y')}
          >
            <Text style={[styles.linkButtonText, themedStyles.linkButtonText]}>{t('dashboard.needsReview.openThresholds')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function AlertReviewCard({
  alert,
  t,
  onPress,
}: {
  alert: ReviewAlert;
  t: TranslateFn;
  onPress: () => void;
}) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const accent = severityColor(alert.severity);
  const textAccent =
    theme.appBackground === '#000000' && alert.severity !== 2
      ? AppTheme.colors.brandPale
      : accent;
  const body = alert.body.trim() || t('dashboard.needsReview.alertFallbackBody');
  const severity = formatDashboardSeverityLabel(alert.severity, t);

  return (
    <Pressable
      style={[styles.alertCard, themedStyles.alertCard, { borderColor: accent }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('dashboard.needsReview.reviewAlertA11y', {
        severity,
        title: alert.title,
      })}
    >
      <View style={[styles.alertIcon, { backgroundColor: alertIconBackground(alert, theme) }]}>
        <AppIcon name="alert" size={22} color={textAccent} />
      </View>
      <View style={styles.alertBody}>
        <View style={styles.alertMetaRow}>
          <Text style={[styles.alertSeverity, { color: textAccent }]}>
            {severity}
          </Text>
          <Text style={[styles.alertTime, themedStyles.eyebrow]}>{formatRelativeTime(alert.createdAt, t)}</Text>
        </View>
        <Text style={[styles.alertTitle, themedStyles.line]} numberOfLines={2}>
          {alert.title}
        </Text>
        <Text style={[styles.alertText, themedStyles.subline]} numberOfLines={2}>
          {body}
        </Text>
        <Text style={[styles.alertAction, { color: textAccent }]}>{t('dashboard.needsReview.reviewAlert')}</Text>
      </View>
      <AppIcon name="chevronRight" size={24} color={theme.appTextMuted} />
    </Pressable>
  );
}

function alertIconBackground(alert: ReviewAlert, theme: ReturnType<typeof useTheme>): string {
  const isDark = theme.appBackground === '#000000';
  if (alert.severity === 2) {
    return isDark ? 'rgba(249, 115, 22, 0.16)' : AppTheme.colors.warningSoft;
  }
  return theme.appBrandSoftSurface;
}

function formatCareBreakdown(reviews: PendingReview, t: TranslateFn): string {
  const parts: string[] = [];
  if (reviews.thresholdRecommendations > 0) {
    parts.push(
      t(reviews.thresholdRecommendations === 1
        ? 'dashboard.needsReview.thresholdOne'
        : 'dashboard.needsReview.thresholdMany', {
        count: reviews.thresholdRecommendations,
      }),
    );
  }
  if (reviews.planProposals > 0) {
    parts.push(
      t(reviews.planProposals === 1
        ? 'dashboard.needsReview.planOne'
        : 'dashboard.needsReview.planMany', {
        count: reviews.planProposals,
      }),
    );
  }
  if (parts.length <= 1) return parts[0] ?? '';
  return parts.slice(1).reduce(
    (left, right) => t('dashboard.needsReview.breakdownJoin', { left, right }),
    parts[0],
  );
}

function formatDashboardSeverityLabel(
  severity: number | null | undefined,
  t: TranslateFn,
): string {
  if (severity === 3) return t('dashboard.alertSeverity.urgent');
  if (severity === 2) return t('dashboard.alertSeverity.needsAttention');
  if (severity === 1) return t('dashboard.alertSeverity.headsUp');
  if (severity === 0) return t('dashboard.alertSeverity.info');
  return t('dashboard.alertSeverity.alert');
}

function formatRelativeTime(iso: string, t: TranslateFn): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return t('dashboard.time.recent');
  const minutes = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (minutes < 1) return t('dashboard.time.justNow');
  if (minutes < 60) return t('dashboard.time.minutesAgoShort', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('dashboard.time.hoursAgoShort', { count: hours });
  return t('dashboard.time.daysAgoShort', { count: Math.round(hours / 24) });
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';

  return StyleSheet.create({
    sectionTitle: {
      color: theme.appSectionText,
    },
    alertCard: {
      backgroundColor: theme.appSurface,
    },
    banner: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    eyebrow: {
      color: theme.appTextMuted,
    },
    line: {
      color: theme.appText,
    },
    subline: {
      color: theme.appTextSupporting,
    },
    linkButtonText: {
      color: isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand,
    },
  });
}

const styles = StyleSheet.create({
  reviewSection: {
    marginBottom: 14,
  },
  sectionTitle: {
    marginTop: 24,
    marginBottom: 12,
    color: AppTheme.colors.sectionText,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  alertList: {
    gap: 10,
  },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    padding: 14,
    ...AppTheme.shadow,
  },
  alertIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  alertBody: {
    flex: 1,
    minWidth: 0,
  },
  alertMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  alertSeverity: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  alertTime: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  alertTitle: {
    color: AppTheme.colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    marginTop: 2,
  },
  alertText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 3,
  },
  alertAction: {
    fontSize: 13,
    fontWeight: '900',
    marginTop: 8,
  },
  banner: {
    backgroundColor: AppTheme.colors.surface,
    borderColor: AppTheme.colors.border,
    borderWidth: 1,
    borderRadius: AppTheme.radius.card,
    padding: 14,
    gap: 10,
    ...AppTheme.shadow,
  },
  body: { gap: 4 },
  eyebrow: {
    color: AppTheme.colors.textMuted,
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.3,
  },
  line: {
    color: AppTheme.colors.text,
    fontWeight: '900',
    fontSize: 15,
    lineHeight: 20,
  },
  subline: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  reviewButton: {
    backgroundColor: AppTheme.colors.brand,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
  },
  reviewButtonText: {
    color: AppTheme.colors.white,
    fontWeight: '900',
    fontSize: 14,
  },
  linkButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  linkButtonText: {
    color: AppTheme.colors.brand,
    fontWeight: '900',
    fontSize: 13,
  },
});
