/**
 * Repository for app-level settings (mode, theme, notification prefs, etc.).
 * Stored as key → JSON in the app_settings table.
 */

import { getDatabase } from '../db';
import type { AppSettings, AppMode, ThemePreference, NotificationPreferences } from '../types';

const SETTINGS_KEY = 'app_settings';
const ACTIVE_PATIENT_KEY = 'active_patient_id';

const DEFAULT_SETTINGS: AppSettings = {
  mode: 'demo',
  demoDefaultModelId: 'healthgpt-pro-4b',
  theme: 'system',
  notifications: {
    anomaly: true,
    medication: true,
    medicationDevice: true,
    appointment: true,
    appointmentDevice: true,
    appointmentLeadTimeMin: 30,
    careTask: true,
    careTaskDevice: true,
  },
};

export function getAppSettings(): AppSettings {
  const db = getDatabase();
  const row = db.getFirstSync<{ value_json: string }>(
    'SELECT value_json FROM app_settings WHERE key = ?;',
    SETTINGS_KEY,
  );
  if (!row?.value_json) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(row.value_json) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      notifications: { ...DEFAULT_SETTINGS.notifications, ...(parsed.notifications ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAppSettings(settings: AppSettings): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?);`,
    SETTINGS_KEY,
    JSON.stringify(settings),
    now,
  );
}

export function updateAppMode(mode: AppMode): AppSettings {
  const current = getAppSettings();
  const updated = { ...current, mode };
  saveAppSettings(updated);
  return updated;
}

export function updateTheme(theme: ThemePreference): AppSettings {
  const current = getAppSettings();
  const updated = { ...current, theme };
  saveAppSettings(updated);
  return updated;
}

export function updateNotificationPreferences(prefs: Partial<NotificationPreferences>): AppSettings {
  const current = getAppSettings();
  const updated: AppSettings = {
    ...current,
    notifications: { ...current.notifications, ...prefs },
  };
  saveAppSettings(updated);
  return updated;
}

export function updateDemoDefaultModelId(modelId: string): AppSettings {
  const current = getAppSettings();
  const updated = { ...current, demoDefaultModelId: modelId };
  saveAppSettings(updated);
  return updated;
}

export function getActivePatientId(): string | null {
  const db = getDatabase();
  const row = db.getFirstSync<{ value_json: string }>(
    'SELECT value_json FROM app_settings WHERE key = ?;',
    ACTIVE_PATIENT_KEY,
  );
  if (!row?.value_json) return null;
  try {
    const parsed = JSON.parse(row.value_json);
    if (typeof parsed === 'string' && parsed.trim()) {
      return parsed;
    }
    clearActivePatientId();
    return null;
  } catch {
    clearActivePatientId();
    return null;
  }
}

export function setActivePatientId(patientId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?);`,
    ACTIVE_PATIENT_KEY,
    JSON.stringify(patientId),
    now,
  );
}

export function clearActivePatientId(): void {
  const db = getDatabase();
  db.runSync('DELETE FROM app_settings WHERE key = ?;', ACTIVE_PATIENT_KEY);
}
