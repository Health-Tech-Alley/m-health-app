/**
 * Shared clinical knowledge pack progress card (Device setup + Settings).
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { useKnowledgePackInstall } from '@/hooks/useKnowledgePackInstall';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import type { PackLayerId, PackRunnerOptions } from '@/clinical-evidence/pack';
import type { TranslateFn, TranslationKey } from '@/localization/i18n';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

const PACK_SECTION_LABEL_KEYS: Record<PackLayerId, TranslationKey> = {
  spine: 'onboarding.knowledge.section.spine',
  cpg: 'onboarding.knowledge.section.cpg',
  medlineplus: 'onboarding.knowledge.section.medlineplus',
  orphanet: 'onboarding.knowledge.section.orphanet',
  public_health: 'onboarding.knowledge.section.publicHealth',
  meds_base: 'onboarding.knowledge.section.medsBase',
  ddi: 'onboarding.knowledge.section.ddi',
  openfda: 'onboarding.knowledge.section.openfda',
  dme: 'onboarding.knowledge.section.dme',
  lit_lite: 'onboarding.knowledge.section.litLite',
  sdoh: 'onboarding.knowledge.section.sdoh',
  graph: 'onboarding.knowledge.section.graph',
  embeds: 'onboarding.knowledge.section.embeds',
};

function getPackSectionLabel(id: PackLayerId, fallback: string, t: TranslateFn): string {
  return t(PACK_SECTION_LABEL_KEYS[id]) || fallback;
}

function localizePackDetail(detail: string, t: TranslateFn): string {
  if (detail === 'Downloading…' || detail === 'Downloading...') {
    return t('onboarding.knowledge.detail.downloading');
  }
  if (detail === 'Fetching condition topics…' || detail === 'Fetching condition topics...') {
    return t('onboarding.knowledge.detail.fetchingConditionTopics');
  }
  if (detail === 'Resolving drug names…' || detail === 'Resolving drug names...') {
    return t('onboarding.knowledge.detail.resolvingDrugNames');
  }
  if (detail === 'Fetching abstracts…' || detail === 'Fetching abstracts...') {
    return t('onboarding.knowledge.detail.fetchingAbstracts');
  }
  if (detail === 'Fetching FDA safety data…' || detail === 'Fetching FDA safety data...') {
    return t('onboarding.knowledge.detail.fetchingFda');
  }
  if (detail === 'Saving…' || detail === 'Saving...') {
    return t('onboarding.knowledge.detail.saving');
  }
  if (detail === 'Building…' || detail === 'Building...') {
    return t('onboarding.knowledge.detail.building');
  }
  if (detail === 'Indexing in background…' || detail === 'Indexing in background...') {
    return t('onboarding.knowledge.detail.indexingBackground');
  }
  if (detail === 'Indexing…' || detail === 'Indexing...') {
    return t('onboarding.knowledge.detail.indexing');
  }
  if (detail === 'Unchanged') {
    return t('onboarding.knowledge.detail.unchanged');
  }

  const topics = detail.match(/^(\d+) topics$/);
  if (topics) {
    return t('onboarding.knowledge.detail.topics', { count: topics[1] });
  }
  const abstracts = detail.match(/^(\d+) abstracts$/);
  if (abstracts) {
    return t('onboarding.knowledge.detail.abstracts', { count: abstracts[1] });
  }
  const queries = detail.match(/^(\d+)\/(\d+) queries\s+·\s+(\d+) abstracts$/);
  if (queries) {
    return t('onboarding.knowledge.detail.queriesAbstracts', {
      current: queries[1],
      total: queries[2],
      count: queries[3],
    });
  }
  const chunks = detail.match(/^(\d+) chunks$/);
  if (chunks) {
    return t('onboarding.knowledge.detail.chunks', { count: chunks[1] });
  }
  const cached = detail.match(/^Cached v(.+) \((\d+) chunks\)$/);
  if (cached) {
    return t('onboarding.knowledge.detail.cached', {
      version: cached[1],
      count: cached[2],
    });
  }
  const edges = detail.match(/^(\d+) edges$/);
  if (edges) {
    return t('onboarding.knowledge.detail.edges', { count: edges[1] });
  }
  const vectors = detail.match(/^(\d+) vectors$/);
  if (vectors) {
    return t('onboarding.knowledge.detail.vectors', { count: vectors[1] });
  }

  return detail;
}

export type KnowledgePackProgressCardProps = {
  title?: string;
  subtitle?: string;
  presentation?: 'default' | 'onboarding';
  runnerOptions?: PackRunnerOptions;
  showUpdateReset?: boolean;
  autoStart?: boolean;
};

export function KnowledgePackProgressCard({
  title,
  subtitle,
  presentation = 'default',
  runnerOptions,
  showUpdateReset = false,
  autoStart = false,
}: KnowledgePackProgressCardProps) {
  const pack = useKnowledgePackInstall();
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createStyles(theme, presentation), [theme, presentation]);
  const displayTitle = title ?? t('onboarding.knowledge.title');
  const displaySubtitle = subtitle ?? t('onboarding.knowledge.subtitle');

  // Auto-start is driven by parent via pack.autoStartOnce to control Wi-Fi alert timing.
  void autoStart;

  const overallPct = Math.round(Math.min(1, Math.max(0, pack.state.overall)) * 100);
  const sizeLabel =
    pack.state.sizeBytes > 0 ? formatBytes(pack.state.sizeBytes) : null;
  const metaParts: string[] = [];
  if (sizeLabel) metaParts.push(sizeLabel);
  if (pack.state.chunksInstalled > 0) {
    metaParts.push(t('onboarding.knowledge.chunks', {
      count: pack.state.chunksInstalled,
    }));
  }
  const metaLabel = metaParts.join(' · ');

  return (
    <View style={[styles.card, themedStyles.card]}>
      <Text style={[styles.title, themedStyles.title]}>{displayTitle}</Text>
      <Text style={[styles.subtitle, themedStyles.subtitle]}>{displaySubtitle}</Text>

      <View style={[styles.barTrack, themedStyles.barTrack]}>
        <View style={[styles.barFill, { width: `${overallPct}%` }]} />
      </View>
      <Text
        style={[styles.overall, themedStyles.overall]}
        accessibilityLabel={
          sizeLabel
            ? t('onboarding.knowledge.progressA11yWithMeta', {
                percent: overallPct,
                size: sizeLabel,
                chunks: t('onboarding.knowledge.chunks', {
                  count: pack.state.chunksInstalled,
                }),
              })
            : t('onboarding.knowledge.progressA11y', { percent: overallPct })
        }
      >
        {metaParts.length > 0
          ? t('onboarding.knowledge.overallWithMeta', {
              percent: overallPct,
              meta: metaLabel,
            })
          : t('onboarding.knowledge.overall', { percent: overallPct })}
      </Text>

      {pack.state.sections.map((s) => {
        const pct =
          typeof s.progress01 === 'number'
            ? Math.round(Math.min(1, Math.max(0, s.progress01)) * 100)
            : null;
        const sectionLabel = getPackSectionLabel(s.id, s.label, t);
        const sectionDetail = s.detail ? localizePackDetail(s.detail, t) : null;
        return (
          <View key={s.id} style={styles.section}>
            <Text style={[styles.sectionLabel, themedStyles.sectionLabel]}>
              {sectionLabel}
              {s.state === 'done' ? '  ✓' : ''}
              {s.state === 'failed' ? '  ✕' : ''}
              {s.state === 'running' && pct != null ? `  ${pct}%` : ''}
              {s.state === 'running' && pct == null ? '  …' : ''}
              {s.state === 'queued' ? `  ${t('onboarding.knowledge.status.queued')}` : ''}
            </Text>
            {s.state === 'running' && pct != null ? (
              <View style={[styles.miniTrack, themedStyles.miniTrack]}>
                <View style={[styles.miniFill, { width: `${pct}%` }]} />
              </View>
            ) : null}
            {sectionDetail ? (
              <Text style={[styles.detail, themedStyles.detail]}>{sectionDetail}</Text>
            ) : null}
            {s.error ? <Text style={styles.error}>{s.error}</Text> : null}
          </View>
        );
      })}

      {pack.state.lastError ? (
        <Text style={styles.error}>{pack.state.lastError}</Text>
      ) : null}

      <View style={styles.actions}>
        {!pack.inFlight && pack.state.status !== 'ready' ? (
          <Pressable
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => {
              void pack.start(runnerOptions);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.knowledge.startA11y')}
          >
            <Text style={styles.btnText}>
              {pack.state.status === 'failed'
                ? t('onboarding.knowledge.retry')
                : t('onboarding.knowledge.start')}
            </Text>
          </Pressable>
        ) : null}
        {!pack.inFlight ? (
          <Pressable
            style={[
              styles.btn,
              pack.state.status === 'ready' ? styles.btnPrimary : styles.btnMuted,
              pack.state.status !== 'ready' && themedStyles.btnMuted,
            ]}
            onPress={() => {
              void pack.retry(runnerOptions);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.knowledge.redownloadA11y')}
          >
            <Text
              style={
                pack.state.status === 'ready'
                  ? styles.btnText
                  : [styles.btnTextDark, themedStyles.btnTextDark]
              }
            >
              {t('onboarding.knowledge.redownload')}
            </Text>
          </Pressable>
        ) : null}
        {pack.inFlight ? (
          <Pressable
            style={[styles.btn, styles.btnDanger]}
            onPress={pack.cancel}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.knowledge.cancelA11y')}
          >
            <Text style={styles.btnText}>{t('onboarding.knowledge.cancel')}</Text>
          </Pressable>
        ) : null}
        {showUpdateReset && !pack.inFlight ? (
          <>
            <Pressable
              style={[styles.btn, styles.btnMuted, themedStyles.btnMuted]}
              onPress={() => {
                void pack.checkUpdates(runnerOptions);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.knowledge.checkUpdatesA11y')}
            >
              <Text style={[styles.btnTextDark, themedStyles.btnTextDark]}>
                {t('onboarding.knowledge.checkUpdates')}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnMuted, themedStyles.btnMuted]}
              onPress={() => {
                void pack.resetPack(runnerOptions);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.knowledge.resetA11y')}
            >
              <Text style={[styles.btnTextDark, themedStyles.btnTextDark]}>
                {t('onboarding.knowledge.resetPack')}
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(
  theme: ReturnType<typeof useTheme>,
  presentation: NonNullable<KnowledgePackProgressCardProps['presentation']>,
) {
  const isOnboarding = presentation === 'onboarding';

  return StyleSheet.create({
    card: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    title: {
      color: theme.appText,
      ...(isOnboarding
        ? {
            fontSize: 18,
            fontWeight: '900',
            marginBottom: 2,
          }
        : null),
    },
    subtitle: {
      color: isOnboarding ? theme.appTextSupporting : theme.appTextMuted,
      ...(isOnboarding
        ? {
            fontSize: 14,
            lineHeight: 20,
            fontWeight: '700',
            marginBottom: 2,
          }
        : null),
    },
    barTrack: {
      backgroundColor: theme.appBorder,
    },
    overall: {
      color: theme.appText,
    },
    sectionLabel: {
      color: theme.appText,
    },
    detail: {
      color: theme.appTextMuted,
    },
    miniTrack: {
      backgroundColor: theme.appBorder,
    },
    btnMuted: {
      backgroundColor: theme.appBorder,
    },
    btnTextDark: {
      color: theme.appText,
    },
  });
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: AppTheme.colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: AppTheme.colors.textMuted,
  },
  barTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: AppTheme.colors.border,
    overflow: 'hidden',
    marginTop: 4,
  },
  barFill: {
    height: '100%',
    backgroundColor: AppTheme.colors.brand,
  },
  overall: {
    fontSize: 13,
    fontWeight: '600',
    color: AppTheme.colors.text,
  },
  section: {
    gap: 2,
    paddingVertical: 4,
  },
  sectionLabel: {
    fontSize: 13,
    color: AppTheme.colors.text,
  },
  detail: {
    fontSize: 11,
    color: AppTheme.colors.textMuted,
  },
  miniTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: AppTheme.colors.border,
    overflow: 'hidden',
  },
  miniFill: {
    height: '100%',
    backgroundColor: AppTheme.colors.brand,
  },
  error: {
    color: '#b42318',
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  btn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: AppTheme.colors.brand,
  },
  btnDanger: {
    backgroundColor: '#b42318',
  },
  btnMuted: {
    backgroundColor: AppTheme.colors.border,
  },
  btnText: {
    color: '#fff',
    fontWeight: '600',
  },
  btnTextDark: {
    color: AppTheme.colors.text,
    fontWeight: '600',
  },
});
