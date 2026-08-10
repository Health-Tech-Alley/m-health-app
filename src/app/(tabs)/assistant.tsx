/**
 * Assistant tab — the caregiver SLM prompt interface as a main-nav tab.
 *
 * Renders the shared SLM chat screen (`src/app/slm.tsx`) without the stack
 * "← Back" button so it behaves as a persistent tab rather than a pushed
 * screen. When the on-device Concierge model is not downloaded, the tab is
 * greyed out with an optional download prompt (doc 26 §7.3) so vitals-only
 * testing is unaffected.
 */

import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OptionalFeaturePrompt } from '@/components/optional-feature-prompt';
import { AppTheme } from '@/constants/theme';
import { useOptionalFeatureGate } from '@/hooks/useOptionalFeatureGate';
import { useTranslation } from '@/hooks/use-translation';

import SlmScreen from "../slm";

export default function AssistantTab() {
  const gate = useOptionalFeatureGate('slm');
  const { t } = useTranslation();

  if (!gate.ready) {
    return (
      <SafeAreaView style={styles.greyed} edges={['top']}>
        <View style={styles.headerBlock}>
          <Text style={styles.eyebrow}>{t('assistant.gate.eyebrow')}</Text>
          <Text style={styles.title}>{t('assistant.gate.title')}</Text>
          <Text style={styles.subtitle}>
            {t('assistant.gate.subtitle')}
          </Text>
        </View>
        <OptionalFeaturePrompt requirement="slm" simulatedMissing={gate.simulatedMissing} />
        <Text style={styles.hint}>
          {t('assistant.gate.hint')}
        </Text>
      </SafeAreaView>
    );
  }

  return <SlmScreen showBackButton={false} />;
}

const styles = StyleSheet.create({
  greyed: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 16,
  },
  headerBlock: {
    gap: 6,
    marginBottom: 8,
  },
  eyebrow: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: AppTheme.colors.sectionText,
    fontSize: 20,
    fontWeight: '900',
  },
  subtitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
  },
  hint: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
});
