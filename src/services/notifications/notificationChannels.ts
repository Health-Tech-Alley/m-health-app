/**
 * Notification channel + iOS category metadata.
 *
 * Android channels group notifications so the user can configure per-channel
 * sound, vibration, and importance in system settings. iOS uses categories
 * to attach interactive actions (e.g. "Mark given", "Snooze 15m").
 *
 * The service calls `setupNotificationChannels` once during `initNotifications`.
 * On iOS the channel constants are unused at the OS level but kept as a
 * source of truth for category identifiers.
 */

import { Platform } from 'react-native';

export type NotificationChannelId = 'anomaly-critical' | 'anomaly' | 'medication' | 'appointment';

export interface NotificationChannelMeta {
  id: NotificationChannelId;
  name: string;
  description: string;
  /** Android importance: 'high' (pops heads-up) or 'default'. */
  importance: 'high' | 'default';
  bypassDnd?: boolean;
  scopes: ('anomaly' | 'medication' | 'appointment' | 'care_task')[];
}

export const NOTIFICATION_CHANNELS: Record<NotificationChannelId, NotificationChannelMeta> = {
  'anomaly-critical': {
    id: 'anomaly-critical',
    name: 'Critical anomaly alerts',
    description: 'Severity-3 vitals anomalies. High priority, bypasses DND when permitted.',
    importance: 'high',
    bypassDnd: true,
    scopes: ['anomaly'],
  },
  anomaly: {
    id: 'anomaly',
    name: 'Health anomaly alerts',
    description: 'Non-emergency vitals anomalies. High priority, does not bypass DND.',
    importance: 'high',
    scopes: ['anomaly'],
  },
  medication: {
    id: 'medication',
    name: 'Medication reminders',
    description: 'Scheduled medication dose reminders.',
    importance: 'default',
    scopes: ['medication'],
  },
  appointment: {
    id: 'appointment',
    name: 'Appointment reminders',
    description: 'Upcoming appointment and care-task reminders.',
    importance: 'default',
    scopes: ['appointment', 'care_task'],
  },
};

/**
 * Pick the channel id for a given notification scope + severity.
 */
export function channelForScope(
  scope: 'anomaly' | 'medication' | 'appointment' | 'care_task',
  severity?: number,
): NotificationChannelId {
  if (severity === 3) return 'anomaly-critical';
  if (scope === 'anomaly') return 'anomaly';
  if (scope === 'medication') return 'medication';
  return 'appointment';
}

/**
 * Create the Android notification channels + iOS categories.
 *
 * @param notificationsModule the loaded `expo-notifications` module.
 */
export async function setupNotificationChannels(notificationsModule: any): Promise<void> {
  if (!notificationsModule) return;

  if (Platform.OS === 'android') {
    const { setNotificationChannelAsync } = notificationsModule;
    if (typeof setNotificationChannelAsync !== 'function') return;
    for (const meta of Object.values(NOTIFICATION_CHANNELS)) {
      try {
        await setNotificationChannelAsync(meta.id, {
          name: meta.name,
          description: meta.description,
          importance: meta.importance === 'high' ? notificationsModule.AndroidImportance?.HIGH ?? 4 : notificationsModule.AndroidImportance?.DEFAULT ?? 3,
          enableVibrate: meta.importance === 'high',
          ...(meta.bypassDnd ? { bypassDnd: true } : {}),
        });
      } catch (err) {
        console.warn('[notificationChannels] failed to create channel', meta.id, err);
      }
    }
  }

  if (Platform.OS === 'ios') {
    const { setNotificationCategoryAsync } = notificationsModule;
    if (typeof setNotificationCategoryAsync !== 'function') return;
    try {
      await setNotificationCategoryAsync('medication', [
        { id: 'taken', title: 'Mark given', options: { opensAppToForeground: false } },
        { id: 'snooze', title: 'Snooze 15m', options: { opensAppToForeground: false } },
      ]);
      await setNotificationCategoryAsync('anomaly', [
        { id: 'open', title: 'Open', options: { opensAppToForeground: true } },
      ]);
    } catch (err) {
      console.warn('[notificationChannels] failed to set categories:', err);
    }
  }
}
