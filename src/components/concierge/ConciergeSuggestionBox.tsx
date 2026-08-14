/**
 * Concierge suggestion box (Care tab rework).
 *
 * The structured Care-Concierge intents moved here from the Care tab,
 * consolidated into a few plain-language groups so the surface is not
 * overwhelming. Hybrid behavior:
 *   - explanation-style suggestions send a pre-written chat prompt (the
 *     normal NLU + skills pipeline answers it);
 *   - plan-action suggestions also send a chat turn (the host drafts any
 *     proposal via the in-conversation review card).
 *
 * Categories are collapsed by default; tap a group header to expand sample prompts.
 */

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import type { AdcpProposalIntentId } from '@/data/adcp/types';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import type { TranslationKey } from '@/localization/i18n';
import type { PlanOpportunity } from '@/services/carePlan/planOpportunities';

export interface ConciergeSuggestion {
  id: string;
  label: string;
  labelKey: TranslationKey;
  kind: 'chat' | 'intent';
  /** For kind 'chat': the prompt sent into the conversation. */
  prompt?: string;
  /** For kind 'intent': the structured intent to launch. */
  intentId?: AdcpProposalIntentId;
  /** Optional prefilled args (e.g. UC4 cardId) for the intent. */
  intentArgs?: Record<string, unknown>;
}

interface SuggestionGroup {
  key: string;
  label: string;
  labelKey: TranslationKey;
  suggestions: ConciergeSuggestion[];
}

const SUGGESTION_GROUPS: SuggestionGroup[] = [
  {
    key: 'understand',
    label: 'Understand the plan',
    labelKey: 'assistant.suggestions.group.understand',
    suggestions: [
      {
        id: 'weekly-review',
        label: 'Review this week\u2019s care plan',
        labelKey: 'assistant.suggestions.weeklyReview',
        kind: 'chat',
        prompt:
          'Walk me through this week\u2019s care plan: the main goals, what changed recently, and what I should focus on first.',
      },
      {
        id: 'explain-focus',
        label: 'Explain my current care focus items',
        labelKey: 'assistant.suggestions.explainFocus',
        kind: 'chat',
        prompt:
          'Explain my current care focus items: what each one means, why it was raised, and what I should log or watch for next.',
      },
      {
        id: 'understand-goals',
        label: 'What are the goals right now?',
        labelKey: 'assistant.suggestions.understandGoals',
        kind: 'chat',
        prompt:
          'Summarize the active goals on the care plan and what progress toward them looks like this month.',
      },
    ],
  },
  {
    key: 'daily-care',
    label: 'Daily care',
    labelKey: 'assistant.suggestions.group.dailyCare',
    suggestions: [
      {
        id: 'todays-logging',
        label: 'What should I log today?',
        labelKey: 'assistant.suggestions.todaysLogging',
        kind: 'chat',
        prompt:
          'Based on the current care plan and recent patterns, what are the most useful things for me to log today?',
      },
      {
        id: 'watch-today',
        label: 'What should I watch for today?',
        labelKey: 'assistant.suggestions.watchToday',
        kind: 'chat',
        prompt:
          'Given this patient\u2019s conditions, medications, and care plan, what should I watch for today and when should I escalate?',
      },
      {
        id: 'propose-therapy',
        label: 'Suggest a therapy plan update',
        labelKey: 'assistant.suggestions.proposeTherapy',
        kind: 'intent',
        intentId: 'propose_therapy_contract_patch',
      },
    ],
  },
  {
    key: 'review-prepare',
    label: 'Review & prepare',
    labelKey: 'assistant.suggestions.group.reviewPrepare',
    suggestions: [
      {
        id: 'handoff-summary',
        label: 'Prepare a care-team summary',
        labelKey: 'assistant.suggestions.handoffSummary',
        kind: 'chat',
        prompt:
          'Help me prepare a short summary for the care team: recent concerns, what I have been logging, and questions to bring up at the next visit.',
      },
      {
        id: 'review-monitoring',
        label: 'Review monitoring thresholds',
        labelKey: 'assistant.suggestions.reviewMonitoring',
        kind: 'intent',
        intentId: 'review_monitoring_contract',
      },
      {
        id: 'med-questions',
        label: 'Questions about medications',
        labelKey: 'assistant.suggestions.medQuestions',
        kind: 'chat',
        prompt:
          'What are practical, non-dose questions I could ask the care team about the current medications and their watch areas?',
      },
    ],
  },
];

/** Localized chip labels for the mutating intents the detector may surface. */
const OPPORTUNITY_LABEL_KEYS: Partial<Record<AdcpProposalIntentId, TranslationKey>> = {
  promote_uc4_to_plan_task: 'care.intents.label.promoteUc4',
  review_monitoring_contract: 'care.intents.label.reviewMonitoring',
  propose_therapy_contract_patch: 'care.intents.label.therapyPatch',
  weekly_care_plan_review: 'care.intents.label.weeklyReview',
};

export interface ConciergeSuggestionBoxProps {
  onSendPrompt: (prompt: string) => void;
  onLaunchIntent: (intentId: AdcpProposalIntentId, args?: Record<string, unknown>) => void;
  /** Disable all taps while a conversation turn is streaming. */
  disabled?: boolean;
  /** Deterministic plan opportunities (PLAN WATCH detector) — rendered as chips. */
  opportunities?: PlanOpportunity[];
}

