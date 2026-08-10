/**
 * "The Concierge suggests. You decide." tagline component.
 *
 * Per planning/29_hitl-promotion-plan.md: reinforce HITL on every screen
 * that surfaces an AI-proposed explanation or next-step. Renders as a
 * subtle caption with a small human/handshake glyph, not a banner.
 */

import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';

type Variant = 'muted' | 'inverse' | 'outline';

type Props = {
  variant?: Variant;
  /** "Concierge" by default; pass 'ML' or 'orchestrator' to swap label. */
  source?: string;
};

export function AiSuggestsTagline({ variant = 'muted', source = 'Concierge' }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const sourceLabel = source === 'Concierge' ? t('assistant.term.concierge') : source;

  const palette =
    variant === 'inverse'
      ? { fg: '#FFFFFF', bg: 'rgba(255,255,255,0.12)' }
      : variant === 'outline'
        ? { fg: '#526866', bg: '#FFFFFF' }
        : { fg: theme.textSecondary, bg: theme.backgroundElement };

  return (
    <View style={[styles.wrap, { backgroundColor: palette.bg }]}>
      <Text style={[styles.dot, { color: palette.fg }]}>•</Text>
      <Text style={[styles.text, { color: palette.fg }]}>
        {t('assistant.tagline', { source: sourceLabel })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    alignSelf: 'flex-start',
    gap: 6,
  },
  dot: { fontSize: 18, lineHeight: 18, fontWeight: '900' },
  text: { fontSize: 12, fontWeight: '600', fontStyle: 'italic' },
});
