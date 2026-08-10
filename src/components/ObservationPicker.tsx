/**
 * Shared multi-select chip picker for the UC2 caregiver observation codes.
 *
 * Renders the taxonomy in plain-language categories with title-case labels
 * (no underscores). Categories are collapsed by default. Used by Care
 * Management, alert detail, Concierge chat, and in-card rehab explain HITL.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import type { TranslateFn, TranslationKey } from '@/localization/i18n';
import { CAREGIVER_OBSERVATION_CODES } from '@/ml-models/uc2-decision-layer';

export type ObservationPickerProps = {
  selected: string[];
  onChange: (codes: string[]) => void;
  enabled?: boolean;
};

const FRIENDLY_LABEL_KEYS: Record<string, TranslationKey> = {
  EXERCISE_ACTIVITY: 'observation.code.exerciseActivity',
  POOR_SLEEP: 'observation.code.poorSleep',
  STRESS: 'observation.code.stress',
  LOW_INTAKE: 'observation.code.lowIntake',
  MED_CHANGE: 'observation.code.medicationChange',
  BATHROOM_CHANGE: 'observation.code.bathroomChange',
  VOMITING_DIARRHEA: 'observation.code.vomitingDiarrhea',
  WEAK_CONFUSED: 'observation.code.weakConfused',
  PAIN: 'observation.code.pain',
  BREATHING_CHANGE: 'observation.code.breathingChange',
  SENSOR_ISSUE: 'observation.code.sensorIssue',
  NOTHING_UNUSUAL: 'observation.code.nothingUnusual',
  NOT_SURE: 'observation.code.notSure',
};

type ObservationCategory = {
  key: string;
  labelKey: TranslationKey;
  codes: readonly string[];
};

const OBSERVATION_CATEGORIES: ObservationCategory[] = [
  {
    key: 'daily',
    labelKey: 'observation.category.daily',
    codes: ['EXERCISE_ACTIVITY', 'POOR_SLEEP', 'STRESS', 'LOW_INTAKE'],
  },
  {
    key: 'body',
    labelKey: 'observation.category.body',
    codes: ['PAIN', 'BREATHING_CHANGE', 'WEAK_CONFUSED', 'VOMITING_DIARRHEA', 'BATHROOM_CHANGE'],
  },
  {
    key: 'care',
    labelKey: 'observation.category.care',
    codes: ['MED_CHANGE', 'SENSOR_ISSUE'],
  },
  {
    key: 'overall',
    labelKey: 'observation.category.overall',
    codes: ['NOTHING_UNUSUAL', 'NOT_SURE'],
  },
];

function labelForCode(code: string, t: TranslateFn): string {
  const key = FRIENDLY_LABEL_KEYS[code];
  if (key) return t(key);
  return code
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function ObservationPicker({ selected, onChange, enabled = true }: ObservationPickerProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const selectedSet = new Set(selected);
  const known = new Set(OBSERVATION_CATEGORIES.flatMap((c) => [...c.codes]));
  const extras = CAREGIVER_OBSERVATION_CODES.filter((code) => !known.has(code));
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const toggle = (code: string) => {
    if (!enabled) return;
    if (selectedSet.has(code)) {
      onChange(selected.filter((c) => c !== code));
    } else {
      onChange([...selected, code]);
    }
  };

  const toggleCategory = (key: string) => {
    setExpandedCategories((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const selectedCountIn = (codes: readonly string[]) =>
    codes.reduce((count, code) => count + (selectedSet.has(code) ? 1 : 0), 0);

  const renderChip = (code: string) => {
    const active = selectedSet.has(code);
    return (
      <Pressable
        key={code}
        onPress={() => toggle(code)}
        disabled={!enabled}
        style={[
          styles.chip,
          active ? styles.chipActive : styles.chipIdle,
          !active && themedStyles.chipIdle,
          !enabled && styles.chipDisabled,
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: active, disabled: !enabled }}
        accessibilityLabel={labelForCode(code, t)}
      >
        <Text
          style={[
            styles.chipText,
            active ? styles.chipTextActive : styles.chipTextIdle,
            !active && themedStyles.chipTextIdle,
          ]}
        >
          {labelForCode(code, t)}
        </Text>
      </Pressable>
    );
  };

  const renderCategory = (key: string, label: string, codes: readonly string[]) => {
    const expanded = Boolean(expandedCategories[key]);
    const selectedCount = selectedCountIn(codes);
    return (
      <View key={key} style={styles.category}>
        <Pressable
          style={styles.categoryHeader}
          onPress={() => toggleCategory(key)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${label} - ${expanded ? t('common.collapse') : t('common.expand')}`}
        >
          <Text style={[styles.categoryLabel, themedStyles.categoryLabel]}>{label}</Text>
          <Text style={[styles.categoryMeta, themedStyles.categoryMeta]}>
            {selectedCount > 0 ? `${t('observation.selectedCount', { count: selectedCount })} \u00b7 ` : ''}
            {expanded ? '\u25be' : '\u25b8'}
          </Text>
        </Pressable>
        {expanded ? <View style={styles.grid}>{codes.map(renderChip)}</View> : null}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      {OBSERVATION_CATEGORIES.map((category) =>
        renderCategory(category.key, t(category.labelKey), category.codes),
      )}
      {extras.length > 0 ? renderCategory('other', t('observation.category.other'), extras) : null}
    </View>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    categoryLabel: {
      color: theme.appText,
    },
    categoryMeta: {
      color: theme.appTextMuted,
    },
    chipIdle: {
      backgroundColor: theme.appControlSurface,
      borderColor: theme.appBorder,
    },
    chipTextIdle: {
      color: theme.appTextSupporting,
    },
  });
}

const styles = StyleSheet.create({
  root: {
    gap: AppTheme.spacing.sm,
  },
  category: {
    gap: 6,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 34,
    paddingVertical: 4,
  },
  categoryLabel: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '900',
    flex: 1,
  },
  categoryMeta: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: AppTheme.spacing.sm,
  },
  chip: {
    paddingHorizontal: AppTheme.spacing.md,
    paddingVertical: AppTheme.spacing.sm,
    borderRadius: AppTheme.radius.pill,
    borderWidth: 1,
  },
  chipIdle: {
    backgroundColor: AppTheme.colors.chip,
    borderColor: AppTheme.colors.border,
  },
  chipActive: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  chipTextIdle: {
    color: AppTheme.colors.textSoft,
  },
  chipTextActive: {
    color: AppTheme.colors.white,
  },
});
