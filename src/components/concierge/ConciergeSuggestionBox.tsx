/**
 * Concierge suggestion box (Care tab rework).
 *
 * The structured Care-Concierge intents moved here from the Care tab,
 * consolidated into a few plain-language groups so the surface is not
 * overwhelming. Hybrid behavior:
 *   - explanation-style suggestions send a pre-written chat prompt (the
 *     normal NLU + skills pipeline answers it);
 *   - plan-action suggestions open the structured intent sheet (proposal
 *     flow with caregiver review).
 *
 * Categories are collapsed by default; tap a group header to expand sample prompts.
 */

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import type { AdcpProposalIntentId } from '@/data/adcp/types';
import { useTheme } from '@/hooks/use-theme';

export interface ConciergeSuggestion {
  id: string;
  label: string;
  kind: 'chat' | 'intent';
  /** For kind 'chat': the prompt sent into the conversation. */
  prompt?: string;
  /** For kind 'intent': the structured intent to launch. */
  intentId?: AdcpProposalIntentId;
}

interface SuggestionGroup {
  key: string;
  label: string;
  suggestions: ConciergeSuggestion[];
}

const SUGGESTION_GROUPS: SuggestionGroup[] = [
  {
    key: 'understand',
    label: 'Understand the plan',
    suggestions: [
      {
        id: 'weekly-review',
        label: 'Review this week\u2019s care plan',
        kind: 'chat',
        prompt:
          'Walk me through this week\u2019s care plan for my patient in plain language: the main goals, what changed recently, and what I should focus on first.',
      },
      {
        id: 'explain-focus',
        label: 'Explain my current care focus items',
        kind: 'chat',
        prompt:
          'Explain my current care focus items: what each one means, why it was raised, and what I should log or watch for next.',
      },
      {
        id: 'understand-goals',
        label: 'What are the goals right now?',
        kind: 'chat',
        prompt:
          'Summarize the active goals on the care plan and what progress toward them looks like this month.',
      },
    ],
  },
  {
    key: 'daily-care',
    label: 'Daily care',
    suggestions: [
      {
        id: 'todays-logging',
        label: 'What should I log today?',
        kind: 'chat',
        prompt:
          'Based on the current care plan and recent patterns, what are the most useful things for me to log today?',
      },
      {
        id: 'watch-today',
        label: 'What should I watch for today?',
        kind: 'chat',
        prompt:
          'Given this patient\u2019s conditions, medications, and care plan, what should I watch for today and when should I escalate?',
      },
      {
        id: 'propose-therapy',
        label: 'Suggest a therapy plan update',
        kind: 'intent',
        intentId: 'propose_therapy_contract_patch',
      },
    ],
  },
  {
    key: 'review-prepare',
    label: 'Review & prepare',
    suggestions: [
      {
        id: 'handoff-summary',
        label: 'Prepare a care-team summary',
        kind: 'chat',
        prompt:
          'Help me prepare a short summary for the care team: recent concerns, what I have been logging, and questions to bring up at the next visit.',
      },
      {
        id: 'review-monitoring',
        label: 'Review monitoring thresholds',
        kind: 'intent',
        intentId: 'review_monitoring_contract',
      },
      {
        id: 'med-questions',
        label: 'Questions about medications',
        kind: 'chat',
        prompt:
          'What are practical, non-dose questions I could ask the care team about the current medications and their watch areas?',
      },
    ],
  },
];

export interface ConciergeSuggestionBoxProps {
  onSendPrompt: (prompt: string) => void;
  onLaunchIntent: (intentId: AdcpProposalIntentId) => void;
  /** Disable all taps while a conversation turn is streaming. */
  disabled?: boolean;
}

export function ConciergeSuggestionBox({
  onSendPrompt,
  onLaunchIntent,
  disabled = false,
}: ConciergeSuggestionBoxProps) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const [cardExpanded, setCardExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const handlePress = (suggestion: ConciergeSuggestion) => {
    if (disabled) return;
    if (suggestion.kind === 'chat' && suggestion.prompt) {
      onSendPrompt(suggestion.prompt);
    } else if (suggestion.kind === 'intent' && suggestion.intentId) {
      onLaunchIntent(suggestion.intentId);
    }
  };

  return (
    <View style={[styles.card, themedStyles.card]} accessible accessibilityLabel="Suggestions">
      <Pressable
        style={styles.cardHeader}
        onPress={() => setCardExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: cardExpanded }}
        accessibilityLabel={`Try asking${cardExpanded ? ' — collapse' : ' — expand'}`}
      >
        <View style={styles.cardHeaderText}>
          <Text style={[styles.title, themedStyles.primaryText]}>Try asking</Text>
          {!cardExpanded ? (
            <Text style={[styles.subtitleCollapsed, themedStyles.mutedText]}>
              Sample prompts by category — tap to expand
            </Text>
          ) : null}
        </View>
        <Text style={[styles.chevron, themedStyles.mutedText]}>{cardExpanded ? '▾' : '▸'}</Text>
      </Pressable>

      {cardExpanded ? (
        <>
          <Text style={[styles.subtitle, themedStyles.mutedText]}>
            A few starting points, grouped so they are easier to scan.
          </Text>
          {SUGGESTION_GROUPS.map((group) => {
            const expanded = Boolean(expandedGroups[group.key]);
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
                  accessibilityLabel={`${group.label}${expanded ? ' — collapse' : ' — expand'}`}
                >
                  <Text style={[styles.groupLabel, themedStyles.primaryText]}>{group.label}</Text>
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
                        accessibilityLabel={suggestion.label}
                      >
                        <Text style={[styles.chipText, themedStyles.chipText]}>{suggestion.label}</Text>
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
});
