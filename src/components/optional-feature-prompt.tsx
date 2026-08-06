/**
 * Optional download prompt for SLM / knowledge-cache dependent surfaces.
 *
 * Replaces the old hard lockout: Dismiss keeps the user where they are with
 * the feature disabled; Download navigates to the Models screen (SLM) or
 * Settings → Clinical knowledge. See planning/in-progress/26 §7.3.
 */

import { useState } from 'react';

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AppTheme } from '@/constants/theme';
import type { OptionalFeatureRequirements } from '@/hooks/useOptionalFeatureGate';

const COPY: Record<
  OptionalFeatureRequirements,
  { title: string; body: string }
> = {
  slm: {
    title: 'Concierge is not downloaded yet',
    body: 'The Concierge needs an on-device AI model for chat, explanations, and medication checks. Download it from Models to enable this feature — everything else in the app works without it.',
  },
  knowledge: {
    title: 'Clinical knowledge is not downloaded yet',
    body: 'Clinical evidence packs power grounded, cited answers in Concierge flows. Download them from Settings → Clinical knowledge to enable this feature — everything else in the app works without it.',
  },
  both: {
    title: 'Concierge is not downloaded yet',
    body: 'The Concierge uses an on-device AI model plus clinical knowledge packs to explain alerts, check medications, and support the care plan with cited answers. Both are optional — download them from Models and Settings → Clinical knowledge. Everything else in the app works without them.',
  },
};

export function OptionalFeaturePrompt({
  requirement,
  onDismiss,
}: {
  requirement: OptionalFeatureRequirements;
  /** When provided, Dismiss calls this (e.g. close a modal sheet) instead of hiding the prompt in place. */
  onDismiss?: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const copy = COPY[requirement];
  const handleDismiss = onDismiss ?? (() => setDismissed(true));

  return (
    <View style={styles.prompt}>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={handleDismiss}
          style={[styles.button, styles.buttonGhost]}
        >
          <Text style={styles.buttonGhostText}>Dismiss</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(requirement === 'knowledge' ? '/settings' : '/models')}
          style={[styles.button, styles.buttonPrimary]}
        >
          <Text style={styles.buttonPrimaryText}>Download</Text>
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
