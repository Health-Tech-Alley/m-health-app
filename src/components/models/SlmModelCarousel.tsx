/**
 * SlmModelCarousel — horizontal pager over the model catalog.
 *
 * One page per Concierge model with caregiver-facing comparison copy,
 * download/progress state, "Use as default", and (on management surfaces)
 * guarded delete. Used by onboarding Device setup and developer/Models
 * surfaces so both share the same multi-model UX.
 */

import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { useSettings } from '@/contexts/settings-context';
import {
  MODEL_CATALOG,
  resolveActiveModelId,
  type ModelEntry,
} from '@/inference/model-catalog';
import {
  getInstalledModelIds,
  useModelDownloadQueue,
} from '@/hooks/useModelDownloadQueue';
import { useTranslation } from '@/hooks/use-translation';
import type { TranslateFn, TranslationKey } from '@/localization/i18n';

const MODEL_COPY_KEYS: Record<
  string,
  { tagline: TranslationKey; bullets: TranslationKey[] }
> = {
  'gemma-4-e2b': {
    tagline: 'onboarding.models.gemma.tagline',
    bullets: [
      'onboarding.models.gemma.bullet1',
      'onboarding.models.gemma.bullet2',
      'onboarding.models.gemma.bullet3',
      'onboarding.models.gemma.bullet4',
    ],
  },
  'bonsai-8b-1bit': {
    tagline: 'onboarding.models.bonsai.tagline',
    bullets: [
      'onboarding.models.bonsai.bullet1',
      'onboarding.models.bonsai.bullet2',
      'onboarding.models.bonsai.bullet3',
      'onboarding.models.bonsai.bullet4',
    ],
  },
  'lfm2-5-2-6b': {
    tagline: 'onboarding.models.lfm2.tagline',
    bullets: [
      'onboarding.models.lfm2.bullet1',
      'onboarding.models.lfm2.bullet2',
      'onboarding.models.lfm2.bullet3',
      'onboarding.models.lfm2.bullet4',
    ],
  },
};

