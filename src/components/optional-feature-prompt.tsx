/**
 * Optional download prompt for SLM / knowledge-cache dependent surfaces.
 *
 * Replaces the old hard lockout: Dismiss keeps the user where they are with
 * the feature disabled; Download navigates to the Models screen (SLM) or
 * Settings → Clinical knowledge. See planning/in-progress/26 §7.3.
 */

import { useMemo, useState } from 'react';

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AppTheme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { OptionalFeatureRequirements } from '@/hooks/useOptionalFeatureGate';
import { useTranslation } from '@/hooks/use-translation';
import { getPromptCopy } from './optional-feature-prompt-copy';

export function OptionalFeaturePrompt({
  requirement,
  onDismiss,
  simulatedMissing = false,
}: {
  requirement: OptionalFeatureRequirements;
  /** When provided, Dismiss calls this (e.g. close a modal sheet) instead of hiding the prompt in place. */
  onDismiss?: () => void;
  /**
   * When true, the developer flag "Simulate missing Concierge / knowledge"
   * is masking a real download — say so instead of telling the user to
   * download a model that is already installed.
   */
  simulatedMissing?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.appBackground === '#000000';
  const themedStyles = useMemo(
    () =>
      isDark
        ? {
            prompt: {
              backgroundColor: theme.appSurface,
              borderColor: theme.appBorder,
            },
            title: { color: theme.appSectionText },
            body: { color: theme.appTextMuted },
            buttonGhost: {
              backgroundColor: theme.appControlSurface,
              borderColor: theme.appBorder,
            },
            buttonPrimary: { backgroundColor: theme.appBrandSoftSurface },
            buttonGhostText: { color: theme.appTextSupporting },
            buttonPrimaryText: { color: AppTheme.colors.brandPale },
          }
        : {},
    [isDark, theme],
  );
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const copy = getPromptCopy(requirement, simulatedMissing, t);
  const handleDismiss = onDismiss ?? (() => setDismissed(true));
  const primaryLabel = simulatedMissing
    ? t('optionalFeaturePrompt.openSettings')
    : t('optionalFeaturePrompt.download');

  return (
    <View style={[styles.prompt, themedStyles.prompt]}>
      <Text style={[styles.title, themedStyles.title]}>{copy.title}</Text>
      <Text style={[styles.body, themedStyles.body]}>{copy.body}</Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={handleDismiss}
          style={[styles.button, styles.buttonGhost, themedStyles.buttonGhost]}
        >
          <Text style={[styles.buttonGhostText, themedStyles.buttonGhostText]}>{t('common.dismiss')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          onPress={() =>
            router.push(
              simulatedMissing
                ? '/settings'
                : requirement === 'knowledge'
                  ? '/settings'
                  : '/models',
            )
          }
          style={[styles.button, styles.buttonPrimary, themedStyles.buttonPrimary]}
        >
          <Text style={[styles.buttonPrimaryText, themedStyles.buttonPrimaryText]}>{primaryLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  prompt: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 18,
    gap: 10,
  },
  title: {
    color: AppTheme.colors.sectionText,
    fontSize: 15,
    fontWeight: '900',
  },
  body: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  button: {
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonGhost: {
    backgroundColor: AppTheme.colors.surface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  buttonPrimary: {
    backgroundColor: AppTheme.colors.brand,
  },
  buttonGhostText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: '800',
  },
  buttonPrimaryText: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: '800',
  },
});
