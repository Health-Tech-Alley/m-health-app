/**
 * Shared multi-select chip picker for the UC2 caregiver observation codes.
 *
 * Used by the Care Management analysis harness (and, later, the alert-detail
 * HITL flow). Renders the 13-code taxonomy from the UC2 decision layer as
 * toggleable chips, themed with AppTheme brand teal.
 */
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { CAREGIVER_OBSERVATION_CODES } from '@/ml-models/uc2-decision-layer';

export type ObservationPickerProps = {
  selected: string[];
  onChange: (codes: string[]) => void;
  enabled?: boolean;
};

const FRIENDLY_LABEL: Record<string, string> = {
  EXERCISE_ACTIVITY: 'Exercise / activity',
  POOR_SLEEP: 'Poor sleep',
  STRESS: 'Stress',
  LOW_INTAKE: 'Low intake',
  MED_CHANGE: 'Med change',
  BATHROOM_CHANGE: 'Bathroom change',
  VOMITING_DIARRHEA: 'Vomiting / diarrhea',
  WEAK_CONFUSED: 'Weak / confused',
  PAIN: 'Pain',
  BREATHING_CHANGE: 'Breathing change',
  SENSOR_ISSUE: 'Sensor issue',
  NOTHING_UNUSUAL: 'Nothing unusual',
  NOT_SURE: 'Not sure',
};

export function ObservationPicker({ selected, onChange, enabled = true }: ObservationPickerProps) {
  const selectedSet = new Set(selected);

  const toggle = (code: string) => {
    if (!enabled) return;
    if (selectedSet.has(code)) {
      onChange(selected.filter((c) => c !== code));
    } else {
      onChange([...selected, code]);
    }
  };

  return (
    <ScrollView
      horizontal={false}
      contentContainerStyle={styles.grid}
    >
      {CAREGIVER_OBSERVATION_CODES.map((code) => {
        const active = selectedSet.has(code);
        return (
          <Pressable
            key={code}
            onPress={() => toggle(code)}
            disabled={!enabled}
            style={[
              styles.chip,
              active ? styles.chipActive : styles.chipIdle,
              !enabled && styles.chipDisabled,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                active ? styles.chipTextActive : styles.chipTextIdle,
              ]}
            >
              {FRIENDLY_LABEL[code] ?? code}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
