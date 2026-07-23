/**
 * Repository for notification records and preferences.
 */

import { getDatabase } from '../db';
import type { NotificationRecord, NotificationScope, NotificationPreferences } from '../types';

const DEFAULT_PREFERENCES: NotificationPreferences = {
  anomaly: true,
  medication: true,
  medicationDevice: true,
  appointment: true,
  appointmentDevice: true,
  appointmentLeadTimeMin: 30,
  careTask: true,
  careTaskDevice: true,
};

export function insertNotification(record: NotificationRecord): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO notifications
      (notification_id, patient_id, scope, trigger_ref, title, body,
       severity, bypass_dnd, delivered_at, dismissed_at, action_taken, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    record.notificationId,
    record.patientId,
    record.scope,
    record.triggerRef ?? null,
    record.title,
    record.body,
    record.severity ?? null,
    record.bypassDnd ? 1 : 0,
    record.deliveredAt ?? null,
    record.dismissedAt ?? null,
    record.actionTaken ?? null,
    record.createdAt,
  );
}

export function updateNotificationDelivered(notificationId: string, deliveredAt: string): void {
  const db = getDatabase();
  db.runSync(
    'UPDATE notifications SET delivered_at = ? WHERE notification_id = ?;',
    deliveredAt,
    notificationId,
  );
}

export function updateNotificationAction(
  notificationId: string,
  action: string,
  dismissedAt?: string,
): void {
  const db = getDatabase();
  db.runSync(
    'UPDATE notifications SET action_taken = ?, dismissed_at = ? WHERE notification_id = ?;',
    action,
    dismissedAt ?? null,
    notificationId,
  );
}

export function getNotificationsForPatient(
  patientId: string,
  limit = 50,
): NotificationRecord[] {
  const db = getDatabase();
  return db.getAllSync<NotificationRecord>(
    `SELECT notification_id AS notificationId, patient_id AS patientId,
            scope, trigger_ref AS triggerRef, title, body,
            severity, bypass_dnd AS bypassDnd, delivered_at AS deliveredAt,
            dismissed_at AS dismissedAt, action_taken AS actionTaken,
            created_at AS createdAt
     FROM notifications
     WHERE patient_id = ?
     ORDER BY created_at DESC
     LIMIT ?;`,
    patientId,
    limit,
  );
}

export function getRecentNotificationForTrigger(
  patientId: string,
  triggerRef: string,
  withinMs: number,
): NotificationRecord | null {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - withinMs).toISOString();
  return (
    db.getFirstSync<NotificationRecord>(
      `SELECT notification_id AS notificationId, patient_id AS patientId,
              scope, trigger_ref AS triggerRef, title, body,
              severity, bypass_dnd AS bypassDnd, delivered_at AS deliveredAt,
              dismissed_at AS dismissedAt, action_taken AS actionTaken,
              created_at AS createdAt
       FROM notifications
       WHERE patient_id = ? AND trigger_ref = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1;`,
      patientId,
      triggerRef,
      cutoff,
    ) ?? null
  );
}

// --- Preferences ---

export function getNotificationPreferences(): NotificationPreferences {
  const db = getDatabase();
  const rows = db.getAllSync<{
    scope: string;
    enabled: number;
    device_enabled: number | null;
    lead_time_minutes: number | null;
    quiet_hours_start: string | null;
    quiet_hours_end: string | null;
  }>(
    `SELECT scope, enabled, device_enabled, lead_time_minutes, quiet_hours_start, quiet_hours_end
     FROM notification_preferences;`,
  );

  const prefs: NotificationPreferences = { ...DEFAULT_PREFERENCES };
  const byScope = new Map(rows.map((r) => [r.scope, r]));

  const anomalyRow = byScope.get('anomaly');
  if (anomalyRow) prefs.anomaly = anomalyRow.enabled === 1;
  const medRow = byScope.get('medication');
  if (medRow) {
    prefs.medication = medRow.enabled === 1;
    prefs.medicationDevice = medRow.device_enabled !== 0;
  }
  const apptRow = byScope.get('appointment');
  if (apptRow) {
    prefs.appointment = apptRow.enabled === 1;
    prefs.appointmentDevice = apptRow.device_enabled !== 0;
    if (apptRow.lead_time_minutes != null) prefs.appointmentLeadTimeMin = apptRow.lead_time_minutes;
  }
  const careRow = byScope.get('care_task');
  if (careRow) {
    prefs.careTask = careRow.enabled === 1;
    prefs.careTaskDevice = careRow.device_enabled !== 0;
  }

  // Quiet hours stored on the medication scope row.
  if (medRow) {
    prefs.quietHoursStart = medRow.quiet_hours_start ?? undefined;
    prefs.quietHoursEnd = medRow.quiet_hours_end ?? undefined;
  }

  return prefs;
}

export function setNotificationScopePreference(
  scope: NotificationScope,
  enabled: boolean,
  extra?: {
    deviceEnabled?: boolean;
    leadTimeMinutes?: number;
    quietHoursStart?: string;
    quietHoursEnd?: string;
  },
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  const current = getNotificationPreferences();
  const currentDevice =
    scope === 'medication'
      ? current.medicationDevice
      : scope === 'appointment'
        ? current.appointmentDevice
        : scope === 'care_task'
          ? current.careTaskDevice
          : true;
  db.runSync(
    `INSERT OR REPLACE INTO notification_preferences
      (scope, enabled, device_enabled, lead_time_minutes, quiet_hours_start, quiet_hours_end)
     VALUES (?, ?, ?, ?, ?, ?);`,
    scope,
    enabled ? 1 : 0,
    (extra?.deviceEnabled ?? currentDevice) ? 1 : 0,
    extra?.leadTimeMinutes ?? null,
    extra?.quietHoursStart ?? null,
    extra?.quietHoursEnd ?? null,
  );
  // touch updated_at-less table; no-op
  void now;
}

export function ensureDefaultNotificationPreferences(): void {
  const db = getDatabase();
  const count = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM notification_preferences;',
  );
  if ((count?.count ?? 0) > 0) return;

  const defaults: { scope: NotificationScope; enabled: number; lead: number | null }[] = [
    { scope: 'anomaly', enabled: 1, lead: null },
    { scope: 'medication', enabled: 1, lead: null },
    { scope: 'appointment', enabled: 1, lead: 30 },
    { scope: 'care_task', enabled: 1, lead: null },
  ];
  for (const d of defaults) {
    db.runSync(
      `INSERT OR IGNORE INTO notification_preferences
        (scope, enabled, device_enabled, lead_time_minutes)
       VALUES (?, ?, 1, ?);`,
      d.scope,
      d.enabled,
      d.lead,
    );
  }
}
