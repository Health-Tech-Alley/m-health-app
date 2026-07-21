/**
 * Care plan "Monitoring" section (planning/41 §5).
 *
 * Always visible. Wraps the existing ObservationVitalsCard and adds a
 * thresholds summary above it when thresholds are configured.
 */

import { StyleSheet, Text, View } from 'react-native';

import { ObservationVitalsCard } from '@/components/care/ObservationVitalsCard';
import { AppTheme } from '@/constants/theme';
import { sectionStyles } from './carePlanSectionStyles';
import type { Threshold } from '@/data/types';

export interface CarePlanMonitoringSectionProps {
  thresholds: Threshold[];
}

const VITAL_LABEL: Record<string, string> = {
  spo2: 'Oxygen (SpO2)',
  heart_rate: 'Heart rate',
  respiratory_rate: 'Respiratory rate',
  blood_pressure_systolic: 'Blood pressure (top)',
  blood_pressure_diastolic: 'Blood pressure (bottom)',
  temperature: 'Temperature',
  blood_glucose: 'Glucose',
};

function describeThreshold(t: Threshold): string {
  const vital = VITAL_LABEL[t.vitalType] ?? t.vitalType;
  const direction = t.direction === 'above' ? 'over' : 'under';
  return `${vital} ${direction} ${t.value}`;
}

export function CarePlanMonitoringSection({ thresholds }: CarePlanMonitoringSectionProps) {
  return (
    <View style={sectionStyles.card} accessible accessibilityLabel="Monitoring">
      <View style={sectionStyles.headerRow}>
        <Text style={sectionStyles.title}>Monitoring</Text>
        <View style={sectionStyles.pill}>
          <Text style={sectionStyles.pillText}>{thresholds.length}</Text>
        </View>
      </View>
      <Text style={sectionStyles.subtitle}>
        Latest vitals + the thresholds the app is using to surface alerts.
      </Text>

      {thresholds.length > 0 ? (
        <View style={styles.thresholdList}>
          {thresholds.slice(0, 6).map((t) => (
            <View key={t.thresholdId} style={styles.thresholdRow}>
              <View style={styles.thresholdDot} />
              <Text style={styles.thresholdText}>{describeThreshold(t)}</Text>
            </View>
          ))}
          {thresholds.length > 6 ? (
            <Text style={sectionStyles.bodyMuted}>
              +{thresholds.length - 6} more in the alert settings.
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={sectionStyles.bodyMuted}>
          No thresholds are configured yet. Alerts will use safe defaults.
        </Text>
      )}

      <View style={sectionStyles.divider} />
      <ObservationVitalsCard />
    </View>
  );
}

const styles = StyleSheet.create({
  thresholdList: {
    gap: 6,
    marginVertical: 4,
  },
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  thresholdDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: AppTheme.colors.brand,
  },
  thresholdText: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
});
