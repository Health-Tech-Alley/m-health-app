/**
 * Optional-feature gate for SLM / knowledge-cache dependent surfaces.
 *
 * The on-device Concierge model and the clinical knowledge cache are optional
 * downloads (doc 26 §7). Surfaces that depend on them use this hook to decide
 * whether to render normally, grey out, or show the optional download prompt.
 *
 * Developer testing: when Settings → simulateMissingOptionalFeatures is on,
 * both features are reported as unavailable so the prompt/grey-out flows can
 * be exercised without removing any downloads.
 */

import { useKnowledgePackInstall } from '@/hooks/useKnowledgePackInstall';
import { useModelDownloadQueue } from '@/hooks/useModelDownloadQueue';
import { useSettings } from '@/contexts/settings-context';

export type OptionalFeatureRequirements = 'slm' | 'knowledge' | 'both';

export type OptionalFeatureGate = {
  /** True when every requirement for this surface is downloaded. */
  ready: boolean;
  slmReady: boolean;
  knowledgeReady: boolean;
  requirement: OptionalFeatureRequirements;
  /**
   * True when the developer flag "Simulate missing Concierge / knowledge"
   * (Settings → Runtime gates) is ON. When on, ready is forced false even if
   * a model IS installed — the optional-feature prompt should say so instead
   * of telling the user to download a model that already exists.
   */
  simulatedMissing: boolean;
};

export function useOptionalFeatureGate(
  requirement: OptionalFeatureRequirements = 'both',
): OptionalFeatureGate {
  const models = useModelDownloadQueue();
  const pack = useKnowledgePackInstall();
  const { settings } = useSettings();

  const simulateMissing = settings.simulateMissingOptionalFeatures === true;
  const slmReady = !simulateMissing && models.anyInstalled;
  const knowledgeReady = !simulateMissing && pack.isReady;

  const ready =
    requirement === 'slm'
      ? slmReady
      : requirement === 'knowledge'
        ? knowledgeReady
        : slmReady && knowledgeReady;

  return { ready, slmReady, knowledgeReady, requirement, simulatedMissing: simulateMissing };
}
