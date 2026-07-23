/**
 * Shared hook for the Care plan backup / restore flow (planning/41 §10).
 *
 * Extracted from `components/settings/settings-screen.tsx` so the same
 * handlers can be reused by the new Care tab "Backup & restore" section.
 * Track A (Expo Go) gracefully degrades to a status preview because
 * `expo-sharing` / `expo-document-picker` are not available.
 */

import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { getPatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';

export type CarePlanBackupStatus =
  | { kind: 'idle' }
  | { kind: 'ready'; message: string }
  | { kind: 'shared'; message: string }
  | { kind: 'preview'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'consent_required' }
  | { kind: 'no_plan' };

export interface UseCarePlanBackupOptions {
  /** Called after a successful restore so Care can rebuild the snapshot. */
  onRestored?: () => void;
}

export interface UseCarePlanBackupResult {
  status: CarePlanBackupStatus;
  exportInFlight: boolean;
  importInFlight: boolean;
  exportBackup: (options: { autoGrantConsent: boolean }) => Promise<void>;
  importBackup: () => Promise<void>;
  resetStatus: () => void;
}

export function useCarePlanBackup(
  patientId: string | null,
  options?: UseCarePlanBackupOptions,
): UseCarePlanBackupResult {
  const [status, setStatus] = useState<CarePlanBackupStatus>({ kind: 'idle' });
  const [exportInFlight, setExportInFlight] = useState(false);
  const [importInFlight, setImportInFlight] = useState(false);
  const onRestored = options?.onRestored;

  const resetStatus = useCallback(() => setStatus({ kind: 'idle' }), []);

  const exportBackup = useCallback(
    async (options: { autoGrantConsent: boolean }) => {
      if (!patientId || exportInFlight) return;
      setExportInFlight(true);
      try {
        const snapshot = getPatientRecordSnapshot(patientId);
        const { exportAdcpBundle } = await import(
          '@/services/carePlan/adcpExportService'
        );
        const result = exportAdcpBundle({
          snapshot,
          autoGrantConsent: options.autoGrantConsent,
        });
        if (result.consentRequired) {
          setStatus({ kind: 'consent_required' });
          Alert.alert(
            'Consent required',
            'Enable Care plan backup consent, then try again.',
          );
          return;
        }
        if (!result.ok || !result.json || !result.filename) {
          setStatus({ kind: 'no_plan' });
          Alert.alert(
            'No plan to export',
            result.reason ?? 'No active care plan revision.',
          );
          return;
        }

        const sizeLabel = `${result.bundleSize ?? 0} bytes`;
        setStatus({
          kind: 'ready',
          message: `Backup ready (${sizeLabel}) \u2014 exporting\u2026`,
        });

        try {
          const Sharing = await import('expo-sharing');
          const { File, Paths } = await import('expo-file-system');
          const tmpDir = Paths.cache?.uri ?? Paths.document?.uri ?? '';
          const tmpPath = `${tmpDir.replace(/\/$/, '')}/${result.filename}`;
          const file = new File(tmpPath);
          await file.create();
          await file.write(result.json);
          await Sharing.shareAsync(file.uri, {
            mimeType: 'application/json',
            dialogTitle: 'Care plan backup',
          });
          setStatus({
            kind: 'shared',
            message: `Exported ${result.filename} \u2014 ${sizeLabel}.`,
          });
        } catch (shareErr) {
          console.warn('[useCarePlanBackup] share unavailable, preview only:', shareErr);
          setStatus({
            kind: 'preview',
            message: `${result.filename} ready (${sizeLabel}). Track-A preview \u2014 copy from logs if needed.`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus({ kind: 'error', message: `Export failed: ${msg}` });
        Alert.alert('Export failed', msg);
      } finally {
        setExportInFlight(false);
      }
    },
    [patientId, exportInFlight],
  );

  const importBackup = useCallback(async () => {
    if (!patientId || importInFlight) return;
    setImportInFlight(true);
    try {
      const DocumentPicker = await import('expo-document-picker');
      const pickerResult = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'public.json', '*/*'],
        copyToCacheDirectory: true,
      });
      if (pickerResult.canceled || pickerResult.assets.length === 0) {
        return;
      }
      const asset = pickerResult.assets[0];
      if (!asset?.uri) {
        Alert.alert('Restore failed', 'No file URI returned from picker.');
        return;
      }
      const { File } = await import('expo-file-system');
      const file = new File(asset.uri);
      const json = await file.text();
      const { importAdcpBundleFromJsonText } = await import(
        '@/services/carePlan/adcpImportService'
      );
      const outcome = importAdcpBundleFromJsonText({
        activePatientId: patientId,
        jsonText: json,
      });
      if (!outcome.ok) {
        Alert.alert('Restore failed', outcome.reason ?? 'Unknown error.');
        return;
      }
      const versionLabel =
        outcome.newPlanVersion != null
          ? ` as care plan v${outcome.newPlanVersion}`
          : '';
      setStatus({
        kind: 'ready',
        message: `Restored${versionLabel} from ${asset.name ?? 'care plan backup'}.`,
      });
      onRestored?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', message: `Restore failed: ${msg}` });
      Alert.alert('Restore failed', msg);
    } finally {
      setImportInFlight(false);
    }
  }, [patientId, importInFlight, onRestored]);

  return { status, exportInFlight, importInFlight, exportBackup, importBackup, resetStatus };
}
