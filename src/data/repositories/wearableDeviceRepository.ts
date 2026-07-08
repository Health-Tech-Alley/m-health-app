import { getDatabase } from '../db';
import type { WearableDevice, WearableBaselineStatus } from '../types';

export function upsertWearableDevice(device: WearableDevice): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO wearable_devices
      (device_id, patient_id, device_type, device_label, connected,
       baseline_status, baseline_started_at, baseline_completed_at,
       created_at, updated_at, healthkit_source_id, healthkit_source_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    device.deviceId,
    device.patientId,
    device.deviceType,
    device.deviceLabel ?? null,
    device.connected ? 1 : 0,
    device.baselineStatus,
    device.baselineStartedAt ?? null,
    device.baselineCompletedAt ?? null,
    device.createdAt,
    device.updatedAt,
    device.healthkitSourceId ?? null,
    device.healthkitSourceName ?? null,
  );
}

export function getWearableDevicesForPatient(patientId: string): WearableDevice[] {
  const db = getDatabase();
  return db.getAllSync<WearableDevice>(
    `SELECT device_id AS deviceId, patient_id AS patientId, device_type AS deviceType,
            device_label AS deviceLabel, connected, baseline_status AS baselineStatus,
            baseline_started_at AS baselineStartedAt,
            baseline_completed_at AS baselineCompletedAt,
            created_at AS createdAt, updated_at AS updatedAt,
            healthkit_source_id AS healthkitSourceId,
            healthkit_source_name AS healthkitSourceName
     FROM wearable_devices
     WHERE patient_id = ?
     ORDER BY created_at DESC;`,
    patientId,
  );
}

export function getPrimaryWearableForPatient(patientId: string): WearableDevice | null {
  const db = getDatabase();
  return (
    db.getFirstSync<WearableDevice>(
      `SELECT device_id AS deviceId, patient_id AS patientId, device_type AS deviceType,
              device_label AS deviceLabel, connected, baseline_status AS baselineStatus,
              baseline_started_at AS baselineStartedAt,
              baseline_completed_at AS baselineCompletedAt,
              created_at AS createdAt, updated_at AS updatedAt,
              healthkit_source_id AS healthkitSourceId,
              healthkit_source_name AS healthkitSourceName
       FROM wearable_devices
       WHERE patient_id = ?
       ORDER BY connected DESC, created_at DESC
       LIMIT 1;`,
      patientId,
    ) ?? null
  );
}

export function updateWearableBaselineStatus(
  deviceId: string,
  status: WearableBaselineStatus,
  startedAt?: string,
  completedAt?: string,
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `UPDATE wearable_devices
     SET baseline_status = ?, baseline_started_at = COALESCE(?, baseline_started_at),
         baseline_completed_at = COALESCE(?, baseline_completed_at), updated_at = ?
     WHERE device_id = ?;`,
    status,
    startedAt ?? null,
    completedAt ?? null,
    now,
    deviceId,
  );
}

export function setWearableConnected(deviceId: string, connected: boolean): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    'UPDATE wearable_devices SET connected = ?, updated_at = ? WHERE device_id = ?;',
    connected ? 1 : 0,
    now,
    deviceId,
  );
}

export function setWearableHealthKitSource(
  deviceId: string,
  sourceId: string | null,
  sourceName: string | null,
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `UPDATE wearable_devices
     SET healthkit_source_id = ?, healthkit_source_name = ?, updated_at = ?
     WHERE device_id = ?;`,
    sourceId,
    sourceName,
    now,
    deviceId,
  );
}

export function deleteWearableDevicesForPatient(patientId: string): void {
  const db = getDatabase();
  db.runSync('DELETE FROM wearable_devices WHERE patient_id = ?;', patientId);
}
