/**
 * Optional-feature prompt copy — pure module so the wording is unit-testable
 * without importing expo-router / react-native (jest transform limits).
 */

import type { OptionalFeatureRequirements } from '@/hooks/useOptionalFeatureGate';
import type { TranslationKey, TranslateFn } from '@/localization/i18n';

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

const COPY_KEYS: Record<
  OptionalFeatureRequirements,
  { title: TranslationKey; body: TranslationKey }
> = {
  slm: {
    title: 'optionalFeaturePrompt.slm.title',
    body: 'optionalFeaturePrompt.slm.body',
  },
  knowledge: {
    title: 'optionalFeaturePrompt.knowledge.title',
    body: 'optionalFeaturePrompt.knowledge.body',
  },
  both: {
    title: 'optionalFeaturePrompt.both.title',
    body: 'optionalFeaturePrompt.both.body',
  },
};

/**
 * Resolve the prompt copy for a requirement.
 * When `simulatedMissing` is true, the developer flag "Simulate missing
 * Concierge / knowledge" is masking a real download — say so instead of
 * telling the user to download a model that is already installed.
 */
export function getPromptCopy(
  requirement: OptionalFeatureRequirements,
  simulatedMissing: boolean,
  t?: TranslateFn,
): { title: string; body: string } {
  if (simulatedMissing) {
    if (t) {
      return {
        title: t('optionalFeaturePrompt.developer.title'),
        body: t('optionalFeaturePrompt.developer.body'),
      };
    }
    return {
      title: 'Concierge is hidden by a developer setting',
      body:
        'The setting "Simulate missing Concierge / knowledge" (Settings → Developer → Runtime gates) is ON. ' +
        'It reports the Concierge and knowledge packs as not downloaded to test the optional-feature prompts. ' +
        'Your model is installed — turn the setting OFF to use Concierge.',
    };
  }
  if (t) {
    const keys = COPY_KEYS[requirement];
    return {
      title: t(keys.title),
      body: t(keys.body),
    };
  }
  return COPY[requirement];
}
