/**
 * Care plan "Safety" section (planning/41 §5).
 *
 * Reads pre-collected safety lines from the view-model. Each line has a
 * kind tag (always / never / note) so the visual rhythm matches the
 * "always/never do" framing used by doc 39.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/AppIcon';
import { AppTheme } from '@/constants/theme';
import { sectionStyles } from './carePlanSectionStyles';
import type { CarePlanSafetyLine } from '@/services/carePlan/carePlanViewModel';

export interface CarePlanSafetySectionProps {
  lines: CarePlanSafetyLine[];
  onExplainLine?: (line: CarePlanSafetyLine) => void;
}

const KIND_PREFIX: Record<CarePlanSafetyLine['kind'], string> = {
  always: 'Always',
  never: 'Never',
  note: '',
};

export function CarePlanSafetySection({ lines, onExplainLine }: CarePlanSafetySectionProps) {
  if (lines.length === 0) {
    return (
      <View style={sectionStyles.card}>
      <View style={sectionStyles.headerRow}>
        <AppIcon name="heart" size={18} color={AppTheme.colors.brand} />
        <Text style={sectionStyles.title}>Safety</Text>
      </View>
      <Text style={sectionStyles.bodyMuted}>
        No safety considerations are recorded yet. Concierge will surface one when you import a health record.
      </Text>
      </View>
    );
  }

  return (
    <View style={sectionStyles.card} accessible accessibilityLabel="Safety considerations">
      <View style={sectionStyles.headerRow}>
        <AppIcon name="heart" size={18} color={AppTheme.colors.brand} />
        <Text style={sectionStyles.title}>Safety</Text>
      </View>
      <Text style={sectionStyles.subtitle}>
        Always/never rules + any safety notes. Tap to ask Concierge for a plain-language explanation.
      </Text>
      {lines.map((line, idx) => (
        <Pressable
          key={`${line.kind}-${idx}`}
          style={({ pressed }) => [sectionStyles.listRow, pressed && styles.pressed]}
          onPress={() => onExplainLine?.(line)}
          accessibilityRole="button"
          accessibilityLabel={`Safety line: ${KIND_PREFIX[line.kind] ? `${KIND_PREFIX[line.kind]}: ` : ''}${line.text}`}
        >
          <Text style={styles.bullet}>
            {line.kind === 'always' ? '\u2713' : line.kind === 'never' ? '\u2715' : '\u2022'}
          </Text>
          <Text style={sectionStyles.listText}>
            {KIND_PREFIX[line.kind] ? `${KIND_PREFIX[line.kind]}: ` : ''}
            {line.text}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bullet: {
    color: AppTheme.colors.brand,
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
    width: 16,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
