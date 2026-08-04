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
import { DEFAULT_SLM_MODEL_ID, MODEL_CATALOG } from '@/inference/model-catalog';
import {
  getInstalledModelIds,
  useModelDownloadQueue,
} from '@/hooks/useModelDownloadQueue';

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
  const defaultModelId = settings.demoDefaultModelId ?? DEFAULT_SLM_MODEL_ID;
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
        Alert.alert('Keep a Concierge model', result.reason);
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
    [queue, defaultModelId, setDemoDefaultModelId],
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
          <Text style={styles.title}>Concierge model</Text>
          <Text style={styles.subtitle}>
            Swipe to compare · one download at a time
          </Text>
        </View>
        {hfTokenHint ? (
          <Pressable onPress={onNeedHfToken} accessibilityRole="link">
            <Text style={styles.link}>HF token</Text>
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

          return (
            <View style={[styles.card, { width: cardW, height: cardHeight }]}>
              <View style={styles.cardHeader}>
                <Text style={styles.modelName}>{item.displayName}</Text>
                {item.experimental ? (
                  <View style={styles.experimentalBadge}>
                    <Text style={styles.experimentalText}>Experimental</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.meta}>
                ~{formatBytes(item.sizeBytes)} · {item.family === 'qwen3' ? 'Qwen3' : 'Gemma 4'} ·
                {item.preferredNCtx >= 8192 ? ' 8K context' : ' 4K context'}
                {item.nGpuLayers === 0 ? ' · CPU' : ''}
              </Text>
              <Text style={styles.tagline}>{item.tagline}</Text>
              <ScrollView
                style={styles.bullets}
                contentContainerStyle={styles.bulletsContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}>
                {item.bullets.map((b) => (
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
                      accessibilityLabel={`Cancel download of ${item.displayName}`}>
                      <Text style={styles.btnText}>Cancel</Text>
                    </Pressable>
                  </View>
                ) : status === 'installed' ? (
                  <View style={styles.actions}>
                    {showUseDefault ? (
                      <Pressable
                        style={[styles.btn, isDefault ? styles.btnDefaultActive : styles.btnPrimary]}
                        onPress={() => setDemoDefaultModelId(item.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Use ${item.displayName} as the default Concierge model`}>
                        <Text style={styles.btnText}>{isDefault ? '✓ Default model' : 'Use as default'}</Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.done}>{'\u2713'} Installed</Text>
                    )}
                    {showDelete ? (
                      <Pressable
                        style={[styles.btn, styles.btnMuted]}
                        onPress={() => handleDelete(item.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${item.displayName}`}>
                        <Text style={styles.btnTextDark}>Delete</Text>
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
                      accessibilityLabel={`Download ${item.displayName}`}>
                      <Text style={styles.btnText}>{row?.status === 'error' ? 'Retry' : 'Download'}</Text>
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
          Active default: {defaultModelId === DEFAULT_SLM_MODEL_ID ? 'Gemma 4 E2B' : MODEL_CATALOG.find((m) => m.id === defaultModelId)?.displayName ?? 'Gemma 4 E2B'}
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
