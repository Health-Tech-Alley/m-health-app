/**
 * Notification service (L2 App Service).
 *
 * The single seam between the app and `expo-notifications`. Wraps scheduling,
 * immediate dispatch, cancellation, and the notification-response handler.
 *
 * `expo-notifications` is NOT a hard dependency — it is `require()`d lazily
 * inside a try/catch (mirroring `src/inference/llama-rn-provider.ts`). When
 * the module is absent (Track A / Expo Go without the plugin), the service
 * falls back to the in-app banner emitter (`notificationFallback.ts`) and
 * still writes a `NotificationRecord` to SQLite so the audit trail is intact.
 *
 * Every dispatch is audited via `auditService` and deduped per `triggerRef`
 * within a 60-second window.
 */

import { Platform } from 'react-native';

import type { NotificationRecord, NotificationScope } from '@/data';
import {
  getRecentNotificationForTrigger,
  insertNotification,
  updateNotificationAction,
  updateNotificationDelivered,
} from '@/data';
import { audit } from '@/services/audit/auditService';

import { channelForScope, setupNotificationChannels } from './notificationChannels';
import { emitInAppBanner } from './notificationFallback';

const DEDUPE_WINDOW_MS = 60_000;

let notificationsModule: any | null | undefined;
let initPromise: Promise<void> | null = null;
let responseHandler: ((notificationId: string, action?: string) => void) | null = null;
let responseListener: any = null;

/**
 * Lazily require `expo-notifications`. Returns `null` if the module is not
 * installed (Track A without the plugin) — callers must handle the null case.
 */
function loadNotificationsModule(): any | null {
  if (notificationsModule !== undefined) return notificationsModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-notifications');
    notificationsModule = mod ?? null;
  } catch {
    notificationsModule = null;
  }
  return notificationsModule;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Initialize notifications: request permissions and set up channels/categories.
 * Safe to call multiple times — the work is memoized.
 */
export async function initNotifications(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const mod = loadNotificationsModule();
    if (!mod) {
      console.log('[notificationService] expo-notifications unavailable — using in-app banner fallback.');
      return;
    }
    try {
      if (typeof mod.getPermissionsAsync === 'function') {
        await mod.getPermissionsAsync();
      }
      await setupNotificationChannels(mod);
      registerResponseListener(mod);
    } catch (err) {
      console.warn('[notificationService] init failed, falling back to in-app banners:', err);
    }
  })();
  return initPromise;
}

export async function requestNotificationPermission(): Promise<boolean> {
  const mod = loadNotificationsModule();
  if (!mod || typeof mod.requestPermissionsAsync !== 'function') {
    return false;
  }
  try {
    const result = await mod.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        allowCriticalAlerts: true,
      },
    });
    const granted = result?.granted === true || result?.status === 'granted';
    if (granted) {
      await setupNotificationChannels(mod);
      registerResponseListener(mod);
    }
    return granted;
  } catch (err) {
    console.warn('[notificationService] permission request failed:', err);
    return false;
  }
}

function registerResponseListener(mod: any): void {
  if (responseListener || typeof mod.addNotificationResponseReceivedListener !== 'function') return;
  responseListener = mod.addNotificationResponseReceivedListener((response: any) => {
    const notificationId: string | undefined =
      response?.notification?.request?.identifier ?? response?.notification?.request?.content?.data?.notificationId;
    const action: string | undefined =
      response?.actionIdentifier ?? response?.notification?.request?.content?.data?.action;
    if (notificationId && responseHandler) {
      try {
        responseHandler(notificationId, action);
      } catch (err) {
        console.warn('[notificationService] response handler threw:', err);
      }
    }
  });
}

/**
 * Register a handler invoked when the user taps / acts on a notification.
 */
export function setNotificationResponseHandler(
  handler: (notificationId: string, action?: string) => void,
): void {
  responseHandler = handler;
}

export interface DispatchParams {
  patientId: string;
  scope: NotificationScope;
  triggerRef?: string;
  title: string;
  body: string;
  severity?: number;
  bypassDnd?: boolean;
}

export interface ScheduleParams extends DispatchParams {
  triggerWhen: Date;
  deviceDelivery?: boolean;
}

/**
 * Schedule a local notification for a future time. Writes a `NotificationRecord`
 * regardless of whether the native module is available.
 *
 * @returns the notification id, or `null` on failure.
 */
export async function scheduleLocalNotification(params: ScheduleParams): Promise<string | null> {
  const id = makeId('notif');
  const nowIso = new Date().toISOString();

  if (params.triggerRef) {
    const recent = getRecentNotificationForTrigger(params.patientId, params.triggerRef, DEDUPE_WINDOW_MS);
    if (recent) {
      console.log('[notificationService] dedupe: skipping recently dispatched notification for', params.triggerRef);
      return null;
    }
  }

  writeRecord(id, params, nowIso);

  if (params.deviceDelivery === false) {
    emitInAppBanner({ title: params.title, body: params.body, severity: params.severity, notificationId: id });
    auditDispatch(id, params, 'in_app_only');
    return id;
  }

  const mod = loadNotificationsModule();
  if (!mod) {
    emitInAppBanner({ title: params.title, body: params.body, severity: params.severity, notificationId: id });
    auditDispatch(id, params, 'fallback_banner');
    return id;
  }

  try {
    const channelId = channelForScope(params.scope, params.severity);
    const trigger =
      Platform.OS === 'android' && typeof mod.Trigger === 'object'
        ? { type: mod.TriggerType?.DATE ?? 0, date: params.triggerWhen, channelId }
        : { date: params.triggerWhen, channelId };
    const scheduledId = await mod.scheduleNotificationAsync({
      content: {
        title: params.title,
        body: params.body,
        data: { notificationId: id, scope: params.scope, triggerRef: params.triggerRef ?? null },
        ...(params.severity === 3 ? { interruptionLevel: 'critical' } : {}),
      },
      trigger,
    });
    auditDispatch(id, params, 'scheduled');
    return scheduledId ?? id;
  } catch (err) {
    console.warn('[notificationService] scheduleNotificationAsync failed, falling back to banner:', err);
    emitInAppBanner({ title: params.title, body: params.body, severity: params.severity, notificationId: id });
    auditDispatch(id, params, 'fallback_banner');
    return id;
  }
}

