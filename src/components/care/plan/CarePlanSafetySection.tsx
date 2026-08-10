/**
 * Care plan "Safety" section (planning/41 §5).
 *
 * Reads pre-collected safety lines from the view-model. Each line has a
 * kind tag (always / never / note) so the visual rhythm matches the
 * "always/never do" framing used by doc 39.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/AppIcon';
import { AppTheme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { createThemedSectionStyles } from './carePlanSectionStyles';
import type { CarePlanSafetyLine } from '@/services/carePlan/carePlanViewModel';

export interface CarePlanSafetySectionProps {
  lines: CarePlanSafetyLine[];
  onExplainLine?: (line: CarePlanSafetyLine) => void;
}

export function CarePlanSafetySection({ lines, onExplainLine }: CarePlanSafetySectionProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const sectionStyles = useMemo(() => createThemedSectionStyles(theme), [theme]);
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const iconColor =
    theme.appBackground === '#000000' ? AppTheme.colors.brandPale : AppTheme.colors.brand;
  const kindPrefix = (kind: CarePlanSafetyLine['kind']) => {
    if (kind === 'always') return t('care.safety.always');
    if (kind === 'never') return t('care.safety.never');
    return '';
  };

  if (lines.length === 0) {
    return (
      <View style={sectionStyles.card}>
        <View style={sectionStyles.headerRow}>
          <AppIcon name="heart" size={18} color={iconColor} />
          <Text style={sectionStyles.title}>{t('care.safety.title')}</Text>
        </View>
        <Text style={sectionStyles.bodyMuted}>{t('care.safety.empty')}</Text>
      </View>
    );
  }

  return (
    <View style={sectionStyles.card} accessible accessibilityLabel={t('care.safety.accessibilityLabel')}>
      <View style={sectionStyles.headerRow}>
        <AppIcon name="heart" size={18} color={iconColor} />
        <Text style={sectionStyles.title}>{t('care.safety.title')}</Text>
      </View>
      <Text style={sectionStyles.subtitle}>{t('care.safety.subtitle')}</Text>
      {lines.map((line, idx) => (
        <Pressable
          key={`${line.kind}-${idx}`}
          style={({ pressed }) => [sectionStyles.listRow, pressed && styles.pressed]}
          onPress={() => onExplainLine?.(line)}
          accessibilityRole="button"
          accessibilityLabel={t('care.safety.lineA11y', {
            prefix: kindPrefix(line.kind) ? `${kindPrefix(line.kind)}: ` : '',
            text: line.text,
          })}
        >
          <Text style={[styles.bullet, themedStyles.bullet]}>
            {line.kind === 'always' ? '\u2713' : line.kind === 'never' ? '\u2715' : '\u2022'}
          </Text>
          <Text style={sectionStyles.listText}>
            {kindPrefix(line.kind) ? `${kindPrefix(line.kind)}: ` : ''}
            {line.text}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    bullet: {
      color:
        theme.appBackground === '#000000' ? AppTheme.colors.brandPale : AppTheme.colors.brand,
    },
  });
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