export function ConciergeSuggestionBox({
  onSendPrompt,
  onLaunchIntent,
  disabled = false,
  opportunities = [],
}: ConciergeSuggestionBoxProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const [cardExpanded, setCardExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const handlePress = (suggestion: ConciergeSuggestion) => {
    if (disabled) return;
    if (suggestion.kind === 'chat' && suggestion.prompt) {
      onSendPrompt(suggestion.prompt);
    } else if (suggestion.kind === 'intent' && suggestion.intentId) {
      onLaunchIntent(suggestion.intentId, suggestion.intentArgs);
    }
  };

  const handleOpportunityPress = (opportunity: PlanOpportunity) => {
    if (disabled) return;
    onLaunchIntent(opportunity.intentId, opportunity.args);
  };

  return (
    <View style={[styles.card, themedStyles.card]} accessible accessibilityLabel={t('assistant.suggestions.cardA11y')}>
      <Pressable
        style={styles.cardHeader}
        onPress={() => setCardExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: cardExpanded }}
        accessibilityLabel={t('assistant.suggestions.a11y', {
          state: cardExpanded ? t('common.collapse') : t('common.expand'),
        })}
      >
        <View style={styles.cardHeaderText}>
          <Text style={[styles.title, themedStyles.primaryText]}>{t('assistant.suggestions.title')}</Text>
          {!cardExpanded ? (
            <Text style={[styles.subtitleCollapsed, themedStyles.mutedText]}>
              {t('assistant.suggestions.collapsedSubtitle')}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.chevron, themedStyles.mutedText]}>{cardExpanded ? '▾' : '▸'}</Text>
      </Pressable>

      {cardExpanded ? (
        <>
          <Text style={[styles.subtitle, themedStyles.mutedText]}>
            {t('assistant.suggestions.subtitle')}
          </Text>
          {opportunities.length > 0 ? (
            <View style={[styles.group, themedStyles.group]}>
              <Text style={[styles.groupLabel, themedStyles.primaryText]}>
                {t('assistant.suggestions.forYourPlan')}
              </Text>
              <View style={styles.chips}>
                {opportunities.map((opportunity) => {
                  const labelKey = OPPORTUNITY_LABEL_KEYS[opportunity.intentId];
                  return (
                    <Pressable
                      key={opportunity.id}
                      style={[styles.chip, themedStyles.chip, disabled && styles.chipDisabled]}
                      onPress={() => handleOpportunityPress(opportunity)}
                      disabled={disabled}
                      accessibilityRole="button"
                      accessibilityLabel={`${labelKey ? t(labelKey) : opportunity.intentId} - ${opportunity.summary}`}
                    >
                      <Text style={[styles.chipText, themedStyles.chipText]}>
                        {'\u2726 '}
                        {labelKey ? t(labelKey) : opportunity.intentId}
                      </Text>
                      <Text style={[styles.chipSubtitle, themedStyles.mutedText]}>
                        {opportunity.summary}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          {SUGGESTION_GROUPS.map((group) => {
            const expanded = Boolean(expandedGroups[group.key]);
            const groupLabel = t(group.labelKey);
            return (
              <View key={group.key} style={[styles.group, themedStyles.group]}>
                <Pressable
                  style={styles.groupHeader}
                  onPress={() =>
                    setExpandedGroups((current) => ({
                      ...current,
                      [group.key]: !expanded,
                    }))
                  }
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${groupLabel} - ${expanded ? t('common.collapse') : t('common.expand')}`}
                >
                  <Text style={[styles.groupLabel, themedStyles.primaryText]}>{groupLabel}</Text>
                  <Text style={[styles.groupMeta, themedStyles.mutedText]}>
                    {group.suggestions.length} · {expanded ? '▾' : '▸'}
                  </Text>
                </Pressable>
                {expanded ? (
                  <View style={styles.chips}>
                    {group.suggestions.map((suggestion) => (
                      <Pressable
                        key={suggestion.id}
                        style={[styles.chip, themedStyles.chip, disabled && styles.chipDisabled]}
                        onPress={() => handlePress(suggestion)}
                        disabled={disabled}
                        accessibilityRole="button"
                        accessibilityLabel={t(suggestion.labelKey)}
                      >
                        <Text style={[styles.chipText, themedStyles.chipText]}>{t(suggestion.labelKey)}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';

  return StyleSheet.create({
    card: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    primaryText: {
      color: theme.appText,
    },
    mutedText: {
      color: theme.appTextMuted,
    },
    group: {
      borderTopColor: theme.appBorder,
    },
    chip: {
      backgroundColor: theme.appBrandSoftSurface,
    },
    chipText: {
      color: isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand,
    },
  });
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardHeaderText: {
    flex: 1,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  subtitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 4,
  },
  subtitleCollapsed: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  chevron: {
    color: AppTheme.colors.textMuted,
    fontSize: 16,
    fontWeight: '900',
  },
  group: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    paddingTop: 8,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 36,
  },
  groupLabel: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  groupMeta: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    marginTop: 8,
  },
  chip: {
    borderRadius: 999,
    backgroundColor: AppTheme.colors.brandSoft,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: '800',
  },
  chipSubtitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    maxWidth: 240,
  },
});
