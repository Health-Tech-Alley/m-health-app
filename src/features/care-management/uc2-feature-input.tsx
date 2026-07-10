/**
 * Editor for the full 18-feature UC2 input.
 *
 * Lets the user edit all 13 observed vitals fields (grouped), set the
 * time-of-day that drives the derived hour_sin / hour_cos / is_sleep_window,
 * and toggle any field "missing" so the UC2 imputation path substitutes a
 * default and tags it `imputed` in the feature-quality provenance.
 *
 * Derived features (pulse_pressure, mean_arterial_pressure, hour_sin,
 * hour_cos, is_sleep_window) are computed read-only from the BP inputs +
 * hour, shown live so the user can see what the model actually receives.
 *
 * Themed with AppTheme brand teal to match the rest of the app.
 */
import { StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';

import { AppTheme } from '@/constants/theme';
import type { ExtendedVitals } from '@/ml-models/alert-autoencoder/types';

type Field = keyof ExtendedVitals;

interface FieldMeta {
  label: string;
  unit?: string;
  step?: string;
}

const FIELD_META: Record<Field, FieldMeta> = {
  heart_rate: { label: 'Heart rate', unit: 'bpm' },
  blood_oxygen: { label: 'SpO2', unit: '%' },
  blood_pressure_systolic: { label: 'BP systolic', unit: 'mmHg' },
  blood_pressure_diastolic: { label: 'BP diastolic', unit: 'mmHg' },
  glucose_level: { label: 'Glucose', unit: 'mg/dL' },
  body_temperature: { label: 'Temperature', unit: 'F' },
  respiratory_rate: { label: 'Respiratory rate', unit: '/min' },
  activity_level: { label: 'Activity level', unit: '0-1' },
  sleep_quality: { label: 'Sleep quality', unit: '0-1' },
  stress_level: { label: 'Stress level', unit: '0-1' },
  hrv_sdnn: { label: 'HRV (SDNN)', unit: 'ms' },
  steps_count: { label: 'Steps', unit: '' },
  calories_burned: { label: 'Calories', unit: 'kcal' },
};

const GROUPS: { title: string; fields: Field[] }[] = [
  { title: 'Cardiac', fields: ['heart_rate', 'blood_pressure_systolic', 'blood_pressure_diastolic'] },
  { title: 'Respiratory', fields: ['blood_oxygen', 'respiratory_rate'] },
  { title: 'Metabolic', fields: ['glucose_level', 'body_temperature'] },
  { title: 'Activity / Sleep', fields: ['activity_level', 'sleep_quality', 'stress_level', 'hrv_sdnn', 'steps_count', 'calories_burned'] },
];

export type UC2FeatureInputProps = {
  extended: ExtendedVitals;
  hour: number;
  missingFields: (keyof ExtendedVitals)[];
  onUpdateField: (field: keyof ExtendedVitals, value: number) => void;
  onToggleMissing: (field: keyof ExtendedVitals) => void;
  onSetHour: (hour: number) => void;
  style?: ViewStyle;
};

export function UC2FeatureInput({
  extended,
  hour,
  missingFields,
  onUpdateField,
  onToggleMissing,
  onSetHour,
  style,
}: UC2FeatureInputProps) {
  const missingSet = new Set(missingFields as string[]);
  const pulsePressure = extended.blood_pressure_systolic - extended.blood_pressure_diastolic;
  const map = extended.blood_pressure_diastolic + pulsePressure / 3;
  const hourSin = Math.sin((2 * Math.PI * hour) / 24);
  const hourCos = Math.cos((2 * Math.PI * hour) / 24);
  const isSleep = hour >= 22 || hour <= 6 ? 1 : 0;

  return (
    <View style={[styles.panel, style]}>
      {/* Time of day */}
      <Text style={styles.sectionLabel}>Time of day</Text>
      <View style={styles.hourRow}>
        <TextInput
          style={styles.hourInput}
          value={String(hour)}
          keyboardType="numeric"
          onChangeText={(text) => {
            const n = parseInt(text, 10);
            if (!isNaN(n) && n >= 0 && n <= 23) onSetHour(n);
          }}
          maxLength={2}
        />
        <Text style={styles.muted}>:00 (24h)</Text>
        <Text style={styles.derivedNote}>
          is_sleep_window = {isSleep} · hour_sin = {hourSin.toFixed(2)} · hour_cos = {hourCos.toFixed(2)}
        </Text>
      </View>

      {GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          {group.fields.map((field) => {
            const meta = FIELD_META[field];
            const isMissing = missingSet.has(field as string);
            return (
              <View key={field} style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>{meta.label}</Text>
                <TextInput
                  style={[styles.fieldInput, isMissing && styles.fieldInputMissing]}
                  value={String(extended[field])}
                  keyboardType="numeric"
                  editable={!isMissing}
                  onChangeText={(text) => {
                    const n = parseFloat(text);
                    if (!isNaN(n)) onUpdateField(field, n);
                  }}
                />
                <Text style={styles.muted}>{meta.unit}</Text>
                <Text
                  style={[styles.missingToggle, isMissing && styles.missingToggleActive]}
                  onPress={() => onToggleMissing(field)}>
                  {isMissing ? 'imputed' : 'obs'}
                </Text>
              </View>
            );
          })}
        </View>
      ))}

      {/* Derived features (read-only) */}
      <Text style={styles.sectionLabel}>Derived features (computed)</Text>
      <View style={styles.derivedRow}>
        <Text style={styles.muted}>pulse_pressure</Text>
        <Text style={styles.derivedValue}>{pulsePressure.toFixed(1)}</Text>
      </View>
      <View style={styles.derivedRow}>
        <Text style={styles.muted}>mean_arterial_pressure</Text>
        <Text style={styles.derivedValue}>{map.toFixed(1)}</Text>
      </View>
      <View style={styles.derivedRow}>
        <Text style={styles.muted}>hour_sin / hour_cos</Text>
        <Text style={styles.derivedValue}>{hourSin.toFixed(2)} / {hourCos.toFixed(2)}</Text>
      </View>
      <View style={styles.derivedRow}>
        <Text style={styles.muted}>is_sleep_window</Text>
        <Text style={styles.derivedValue}>{isSleep}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: AppTheme.spacing.sm,
  },
  sectionLabel: {
    color: AppTheme.colors.brand,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: AppTheme.spacing.sm,
  },
  hourRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.sm,
    flexWrap: 'wrap',
  },
  hourInput: {
    width: 56,
    height: 40,
    borderRadius: AppTheme.radius.md,
    paddingHorizontal: AppTheme.spacing.sm,
    fontSize: 15,
    color: AppTheme.colors.text,
    backgroundColor: AppTheme.colors.screen,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    textAlign: 'center',
  },
  group: {
    gap: 4,
    marginTop: 2,
  },
  groupTitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.sm,
  },
  fieldLabel: {
    width: 120,
    color: AppTheme.colors.text,
    fontSize: 13,
  },
  fieldInput: {
    width: 80,
    height: 38,
    borderRadius: AppTheme.radius.md,
    paddingHorizontal: AppTheme.spacing.sm,
    fontSize: 14,
    color: AppTheme.colors.text,
    backgroundColor: AppTheme.colors.screen,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  fieldInputMissing: {
    backgroundColor: AppTheme.colors.chip,
    color: AppTheme.colors.textMuted,
  },
  muted: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
  },
  derivedNote: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
    flex: 1,
  },
  missingToggle: {
    fontSize: 10,
    fontWeight: '800',
    color: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: AppTheme.radius.sm,
    overflow: 'hidden',
  },
  missingToggleActive: {
    color: AppTheme.colors.warning,
    backgroundColor: AppTheme.colors.warningSoft,
  },
  derivedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  derivedValue: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});