/**
 * Fire a notification immediately (no scheduling). Used by the orchestrator's
 * severity-3 fast path.
 */
export async function dispatchImmediate(params: DispatchParams): Promise<string | null> {
  const id = makeId('notif');
  const nowIso = new Date().toISOString();
  console.log('[notificationService] dispatchImmediate', params, 'id:', id);

  if (params.triggerRef) {
    const recent = getRecentNotificationForTrigger(params.patientId, params.triggerRef, DEDUPE_WINDOW_MS);
    if (recent) {
      console.log('[notificationService] dedupe: skipping recently dispatched notification for', params.triggerRef);
      return null;
    }
  }

  writeRecord(id, params, nowIso);

  const mod = loadNotificationsModule();
  if (!mod) {
    console.log('[notificationService] dispatchImmediate: fallback to banner');
    emitInAppBanner({ title: params.title, body: params.body, severity: params.severity, notificationId: id });
    auditDispatch(id, params, 'fallback_banner');
    return id;
  }

  try {

    console.log('[notificationService] dispatchImmediate: scheduling via expo-notifications');
    await mod.scheduleNotificationAsync({
      content: {
        title: params.title,
        body: params.body,
        data: { notificationId: id, scope: params.scope, triggerRef: params.triggerRef ?? null },
        ...(params.severity === 3 ? { interruptionLevel: 'critical' } : {}),
      },
      trigger: null,
    });
    console.log('[notificationService] dispatchImmediate: scheduled, updating delivered timestamp', id, nowIso);
    updateNotificationDelivered(id, nowIso);
    auditDispatch(id, params, 'immediate');
    return id;
  } catch (err) {
    console.warn('[notificationService] immediate dispatch failed, falling back to banner:', err);
    emitInAppBanner({ title: params.title, body: params.body, severity: params.severity, notificationId: id });
    auditDispatch(id, params, 'fallback_banner');
    return id;
  }
}

/**
 * Cancel a single scheduled notification by id.
 */
export async function cancelNotification(id: string): Promise<void> {
  const mod = loadNotificationsModule();
  if (mod && typeof mod.cancelScheduledNotificationAsync === 'function') {
    try {
      await mod.cancelScheduledNotificationAsync(id);
    } catch (err) {
      console.warn('[notificationService] cancelNotification failed:', err);
    }
  }
  updateNotificationAction(id, 'cancelled', new Date().toISOString());
}

/**
 * Cancel all pending notifications for a scope. Used by the reminder engine
 * before rescheduling and by the Settings UI when a scope is disabled.
 */
export async function cancelByScope(scope: NotificationScope): Promise<void> {
  const mod = loadNotificationsModule();
  if (mod && typeof mod.getAllScheduledNotificationsAsync === 'function') {
    try {
      const pending: any[] = await mod.getAllScheduledNotificationsAsync();
      for (const n of pending ?? []) {
        const nScope = n?.request?.content?.data?.scope;
        if (nScope === scope && typeof mod.cancelScheduledNotificationAsync === 'function') {
          await mod.cancelScheduledNotificationAsync(n.request.identifier);
        }
      }
    } catch (err) {
      console.warn('[notificationService] cancelByScope failed:', err);
    }
  }
}

/**
 * Count of currently-pending scheduled notifications (for the Settings UI).
 */
export async function getPendingNotifications(): Promise<number> {
  const mod = loadNotificationsModule();
  if (!mod || typeof mod.getAllScheduledNotificationsAsync !== 'function') return 0;
  try {
    const pending: any[] = await mod.getAllScheduledNotificationsAsync();
    return pending?.length ?? 0;
  } catch {
    return 0;
  }
}

function writeRecord(id: string, params: DispatchParams, nowIso: string): void {
  const record: NotificationRecord = {
    notificationId: id,
    patientId: params.patientId,
    scope: params.scope,
    triggerRef: params.triggerRef,
    title: params.title,
    body: params.body,
    severity: params.severity,
    bypassDnd: params.bypassDnd ?? false,
    createdAt: nowIso,
  };
  try {
    insertNotification(record);
  } catch (err) {
    console.warn('[notificationService] failed to insert NotificationRecord:', err);
  }
}

function auditDispatch(id: string, params: DispatchParams, channel: string): void {
  try {
    audit({
      actor: 'system',
      action: 'dispatch_notification',
      resourceType: 'notification',
      resourceId: id,
      patientId: params.patientId,
      payload: {
        scope: params.scope,
        triggerRef: params.triggerRef,
        severity: params.severity,
        bypassDnd: params.bypassDnd,
        channel,
      },
    });
  } catch (err) {
    console.warn('[notificationService] audit failed:', err);
  }
}
