import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import type { LatestUc4PriorityCardSummary } from '@/data/types';
import type { Uc4CardResponseAction } from '@/services/uc4/uc4EvaluationService';

type Uc4PriorityCardProps = {
  card: LatestUc4PriorityCardSummary;
  onExplain?: (card: LatestUc4PriorityCardSummary) => void;
  onRespond?: (
    card: LatestUc4PriorityCardSummary,
    action: Uc4CardResponseAction,
    payload: {
      observationCodes: string[];
      contextCodes: string[];
      caregiverRequestedProviderReview: boolean;
    },
  ) => void;
};

const CONTEXT_OPTIONS = new Set([
  'DURING_TRANSFER',
  'WHILE_SITTING_OR_POSITIONED',
  'AFTER_ACTIVITY_OR_THERAPY',
  'AROUND_MEDICATION_TIME',
  'DURING_SLEEP_OR_NIGHT',
  'MEAL_OR_HYDRATION_RELATED',
  'BATHROOM_OR_BOWEL_BLADDER',
  'UNKNOWN_OR_NOT_SURE',
]);

function humanize(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase();
}

export function Uc4PriorityCard({ card, onExplain, onRespond }: Uc4PriorityCardProps) {
  const [selectedOptions, setSelectedOptions] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState(false);

  const toggleOption = (fieldId: string, option: string) => {
    setSelectedOptions((current) => ({
      ...current,
      [`${fieldId}:${option}`]: !current[`${fieldId}:${option}`],
    }));
  };

  const submit = (action: Uc4CardResponseAction) => {
    const selected = Object.entries(selectedOptions)
      .filter(([, selected]) => selected)
      .map(([key]) => key.split(':').slice(1).join(':'))
      .filter(Boolean);
    const contextCodes = selected.filter((option) => CONTEXT_OPTIONS.has(option));
    const observationCodes = selected.filter(
      (option) => /^[A-Z0-9_]+$/.test(option) && !CONTEXT_OPTIONS.has(option) && option !== 'YES' && option !== 'NO',
    );
    onRespond?.(card, action, {
      observationCodes,
      contextCodes,
      caregiverRequestedProviderReview:
        action === 'provider_review_requested' ||
        observationCodes.includes('CAREGIVER_WANTS_PROVIDER_REVIEW'),
    });
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>Care focus</Text>
          <Text style={styles.title}>{card.title}</Text>
        </View>
        <Text style={styles.score}>{Math.round(card.score * 100)}%</Text>
      </View>

      <Text style={styles.body} numberOfLines={expanded ? undefined : 3}>
        {card.body}
      </Text>
      {card.body.length > 150 ? (
        <Pressable onPress={() => setExpanded((current) => !current)}>
          <Text style={styles.expand}>{expanded ? 'Show less' : 'Show more'}</Text>
        </Pressable>
      ) : null}

      <Text style={styles.safety}>{card.safetyBoundary}</Text>

      {card.whatToLogNextSchema.length > 0 ? (
        <View style={styles.logNext}>
          <Text style={styles.logNextTitle}>What to log next</Text>
          {card.whatToLogNextSchema.map((field) => (
            <View key={field.fieldId} style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              <View style={styles.optionWrap}>
                {(field.options ?? []).map((option) => {
                  const key = `${field.fieldId}:${option}`;
                  const active = Boolean(selectedOptions[key]);
                  return (
                    <Pressable
                      key={option}
                      style={[styles.optionChip, active && styles.optionChipActive]}
                      onPress={() => toggleOption(field.fieldId, option)}
                    >
                      <Text style={[styles.optionText, active && styles.optionTextActive]}>
                        {humanize(option)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {onRespond ? (
        <View style={styles.actions}>
          <Pressable style={styles.primaryButton} onPress={() => submit('caregiver_response_submitted')}>
            <Text style={styles.primaryButtonText}>Save log</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => submit('acknowledged')}>
            <Text style={styles.secondaryButtonText}>Got it</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => submit('provider_review_requested')}>
            <Text style={styles.secondaryButtonText}>Provider review</Text>
          </Pressable>
          <Pressable style={styles.dismissButton} onPress={() => submit('dismissed')}>
            <Text style={styles.dismissButtonText}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}
      {onExplain ? (
        <Pressable style={styles.explainButton} onPress={() => onExplain(card)}>
          <Text style={styles.explainButtonText}>Explain this result</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: 12,
    backgroundColor: AppTheme.colors.white,
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  kicker: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    marginTop: 3,
  },
  score: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: '900',
  },
  body: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  expand: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: '900',
  },
  safety: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  logNext: {
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    paddingTop: 10,
    gap: 8,
  },
  logNextTitle: {
    color: AppTheme.colors.text,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  fieldBlock: {
    gap: 6,
  },
  fieldLabel: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: '800',
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  optionChip: {
    borderRadius: 999,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  optionChipActive: {
    backgroundColor: AppTheme.colors.brandSoft,
  },
  optionText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  optionTextActive: {
    color: AppTheme.colors.brand,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 4,
  },
  primaryButton: {
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryButtonText: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: '900',
  },
  secondaryButton: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: '900',
  },
  dismissButton: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dismissButtonText: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '900',
  },
  explainButton: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    backgroundColor: AppTheme.colors.brand,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  explainButtonText: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: '900',
  },
});
