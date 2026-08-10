/**
 * Onboarding Device setup slide — SLM + knowledge pack (doc 42 D20).
 */

import { useEffect, useMemo } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { AppTheme } from '@/constants/theme';
import { useKnowledgePackInstall } from '@/hooks/useKnowledgePackInstall';
import { useModelDownloadQueue } from '@/hooks/useModelDownloadQueue';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import type { PackRunnerOptions } from '@/clinical-evidence/pack';

import { KnowledgePackProgressCard } from './KnowledgePackProgressCard';
import { SlmModelCarousel } from './SlmModelCarousel';

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
  const theme = useTheme();
  const { t } = useTranslation();

  const keepAwake = pack.inFlight || models.anyDownloading;
  const isDark = theme.appBackground === '#000000';
  const themedStyles = useMemo(
    () =>
      StyleSheet.create({
        introCard: {
          backgroundColor: theme.appBrandSoftSurface,
          borderColor: isDark ? theme.appProfileAvatarBorder : '#B7FFF1',
        },
        heading: {
          color: theme.appText,
        },
        subheading: {
          color: theme.appTextSupporting,
        },
        banner: {
          backgroundColor: isDark ? '#3A2610' : '#FFF4E5',
          borderColor: isDark ? '#A16207' : '#F5D0A9',
        },
        bannerText: {
          color: isDark ? '#FDBA74' : '#7A4E12',
        },
      }),
    [isDark, theme],
  );

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
          t('onboarding.deviceSetup.alert.title'),
          t('onboarding.deviceSetup.alert.body'),
          [
            {
              text: t('onboarding.deviceSetup.alert.wait'),
              style: 'cancel',
              onPress: () => resolve(),
            },
            {
              text: t('onboarding.deviceSetup.alert.continue'),
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
    () => t('onboarding.deviceSetup.banner'),
    [t],
  );

  return (
    <View style={styles.root}>
      <View style={[styles.introCard, themedStyles.introCard]}>
        <Text style={[styles.heading, themedStyles.heading]}>
          {t('onboarding.deviceSetup.title')}
        </Text>
        <Text style={[styles.subheading, themedStyles.subheading]}>
          {t('onboarding.deviceSetup.subtitle')}
        </Text>
      </View>
      <View style={[styles.banner, themedStyles.banner]}>
        <Text style={[styles.bannerText, themedStyles.bannerText]}>
          {banner}
        </Text>
      </View>
      <SlmModelCarousel
        hfTokenHint
        showUseDefault={false}
        onNeedHfToken={() =>
          Alert.alert(
            t('onboarding.deviceSetup.hfToken.title'),
            t('onboarding.deviceSetup.hfToken.body'),
          )
        }
      />
      <KnowledgePackProgressCard
        runnerOptions={runnerOptions}
        presentation="onboarding"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 16,
    paddingBottom: 24,
  },
  introCard: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderWidth: 1,
    borderColor: '#B7FFF1',
    borderRadius: AppTheme.radius.card,
    padding: 20,
    marginBottom: 4,
  },
  heading: {
    fontSize: 26,
    fontWeight: '900',
    color: AppTheme.colors.text,
    marginBottom: 8,
  },
  subheading: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '600',
    color: AppTheme.colors.textSoft,
  },
  banner: {
    backgroundColor: '#FFF4E5',
    borderRadius: AppTheme.radius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F5D0A9',
  },
  bannerText: {
    fontSize: 13,
    color: '#7A4E12',
    lineHeight: 20,
    fontWeight: '600',
  },
});
