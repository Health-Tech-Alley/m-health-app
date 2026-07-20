/**
 * CareConciergeIntentsCard — the entry point to all Plan-supported intents
 * (planning/39 §4, §4.2, P2).
 *
 * Lists ≥5 caregiver-facing intents. Tapping one calls the router with the
 * snapshot; Concierge tab's `CarePlanInsightSheet` renders the result plus
 * a confirm/reject affordance that calls `caregiverConfirmProposal` /
 * `caregiverRejectProposal`.
 *
 * Care SLM is **never** on a fast path / no-SLM path (L8). When no native
 * SLM is available the sheet gracefully shows the schema + "Concierge
 * unavailable" state.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/AppIcon';
import { AppTheme } from '@/constants/theme';
import { intentCatalogList } from '@/services/carePlan/intentRouter';
import type { AdcpProposalIntentId } from '@/data/adcp/types';

const INTENT_DESCRIPTION: Partial<Record<AdcpProposalIntentId, string>> = {
  review_monitoring_contract:
    'Inspect active thresholds + queue personalized updates (ML-vetted before apply).',
  propose_therapy_contract_patch:
    'Today\u2019s rehab check-in + therapy metrics inform a queued contract patch.',
  explain_uc4_card:
    'Plain-language explanation of why a care-focus card surfaced now.',
  promote_uc4_to_plan_task:
    'Promote a card to a durable plan priority. ML vetting required before apply.',
  suggest_todays_logging:
    'Metric-tied checklist based on plan gaps + what UC4 wants logged today.',
  weekly_care_plan_review:
    'Multi-section review of the last 7 days; queues plan proposals with rationale.',
  handoff_summary:
    'Narrative summary suitable for a backup caregiver + the audit trail.',
  explain_uc3_result: 'Explain the latest rehabilitation trajectory result.',
  explain_uc2_alert: 'Route through the alerts path; open the Care insight sheet.',
};

export interface CareConciergeIntentsCardProps {
  patientId: string | null;
  onLaunch: (intent: AdcpProposalIntentId) => void;
}

export function CareConciergeIntentsCard({ patientId, onLaunch }: CareConciergeIntentsCardProps) {
  const intents = intentCatalogList();
  const handlePress = (intent: AdcpProposalIntentId) => {
    if (!patientId) return;
    onLaunch(intent);
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <AppIcon name="care" size={18} color={AppTheme.colors.brand} />
        <Text style={styles.title}>Care Concierge</Text>
      </View>
      <Text style={styles.subtitle}>
        Pick a plan-aware question. Concierge waits for your review before any change goes to the engines.
      </Text>
      {intents.map((intent) => (
        <Pressable
          key={intent.intent}
          style={styles.row}
          onPress={() => handlePress(intent.intent)}
          accessibilityRole="button"
          accessibilityLabel={`Run intent ${intent.caregiverLabel}`}
        >
          <View style={styles.rowLeft}>
            <Text style={styles.rowTitle}>{intent.caregiverLabel}</Text>
            <Text style={styles.rowSub}>
              {INTENT_DESCRIPTION[intent.intent] ?? intent.description}
            </Text>
          </View>
          <AppIcon name="chevronRight" size={20} color={AppTheme.colors.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 16,
    marginBottom: 14,
    ...AppTheme.shadow,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  subtitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
  },
  rowLeft: {
    flex: 1,
  },
  rowTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  rowSub: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
});
