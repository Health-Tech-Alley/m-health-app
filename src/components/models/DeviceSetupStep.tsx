/**
 * Onboarding Device setup slide — SLM + knowledge pack (doc 42 D20).
 */

import { useEffect, useMemo } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { AppTheme } from '@/constants/theme';
import { useKnowledgePackInstall } from '@/hooks/useKnowledgePackInstall';
import { useModelDownloadQueue } from '@/hooks/useModelDownloadQueue';
import type { PackRunnerOptions } from '@/clinical-evidence/pack';

import { KnowledgePackProgressCard } from './KnowledgePackProgressCard';
import { SlmDownloadCard } from './SlmDownloadCard';

const KEEP_AWAKE_TAG = 'device-setup-downloads';

export type DeviceSetupStepProps = {
  runnerOptions?: PackRunnerOptions;
  /** Called when knowledge becomes ready (optional parent hook). */
  onKnowledgeReadyChange?: (ready: boolean) => void;
};

export function DeviceSetupStep({
  runnerOptions,
  onKnowledgeReadyChange,
}: DeviceSetupStepProps) {
  const pack = useKnowledgePackInstall();
  const models = useModelDownloadQueue();

  const keepAwake = pack.inFlight || models.anyDownloading;

  useEffect(() => {
    let active = true;
    if (keepAwake) {
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    } else {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    }
    return () => {
      if (active) {
        void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
      }
      active = false;
    };
  }, [keepAwake]);

  useEffect(() => {
    onKnowledgeReadyChange?.(pack.isReady);
  }, [pack.isReady, onKnowledgeReadyChange]);

  // Auto-start knowledge on mount (Wi‑Fi warning once on cellular is best-effort).
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (pack.isReady || pack.inFlight) return;
      // Soft Wi‑Fi reminder — user can still proceed.
      await new Promise<void>((resolve) => {
        Alert.alert(
          'Download clinical knowledge',
          'Wi‑Fi is strongly recommended. Stay on this screen while downloads run. Do not lock the phone or force-quit the app.',
          [
            { text: 'Wait', style: 'cancel', onPress: () => resolve() },
            {
              text: 'Continue download',
              onPress: () => {
                if (!cancelled) {
                  void pack.autoStartOnce(runnerOptions);
                }
                resolve();
              },
            },
          ],
        );
      });
    };
    void run();
    return () => {
      cancelled = true;
    };
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const banner = useMemo(
    () =>
      'Stay on this screen while downloads run. Do not power off or force-quit the app. Leaving may pause large downloads. Wi‑Fi strongly recommended.',
    [],
  );

  return (
    <View style={styles.root}>
      <Text style={styles.heading}>Device setup</Text>
      <Text style={styles.subheading}>
        Download on-device AI before home care use
      </Text>
      <View style={styles.banner}>
        <Text style={styles.bannerText}>{banner}</Text>
      </View>
      <SlmDownloadCard hfTokenHint />
      <KnowledgePackProgressCard runnerOptions={runnerOptions} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 14,
    paddingBottom: 24,
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: AppTheme.colors.text,
  },
  subheading: {
    fontSize: 15,
    color: AppTheme.colors.textMuted,
  },
  banner: {
    backgroundColor: '#FFF4E5',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F5D0A9',
  },
  bannerText: {
    fontSize: 13,
    color: '#7A4E12',
    lineHeight: 18,
  },
});
