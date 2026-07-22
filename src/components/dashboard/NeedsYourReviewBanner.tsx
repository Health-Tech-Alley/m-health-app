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

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppTheme } from '@/constants/theme';
import type { PendingReview } from '@/hooks/usePendingReviews';

type Props = {
  patientId: string | null;
  onReviewPress: () => void;
  reviews: PendingReview;
};

export function NeedsYourReviewBanner({ onReviewPress, reviews }: Props) {
  const router = useRouter();

  if (reviews.total === 0) {
    return null;
  }

  const parts: string[] = [];
  if (reviews.openNonEmergencyAlerts > 0) {
    parts.push(
      `${reviews.openNonEmergencyAlerts} alert${reviews.openNonEmergencyAlerts === 1 ? '' : 's'}`,
    );
  }
  if (reviews.thresholdRecommendations > 0) {
    parts.push(
      `${reviews.thresholdRecommendations} threshold suggestion${reviews.thresholdRecommendations === 1 ? '' : 's'}`,
    );
  }
  if (reviews.planProposals > 0) {
    parts.push(
      `${reviews.planProposals} plan proposal${reviews.planProposals === 1 ? '' : 's'}`,
    );
  }
  const breakdown = parts.join(' and ');
  const hasPlanProposalsOnly =
    reviews.planProposals > 0 &&
    reviews.openNonEmergencyAlerts === 0 &&
    reviews.thresholdRecommendations === 0;

  return (
    <View style={styles.banner}>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>Needs your review</Text>
        <Text style={styles.line}>
          {breakdown} need{reviews.total === 1 ? 's' : ''} your review.
        </Text>
        <Text style={styles.subline}>
          The Concierge suggests. You decide.
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={styles.reviewButton}
          onPress={onReviewPress}
          accessibilityRole="button"
          accessibilityLabel="Review pending items"
        >
          <Text style={styles.reviewButtonText}>Review now</Text>
        </Pressable>
        {hasPlanProposalsOnly ? (
          <Pressable
            style={styles.linkButton}
            onPress={() => router.push('/care')}
            accessibilityRole="link"
            accessibilityLabel="Open Care tab to review plan proposals"
          >
            <Text style={styles.linkButtonText}>Open Care plan</Text>
          </Pressable>
        ) : null}
        {reviews.thresholdRecommendations > 0 ? (
          <Pressable
            style={styles.linkButton}
            onPress={() => router.push('/settings')}
            accessibilityRole="link"
            accessibilityLabel="Open threshold suggestions"
          >
            <Text style={styles.linkButtonText}>Open thresholds</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