function getLocalizedModelCopy(item: ModelEntry, t: TranslateFn) {
  const keys = MODEL_COPY_KEYS[item.id];
  if (!keys) return { tagline: item.tagline, bullets: item.bullets };

  return {
    tagline: t(keys.tagline),
    bullets: keys.bullets.map((key) => t(key)),
  };
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export type SlmModelCarouselProps = {
  /** Show delete buttons (management surfaces). Onboarding keeps them hidden. */
  showDelete?: boolean;
  /** Show "Use as default" controls. */
  showUseDefault?: boolean;
  hfTokenHint?: boolean;
  onNeedHfToken?: () => void;
  /** Page width in px — the carousel is width-aware so it fits any surface. */
  pageWidth?: number;
};

export function SlmModelCarousel({
  showDelete = false,
  showUseDefault = true,
  hfTokenHint = false,
  onNeedHfToken,
  pageWidth = 0,
}: SlmModelCarouselProps) {
  const queue = useModelDownloadQueue();
  const { settings, setDemoDefaultModelId } = useSettings();
  const { t } = useTranslation();
  // Effective default — a single installed model is always the default.
  const defaultModelId = resolveActiveModelId(settings.demoDefaultModelId, (id) =>
    queue.rows.some((r) => r.id === id && r.status === 'installed'),
  );
  const [page, setPage] = useState(0);
  // Actual width of the carousel viewport, measured at layout. The carousel
  // lives inside padded screens, so the window width is NOT the page width —
  // hard-coding it made cards wider than the visible area and clipped text.
  const [viewportW, setViewportW] = useState(0);

  // Cap each card so it fits entirely on screen (paging shows full cards).
  // Bounded to ~42% of the window with slack for headers/footers — content
  // that does not fit (bullets) scrolls inside the card instead of growing it.
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const pageW = pageWidth > 0 ? pageWidth : (viewportW > 0 ? viewportW : windowWidth);
  // Card is slightly narrower than the page; the marginRight bridges the gap
  // so paging stays aligned to full viewport steps.
  const cardW = Math.max(0, pageW - 12);
  const cardHeight = Math.max(280, Math.min(windowHeight * 0.42, windowHeight - 320));

  const handleDelete = useCallback(
    (modelId: string) => {
      const result = queue.removeModel(modelId);
      if (!result.ok) {
        Alert.alert(t('onboarding.models.keepModelTitle'), result.reason);
        return;
      }
      // Reassign the default if the deleted model was it.
      if (defaultModelId === modelId) {
        const remaining = getInstalledModelIds().filter((id) => id !== modelId);
        if (remaining.length > 0) {
          setDemoDefaultModelId(remaining[0]);
        }
      }
    },
    [queue, defaultModelId, setDemoDefaultModelId, t],
  );

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const w = pageW;
      const next = w > 0 ? Math.round(e.nativeEvent.contentOffset.x / w) : 0;
      setPage(Math.max(0, Math.min(MODEL_CATALOG.length - 1, next)));
    },
    [pageW],
  );

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t('onboarding.models.title')}</Text>
          <Text style={styles.subtitle}>
            {t('onboarding.models.subtitle')}
          </Text>
        </View>
        {hfTokenHint ? (
          <Pressable onPress={onNeedHfToken} accessibilityRole="link">
            <Text style={styles.link}>{t('onboarding.models.hfToken')}</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        data={MODEL_CATALOG}
        keyExtractor={(m) => m.id}
        onLayout={(e) => setViewportW(e.nativeEvent.layout.width)}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_data, index) => ({ length: pageW, offset: pageW * index, index })}
        renderItem={({ item }) => {
          const row = queue.rows.find((r) => r.id === item.id);
          const status = row?.status ?? 'not_installed';
          const progress =
            row && row.totalBytes > 0
              ? Math.round((row.bytesWritten / row.totalBytes) * 100)
              : 0;
          const isDefault = defaultModelId === item.id;
          const disableStart = queue.anyDownloading && queue.activeModelId !== item.id;
          const modelCopy = getLocalizedModelCopy(item, t);
          const contextLabel =
            item.preferredNCtx >= 8192
              ? t('onboarding.models.context8k')
              : t('onboarding.models.context4k');

          return (
            <View style={[styles.card, { width: cardW, height: cardHeight }]}>
              <View style={styles.cardHeader}>
                <Text style={styles.modelName}>{item.displayName}</Text>
                {item.experimental ? (
                  <View style={styles.experimentalBadge}>
                    <Text style={styles.experimentalText}>
                      {t('onboarding.models.experimental')}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.meta}>
                ~{formatBytes(item.sizeBytes)} ·{' '}
                {item.family === 'qwen3' ? 'Qwen3' : item.family === 'lfm2' ? 'LFM2.5' : 'Gemma 4'} ·{' '}
                {contextLabel}
                {item.nGpuLayers === 0 ? ` · ${t('onboarding.models.cpu')}` : ''}
              </Text>
              <Text style={styles.tagline}>{modelCopy.tagline}</Text>
              <ScrollView
                style={styles.bullets}
                contentContainerStyle={styles.bulletsContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}>
                {modelCopy.bullets.map((b) => (
                  <Text key={b} style={styles.bullet}>
                    {'\u2022'} {b}
                  </Text>
                ))}
              </ScrollView>

              <View style={styles.cardActions}>
                {status === 'downloading' ? (
                  <View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${progress}%` }]} />
                    </View>
                    <Text style={styles.meta}>
                      {progress}% · {formatBytes(row?.bytesWritten ?? 0)} / {formatBytes(row?.totalBytes ?? item.sizeBytes)}
                    </Text>
                    <Pressable
                      style={[styles.btn, styles.btnDanger]}
                      onPress={() => queue.cancelDownload(item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={t('onboarding.models.cancelAccessibility', {
                        model: item.displayName,
                      })}>
                      <Text style={styles.btnText}>
                        {t('onboarding.models.cancel')}
                      </Text>
                    </Pressable>
                  </View>
                ) : status === 'installed' ? (
                  <View style={styles.actions}>
                    {showUseDefault ? (
                      <Pressable
                        style={[styles.btn, isDefault ? styles.btnDefaultActive : styles.btnPrimary]}
                        onPress={() => setDemoDefaultModelId(item.id)}
                        accessibilityRole="button"
                        accessibilityLabel={t('onboarding.models.defaultAccessibility', {
                          model: item.displayName,
                        })}>
                        <Text style={styles.btnText}>
                          {isDefault
                            ? `✓ ${t('onboarding.models.defaultModel')}`
                            : t('onboarding.models.useAsDefault')}
                        </Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.done}>
                        {'\u2713'} {t('onboarding.models.installed')}
                      </Text>
                    )}
                    {showDelete ? (
                      <Pressable
                        style={[styles.btn, styles.btnMuted]}
                        onPress={() => handleDelete(item.id)}
                        accessibilityRole="button"
                        accessibilityLabel={t('onboarding.models.deleteAccessibility', {
                          model: item.displayName,
                        })}>
                        <Text style={styles.btnTextDark}>
                          {t('onboarding.models.delete')}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : (
                  <View>
                    {row?.error ? <Text style={styles.error}>{row.error}</Text> : null}
                    <Pressable
                      style={[styles.btn, styles.btnPrimary, disableStart && styles.btnDisabled]}
                      disabled={disableStart}
                      onPress={() => void queue.startDownload(item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={t('onboarding.models.downloadAccessibility', {
                        model: item.displayName,
                      })}>
                      <Text style={styles.btnText}>
                        {row?.status === 'error'
                          ? t('onboarding.models.retry')
                          : t('onboarding.models.download')}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          );
        }}
      />

      <View style={styles.footer}>
        <View style={styles.dots}>
          {MODEL_CATALOG.map((m, i) => (
            <View key={m.id} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        <Text style={styles.footerText}>
          {t('onboarding.models.activeDefault', {
            model:
              MODEL_CATALOG.find((m) => m.id === defaultModelId)?.displayName ??
              'Gemma 4 E2B',
          })}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerText: { flex: 1, gap: 2 },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: AppTheme.colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: AppTheme.colors.textMuted,
  },
  link: {
    fontSize: 13,
    color: AppTheme.colors.brand,
    textDecorationLine: 'underline',
  },
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    gap: 8,
    marginRight: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modelName: { fontSize: 16, fontWeight: '700', color: AppTheme.colors.text, flexShrink: 1 },
  experimentalBadge: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  experimentalText: {
    fontSize: 11,
    fontWeight: '600',
    color: AppTheme.colors.brand,
  },
  meta: {
    fontSize: 12,
    color: AppTheme.colors.textMuted,
  },
  tagline: {
    fontSize: 13,
    color: AppTheme.colors.text,
    fontWeight: '500',
  },
  bullets: {
    flex: 1,
    flexGrow: 1,
  },
  bulletsContent: { gap: 3, paddingBottom: 4 },
  bullet: {
    fontSize: 12.5,
    color: AppTheme.colors.textMuted,
    lineHeight: 17,
  },
  /** Actions pinned to the bottom so every card's buttons sit at the same height. */
  cardActions: {
    marginTop: 'auto',
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: AppTheme.colors.border,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: AppTheme.colors.brand,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  done: { color: AppTheme.colors.brand, fontWeight: '600', fontSize: 13 },
  error: { color: '#b42318', fontSize: 12 },
  btn: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: AppTheme.colors.brand },
  btnDefaultActive: { backgroundColor: AppTheme.colors.brandDeep },
  btnDanger: { backgroundColor: '#b42318' },
  btnMuted: { backgroundColor: AppTheme.colors.border },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: '#fff', fontWeight: '600' },
  btnTextDark: { color: AppTheme.colors.text, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dots: { flexDirection: 'row', gap: 6 },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: AppTheme.colors.border,
  },
  dotActive: { backgroundColor: AppTheme.colors.brand },
  footerText: { fontSize: 12, color: AppTheme.colors.textMuted, flexShrink: 1 },
});
