/**
 * Shared clinical knowledge pack progress card (Device setup + Settings).
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { useKnowledgePackInstall } from '@/hooks/useKnowledgePackInstall';
import { useTheme } from '@/hooks/use-theme';
import type { PackRunnerOptions } from '@/clinical-evidence/pack';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
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
  title = 'Clinical knowledge',
  subtitle = 'On-device pack · required for Home',
  presentation = 'default',
  runnerOptions,
  showUpdateReset = false,
  autoStart = false,
}: KnowledgePackProgressCardProps) {
  const pack = useKnowledgePackInstall();
  const theme = useTheme();
  const themedStyles = useMemo(() => createStyles(theme, presentation), [theme, presentation]);

  // Auto-start is driven by parent via pack.autoStartOnce to control Wi-Fi alert timing.
  void autoStart;

  const overallPct = Math.round(Math.min(1, Math.max(0, pack.state.overall)) * 100);
  const sizeLabel =
    pack.state.sizeBytes > 0 ? formatBytes(pack.state.sizeBytes) : null;
  const metaParts: string[] = [];
  if (sizeLabel) metaParts.push(sizeLabel);
  if (pack.state.chunksInstalled > 0) {
    metaParts.push(`${pack.state.chunksInstalled} chunks`);
  }

  return (
    <View style={[styles.card, themedStyles.card]}>
      <Text style={[styles.title, themedStyles.title]}>{title}</Text>
      <Text style={[styles.subtitle, themedStyles.subtitle]}>{subtitle}</Text>

      <View style={[styles.barTrack, themedStyles.barTrack]}>
        <View style={[styles.barFill, { width: `${overallPct}%` }]} />
      </View>
      <Text
        style={[styles.overall, themedStyles.overall]}
        accessibilityLabel={
          sizeLabel
            ? `Clinical knowledge overall ${overallPct} percent, ${sizeLabel}, ${pack.state.chunksInstalled} chunks`
            : `Clinical knowledge overall ${overallPct} percent`
        }
      >
        Overall {overallPct}%
        {metaParts.length > 0 ? ` · ${metaParts.join(' · ')}` : ''}
      </Text>

      {pack.state.sections.map((s) => {
        const pct =
          typeof s.progress01 === 'number'
            ? Math.round(Math.min(1, Math.max(0, s.progress01)) * 100)
            : null;
        return (
          <View key={s.id} style={styles.section}>
            <Text style={[styles.sectionLabel, themedStyles.sectionLabel]}>
              {s.label}
              {s.state === 'done' ? '  ✓' : ''}
              {s.state === 'failed' ? '  ✕' : ''}
              {s.state === 'running' && pct != null ? `  ${pct}%` : ''}
              {s.state === 'running' && pct == null ? '  …' : ''}
              {s.state === 'queued' ? '  queued' : ''}
            </Text>
            {s.state === 'running' && pct != null ? (
              <View style={[styles.miniTrack, themedStyles.miniTrack]}>
                <View style={[styles.miniFill, { width: `${pct}%` }]} />
              </View>
            ) : null}
            {s.detail ? <Text style={[styles.detail, themedStyles.detail]}>{s.detail}</Text> : null}
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
            accessibilityLabel="Start clinical knowledge download"
          >
            <Text style={styles.btnText}>
              {pack.state.status === 'failed' ? 'Retry' : 'Start'}
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
            accessibilityLabel="Redownload clinical knowledge pack"
          >
            <Text
              style={
                pack.state.status === 'ready'
                  ? styles.btnText
                  : [styles.btnTextDark, themedStyles.btnTextDark]
              }
            >
              Redownload
            </Text>
          </Pressable>
        ) : null}
        {pack.inFlight ? (
          <Pressable
            style={[styles.btn, styles.btnDanger]}
            onPress={pack.cancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel clinical knowledge download"
          >
            <Text style={styles.btnText}>Cancel</Text>
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
              accessibilityLabel="Check for clinical knowledge updates"
            >
              <Text style={[styles.btnTextDark, themedStyles.btnTextDark]}>Check for updates</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnMuted, themedStyles.btnMuted]}
              onPress={() => {
                void pack.resetPack(runnerOptions);
              }}
              accessibilityRole="button"
              accessibilityLabel="Reset device clinical pack"
            >
              <Text style={[styles.btnTextDark, themedStyles.btnTextDark]}>Reset pack</Text>
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
