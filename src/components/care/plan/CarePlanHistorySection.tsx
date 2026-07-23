/**
 * Care plan "What changed" section (planning/41 §5).
 *
 * Shows the recent decision-log digest for the active patient. Each entry
 * is a single line with the timestamp + summary; the audit log viewer in
 * Settings has the full chain.
 */

import { StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { sectionStyles } from './carePlanSectionStyles';
import type { CarePlanHistoryItem } from '@/services/carePlan/carePlanViewModel';

export interface CarePlanHistorySectionProps {
  items: CarePlanHistoryItem[];
}

export function CarePlanHistorySection({ items }: CarePlanHistorySectionProps) {
  return (
    <View style={sectionStyles.card} accessible accessibilityLabel="Care plan history">
      <View style={sectionStyles.headerRow}>
        <Text style={sectionStyles.title}>Recent changes</Text>
        <View style={sectionStyles.pill}>
          <Text style={sectionStyles.pillText}>{items.length}</Text>
        </View>
      </View>
      <Text style={sectionStyles.subtitle}>
        Recent plan decisions (proposals, confirmations, ML applies).
      </Text>
      {items.map((item) => (
        <View key={item.id} style={sectionStyles.listRow}>
          <Text style={sectionStyles.listBullet}>{'\u2022'}</Text>
          <View style={styles.textBlock}>
            <Text style={sectionStyles.listText}>{item.summary}</Text>
            <Text style={styles.at}>{item.at.slice(0, 10)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  textBlock: {
    flex: 1,
  },
  at: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
});
