/**
 * Shared Concierge model download card (Device setup + Settings).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import {
  useModelDownloadQueue,
  type ModelDownloadRow,
} from '@/hooks/useModelDownloadQueue';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function Row({
  row,
  disableStart,
  showDelete,
  onDownload,
  onCancel,
  onDelete,
}: {
  row: ModelDownloadRow;
  disableStart: boolean;
  showDelete: boolean;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const progress =
    row.totalBytes > 0 ? Math.round((row.bytesWritten / row.totalBytes) * 100) : 0;

  return (
    <View style={styles.row} accessibilityRole="summary">
      <Text style={styles.rowTitle}>{row.displayName}</Text>
      <Text style={styles.rowMeta}>~{formatBytes(row.sizeBytes)}</Text>
      {row.status === 'downloading' ? (
        <>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.rowMeta}>
            {progress}% · {formatBytes(row.bytesWritten)} / {formatBytes(row.totalBytes)}
          </Text>
          <Pressable
            style={[styles.btn, styles.btnDanger]}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel={`Cancel download of ${row.displayName}`}
          >
            <Text style={styles.btnText}>Cancel</Text>
          </Pressable>
        </>
      ) : null}
      {row.status === 'installed' ? (
        <View style={styles.actions}>
          <Text style={styles.done}>✓ Installed</Text>
          {showDelete ? (
            <Pressable
              style={[styles.btn, styles.btnMuted]}
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${row.displayName}`}
            >
              <Text style={styles.btnTextDark}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {row.status === 'not_installed' || row.status === 'error' ? (
        <>
          {row.error ? <Text style={styles.error}>{row.error}</Text> : null}
          <Pressable
            style={[styles.btn, styles.btnPrimary, disableStart && styles.btnDisabled]}
            disabled={disableStart}
            onPress={onDownload}
            accessibilityRole="button"
            accessibilityLabel={`Download ${row.displayName}`}
          >
            <Text style={styles.btnText}>
              {row.status === 'error' ? 'Retry' : 'Download'}
            </Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

export type SlmDownloadCardProps = {
  title?: string;
  subtitle?: string;
  showDelete?: boolean;
  hfTokenHint?: boolean;
  onNeedHfToken?: () => void;
};

export function SlmDownloadCard({
  title = 'Concierge model',
  subtitle = 'Hugging Face · one download at a time',
  showDelete = false,
  hfTokenHint = false,
  onNeedHfToken,
}: SlmDownloadCardProps) {
  const queue = useModelDownloadQueue();

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {hfTokenHint ? (
        <Pressable onPress={onNeedHfToken} accessibilityRole="link">
          <Text style={styles.link}>Add Hugging Face token in Settings if download fails (401)</Text>
        </Pressable>
      ) : null}
      {queue.rows.map((row) => (
        <Row
          key={row.id}
          row={row}
          showDelete={showDelete}
          disableStart={queue.anyDownloading && queue.activeModelId !== row.id}
          onDownload={() => {
            void queue.startDownload(row.id);
          }}
          onCancel={() => queue.cancelDownload(row.id)}
          onDelete={() => queue.removeModel(row.id)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    gap: 10,
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
  link: {
    fontSize: 13,
    color: AppTheme.colors.brand,
    textDecorationLine: 'underline',
  },
  row: {
    gap: 6,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: AppTheme.colors.border,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: AppTheme.colors.text,
  },
  rowMeta: {
    fontSize: 12,
    color: AppTheme.colors.textMuted,
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  done: {
    color: AppTheme.colors.brand,
    fontWeight: '600',
  },
  error: {
    color: '#b42318',
    fontSize: 12,
  },
  btn: {
    alignSelf: 'flex-start',
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
  btnDisabled: {
    opacity: 0.45,
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
