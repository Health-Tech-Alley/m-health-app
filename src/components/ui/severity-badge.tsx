import { StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { severityColor, severityLabel } from '@/constants/user-terms';

export type SeverityBadgeProps = {
  severity: number | null | undefined;
  dotOnly?: boolean;
  label?: string;
};

export function SeverityBadge({ severity, dotOnly, label }: SeverityBadgeProps) {
  const color = severityColor(severity);
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      {!dotOnly && (
        <Text style={[styles.label, { color }]}>{label ?? severityLabel(severity)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
});
