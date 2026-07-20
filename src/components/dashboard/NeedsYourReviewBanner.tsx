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

import { usePendingReviews } from '@/hooks/usePendingReviews';

type Props = {
  patientId: string | null;
  onReviewPress: () => void;
};

export function NeedsYourReviewBanner({ patientId, onReviewPress }: Props) {
  const reviews = usePendingReviews(patientId);
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
    backgroundColor: '#FFF4DC',
    borderColor: '#E1A53C',
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    gap: 10,
  },
  body: { gap: 4 },
  eyebrow: {
    color: '#7A4A00',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  line: {
    color: '#123433',
    fontWeight: '700',
    fontSize: 15,
    lineHeight: 21,
  },
  subline: {
    color: '#7A4A00',
    fontSize: 12,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
  },
  reviewButton: {
    backgroundColor: '#E1A53C',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
  },
  reviewButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  linkButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  linkButtonText: {
    color: '#7A4A00',
    fontWeight: '700',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});
