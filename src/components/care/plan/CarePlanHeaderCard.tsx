/**
 * Care plan header card (planning/41 §5).
 *
 * "Care plan v{N} · updated {date}" + a "View only" chip in read-only mode.
 * No engineering badges (no "ADCP") per D3. The "What changed" button moves
 * the decision digest out of the main scroll into a modal.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { sectionStyles } from './carePlanSectionStyles';
import type { CarePlanViewModel } from '@/services/carePlan/carePlanViewModel';

export interface CarePlanHeaderCardProps {
  vm: CarePlanViewModel;
  patientName: string;
  patientAge: string;
  primaryDiagnosisLabel: string;
  /** Opens the "What changed" digest modal. Hidden when there is no history. */
  onShowWhatChanged?: () => void;
  whatChangedCount?: number;
}

const SOURCE_LABEL: Record<string, string> = {
  'seed:onboarding': 'Created from onboarding',
  'seed:fhir_import': 'Created from health record import',
  'seed:restore': 'Restored from backup',
  ml_apply: 'Updated by the engines',
  caregiver_confirm: 'Confirmed by you',
  slm_apply_with_hitl: 'Confirmed by you and Concierge',
  unpublished: 'No published plan yet',
};

export function CarePlanHeaderCard({
  vm,
  patientName,
  patientAge,
  primaryDiagnosisLabel,
  onShowWhatChanged,
  whatChangedCount = 0,
}: CarePlanHeaderCardProps) {
  return (
    <View style={styles.card} accessible accessibilityLabel="Care plan header">
      <Text style={styles.eyebrow}>Care plan</Text>
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{vm.versionLabel}</Text>
          <Text style={styles.subtitle}>
            Updated {vm.updatedLabel}
          </Text>
        </View>
        {vm.mode === 'read_only' ? (
          <View style={styles.readOnlyChip} accessibilityLabel="View only mode">
            <Text style={styles.readOnlyChipText}>View only</Text>
          </View>
        ) : null}
      </View>

      <View style={sectionStyles.divider} />

      <View style={sectionStyles.metaRow}>
        <View style={sectionStyles.metaItem}>
          <Text style={sectionStyles.metaLabel}>Patient</Text>
          <Text style={sectionStyles.metaValue}>{patientName}</Text>
        </View>
        <View style={sectionStyles.metaItem}>
          <Text style={sectionStyles.metaLabel}>Age</Text>
          <Text style={sectionStyles.metaValue}>{patientAge}</Text>
        </View>
        <View style={sectionStyles.metaItem}>
          <Text style={sectionStyles.metaLabel}>Primary diagnosis</Text>
          <Text style={sectionStyles.metaValue}>{primaryDiagnosisLabel}</Text>
        </View>
        <View style={sectionStyles.metaItem}>
          <Text style={sectionStyles.metaLabel}>Source</Text>
          <Text style={sectionStyles.metaValue}>
            {SOURCE_LABEL[vm.source] ?? vm.source}
          </Text>
        </View>
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
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 18,
    marginBottom: 14,
    ...AppTheme.shadow,
  },
  eyebrow: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  subtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  readOnlyChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: AppTheme.colors.chip,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  readOnlyChipText: {
    color: AppTheme.colors.textSoft,
    fontSize: 11,
    fontWeight: '900',
  },
  whatChangedButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  whatChangedButtonText: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: '900',
  },
});
