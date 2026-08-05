/**
 * CareConciergeIntentsCard — the entry point to all Plan-supported intents
 * (planning/39 §4, §4.2, P2; planning/41 D1/D3).
 *
 * Lists caregiver-facing intents. Optional `intents` prop lets CareAskRegion
 * pass a read-only-filtered catalog so mutating actions are not shown when
 * Living care plan updates is off.
 *
 * Care Concierge is **never** on a fast path (L8).
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/AppIcon';
import { createThemedSectionStyles } from '@/components/care/plan/carePlanSectionStyles';
import { AppTheme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { intentCatalogList } from '@/services/carePlan/intentRouter';
import type { AdcpProposalIntentId } from '@/data/adcp/types';

type IntentListItem = ReturnType<typeof intentCatalogList>[number];

const INTENT_DESCRIPTION: Partial<Record<AdcpProposalIntentId, string>> = {
  review_monitoring_contract:
    'Inspect active thresholds and queue personalized updates for your review.',
  propose_therapy_contract_patch:
    'Today\u2019s rehab check-in and therapy metrics inform a queued plan update.',
  explain_uc4_card:
    'Plain-language explanation of why a care-focus item surfaced now.',
  promote_uc4_to_plan_task:
    'Add a care-focus item to the durable care plan after your review.',
  suggest_todays_logging:
    'Metric-tied checklist based on plan gaps and what to log today.',
  weekly_care_plan_review:
    'Multi-section review of the last 7 days; queues plan proposals with rationale.',
  handoff_summary:
    'Narrative summary suitable for a backup caregiver and the audit trail.',
  explain_uc3_result: 'Explain the latest rehabilitation progress result.',
  explain_uc2_alert: 'Open an explanation of a Health Monitor alert.',
};

export interface CareConciergeIntentsCardProps {
  patientId: string | null;
  onLaunch: (intent: AdcpProposalIntentId) => void;
  /** When provided, only these intents are shown (e.g. read-only filter). */
  intents?: IntentListItem[];
}

export function CareConciergeIntentsCard({
  patientId,
  onLaunch,
  intents: intentsProp,
}: CareConciergeIntentsCardProps) {
  const intents = intentsProp ?? intentCatalogList();
  const theme = useTheme();
  const sectionStyles = useMemo(() => createThemedSectionStyles(theme), [theme]);
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const isDark = theme.appBackground === '#000000';
  const iconColor = isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand;
  const handlePress = (intent: AdcpProposalIntentId) => {
    if (!patientId) return;
    onLaunch(intent);
  };

  return (
    <View style={sectionStyles.card}>
      <View style={sectionStyles.headerRow}>
        <AppIcon name="care" size={18} color={iconColor} />
        <Text style={sectionStyles.title}>Care Concierge</Text>
      </View>
      <Text style={sectionStyles.subtitle}>
        Pick a plan-aware question. Concierge waits for your review before any change is applied.
      </Text>
      {intents.map((intent) => (
        <Pressable
          key={intent.intent}
          style={sectionStyles.listRow}
          onPress={() => handlePress(intent.intent)}
          accessibilityRole="button"
          accessibilityLabel={`Run intent ${intent.caregiverLabel}`}
        >
          <View style={styles.rowLeft}>
            <Text style={sectionStyles.listText}>{intent.caregiverLabel}</Text>
            <Text style={[styles.rowSub, themedStyles.mutedText]}>
              {INTENT_DESCRIPTION[intent.intent] ?? intent.description}
            </Text>
          </View>
          <AppIcon name="chevronRight" size={20} color={theme.appTextMuted} />
        </Pressable>
      ))}
    </View>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    mutedText: {
      color: theme.appTextMuted,
    },
  });
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
