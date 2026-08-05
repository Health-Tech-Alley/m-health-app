/**
 * Care plan "Backup & restore" section (planning/41 §5, §10).
 *
 * Reuses `useCarePlanBackup` so the same UX lives on the Care tab and in
 * Settings. Copy uses "Care plan backup" / "Care plan file" — never
 * "ADCP" in the caregiver UI (D3).
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { useCarePlanBackup, type CarePlanBackupStatus } from '@/hooks/useCarePlanBackup';
import { useTheme } from '@/hooks/use-theme';
import { createThemedSectionStyles } from './carePlanSectionStyles';

export interface CarePlanBackupSectionProps {
  patientId: string | null;
  autoGrantConsent: boolean;
  /** Refresh patient snapshot after a successful restore. */
  onRestored?: () => void;
}

export function CarePlanBackupSection({
  patientId,
  autoGrantConsent,
  onRestored,
}: CarePlanBackupSectionProps) {
  const theme = useTheme();
  const sectionStyles = useMemo(() => createThemedSectionStyles(theme), [theme]);
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const { status, exportInFlight, importInFlight, exportBackup, importBackup } =
    useCarePlanBackup(patientId, { onRestored });

  return (
    <View style={sectionStyles.card} accessible accessibilityLabel="Backup and restore">
      <View style={sectionStyles.headerRow}>
        <Text style={sectionStyles.title}>Backup & restore</Text>
      </View>
      <Text style={sectionStyles.subtitle}>
        Save a care plan file you can store outside the device, or restore one you saved earlier.
      </Text>

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.actionButton, styles.exportButton, exportInFlight && styles.actionButtonDisabled]}
          onPress={() => void exportBackup({ autoGrantConsent })}
          disabled={exportInFlight || !patientId}
          accessibilityRole="button"
          accessibilityLabel="Save a care plan file"
        >
          <Text style={styles.exportText}>
            {exportInFlight ? 'Saving\u2026' : 'Save a care plan file'}
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.actionButton,
            styles.importButton,
            themedStyles.importButton,
            importInFlight && styles.actionButtonDisabled,
          ]}
          onPress={() => void importBackup()}
          disabled={importInFlight || !patientId}
          accessibilityRole="button"
          accessibilityLabel="Restore from a care plan file"
        >
          <Text style={[styles.importText, themedStyles.importText]}>
            {importInFlight ? 'Restoring\u2026' : 'Restore from file'}
          </Text>
        </Pressable>
      </View>

      <StatusLine status={status} />
    </View>
  );
}

function StatusLine({ status }: { status: CarePlanBackupStatus }) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  if (status.kind === 'idle') return null;
  let text: string | null = null;
  let tone: 'muted' | 'success' | 'warning' | 'error' = 'muted';
  switch (status.kind) {
    case 'ready':
    case 'shared':
      text = status.message;
      tone = 'success';
      break;
    case 'preview':
      text = status.message;
      tone = 'warning';
      break;
    case 'consent_required':
      text = 'Consent required before export.';
      tone = 'warning';
      break;
    case 'no_plan':
      text = 'No published care plan to export.';
      tone = 'muted';
      break;
    case 'error':
      text = status.message;
      tone = 'error';
      break;
  }
  if (!text) return null;
  const styleByTone = {
    muted: themedStyles.statusMuted,
    success: themedStyles.statusSuccess,
    warning: themedStyles.statusWarning,
    error: themedStyles.statusError,
  }[tone];
  return <Text style={[styles.status, styleByTone]}>{text}</Text>;
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';

  return StyleSheet.create({
    importButton: {
      backgroundColor: theme.appControlSurface,
      borderColor: theme.appBorder,
    },
    importText: {
      color: theme.appText,
    },
    statusMuted: {
      color: theme.appTextMuted,
    },
    statusSuccess: {
      color: isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand,
    },
    statusWarning: {
      color: AppTheme.colors.warning,
    },
    statusError: {
      color: AppTheme.colors.danger,
    },
  });
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  actionButton: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  exportButton: {
    backgroundColor: AppTheme.colors.brand,
  },
  importButton: {
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  exportText: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: '900',
  },
  importText: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  status: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  statusMuted: {
    color: AppTheme.colors.textMuted,
  },
  statusSuccess: {
    color: AppTheme.colors.brand,
  },
  statusWarning: {
    color: AppTheme.colors.warning,
  },
  statusError: {
    color: AppTheme.colors.danger,
  },
});
