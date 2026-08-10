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
import { useTranslation } from '@/hooks/use-translation';
import type { TranslateFn } from '@/localization/i18n';
import { intentCatalogList } from '@/services/carePlan/intentRouter';
import type { AdcpProposalIntentId } from '@/data/adcp/types';

type IntentListItem = ReturnType<typeof intentCatalogList>[number];

function intentDescription(intent: AdcpProposalIntentId, fallback: string, t: TranslateFn): string {
  switch (intent) {
    case 'review_monitoring_contract':
      return t('care.intents.reviewMonitoring');
    case 'propose_therapy_contract_patch':
      return t('care.intents.therapyPatch');
    case 'explain_uc4_card':
      return t('care.intents.explainUc4');
    case 'promote_uc4_to_plan_task':
      return t('care.intents.promoteUc4');
    case 'suggest_todays_logging':
      return t('care.intents.todaysLogging');
    case 'weekly_care_plan_review':
      return t('care.intents.weeklyReview');
    case 'handoff_summary':
      return t('care.intents.handoff');
    case 'explain_uc3_result':
      return t('care.intents.explainUc3');
    case 'explain_uc2_alert':
      return t('care.intents.explainUc2');
    default:
      return fallback;
  }
}

function intentLabel(intent: AdcpProposalIntentId, fallback: string, t: TranslateFn): string {
  switch (intent) {
    case 'review_monitoring_contract':
      return t('care.intents.label.reviewMonitoring');
    case 'propose_therapy_contract_patch':
      return t('care.intents.label.therapyPatch');
    case 'explain_uc4_card':
      return t('care.intents.label.explainUc4');
    case 'promote_uc4_to_plan_task':
      return t('care.intents.label.promoteUc4');
    case 'suggest_todays_logging':
      return t('care.intents.label.todaysLogging');
    case 'weekly_care_plan_review':
      return t('care.intents.label.weeklyReview');
    case 'handoff_summary':
      return t('care.intents.label.handoff');
    case 'explain_uc3_result':
      return t('care.intents.label.explainUc3');
    case 'explain_uc2_alert':
      return t('care.intents.label.explainUc2');
    default:
      return fallback;
  }
}

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
  const { t } = useTranslation();
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
        <Text style={sectionStyles.title}>{t('care.intents.title')}</Text>
      </View>
      <Text style={sectionStyles.subtitle}>{t('care.intents.subtitle')}</Text>
      {intents.map((intent) => {
        const label = intentLabel(intent.intent, intent.caregiverLabel, t);
        return (
          <Pressable
            key={intent.intent}
            style={sectionStyles.listRow}
            onPress={() => handlePress(intent.intent)}
            accessibilityRole="button"
            accessibilityLabel={t('care.intents.runA11y', { label })}
          >
            <View style={styles.rowLeft}>
              <Text style={sectionStyles.listText}>{label}</Text>
              <Text style={[styles.rowSub, themedStyles.mutedText]}>
                {intentDescription(intent.intent, intent.description, t)}
              </Text>
            </View>
            <AppIcon name="chevronRight" size={20} color={theme.appTextMuted} />
          </Pressable>
        );
      })}
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
