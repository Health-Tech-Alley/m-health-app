/**
 * Compact active care plan summary for the Care tab.
 *
 * Keeps plan version/source data in the view model while avoiding repeated
 * patient details that already appear in the screen header.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { sectionStyles } from './carePlanSectionStyles';
import type { CarePlanViewModel } from '@/services/carePlan/carePlanViewModel';

export interface CarePlanHeaderCardProps {
  vm: CarePlanViewModel;
  /** Opens the "What changed" digest modal. Hidden when there is no history. */
  onShowWhatChanged?: () => void;
  whatChangedCount?: number;
}

const SOURCE_LABEL: Record<string, string> = {
  'seed:onboarding': 'Created from onboarding',
  'seed:fhir_import': 'Personalized + Health Record',
  'seed:restore': 'Restored from backup',
  ml_apply: 'Personalized + Health Record',
  caregiver_confirm: 'Personalized + Health Record',
  slm_apply_with_hitl: 'Personalized + Health Record',
  unpublished: 'No published plan yet',
};

export function CarePlanHeaderCard({
  vm,
  onShowWhatChanged,
  whatChangedCount = 0,
}: CarePlanHeaderCardProps) {
  const updatedText = formatUpdatedLabel(vm.updatedLabel);
  const sourceLabel = SOURCE_LABEL[vm.source] ?? vm.source;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={[sectionStyles.title, styles.headerTitle]}>Active care plan</Text>
        <Text style={styles.updatedText}>{updatedText}</Text>
      </View>
      <View style={styles.summaryRow}>
        <View style={styles.sourceChip} accessibilityLabel={`Care plan source: ${sourceLabel}`}>
          <Text style={styles.sourceChipText}>{sourceLabel}</Text>
        </View>
        {onShowWhatChanged && whatChangedCount > 0 ? (
          <Pressable
            style={styles.whatChangedButton}
            onPress={onShowWhatChanged}
            accessibilityRole="button"
            accessibilityLabel={`What changed, ${whatChangedCount} recent decisions`}
          >
            <Text style={styles.whatChangedButtonText}>
              What changed ({whatChangedCount})
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function formatUpdatedLabel(value: string): string {
  if (!value || value === 'Not published yet') return 'Not published yet';
  const date = parseDateOnly(value);
  if (!date) return `Updated ${value}`;
  const today = new Date();
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return 'Updated today';
  }
  return `Updated ${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}.`;
}

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return new Date(year, month - 1, day);
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 14,
    marginBottom: 14,
    ...AppTheme.shadow,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  headerTitle: {
    flexShrink: 0,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  updatedText: {
    marginLeft: 'auto',
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  sourceChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: AppTheme.colors.brandSoft,
  },
  sourceChipText: {
    color: AppTheme.colors.brand,
    fontSize: 11,
    fontWeight: '900',
  },
  whatChangedButton: {
    marginLeft: 'auto',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  whatChangedButtonText: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: '900',
  },
});
