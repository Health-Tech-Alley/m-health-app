/**
 * Repository for app-level settings (mode, theme, notification prefs, etc.).
 * Stored as key → JSON in the app_settings table.
 */

import { getDatabase } from '../db';
import { DEFAULT_SLM_MODEL_ID } from '@/inference/model-catalog';
import type {
  AppSettings,
  AppMode,
  CarePlanMode,
  ConciergeReasoningMode,
  ThemePreference,
  NotificationPreferences,
} from '../types';

const SETTINGS_KEY = 'app_settings';
const ACTIVE_PATIENT_KEY = 'active_patient_id';
type AppSettingsDatabase = ReturnType<typeof getDatabase>;

const DEFAULT_SETTINGS: AppSettings = {
  mode: 'demo',
  demoDefaultModelId: DEFAULT_SLM_MODEL_ID,
  theme: 'system',
  languagePreference: 'English',
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
  dynamicSlmLoading: true,
  nluDevelopmentFallback: false,
  evidenceDevelopmentFallback: false,
  knowledgeGraphExpansion: true,
  knowledgePackRunner: true,
  liveClinicalFetch: true,
  carePlanMode: 'full',
  healthKitIntegrationEnabled: true,
  simulateMissingOptionalFeatures: false,
  conciergeReasoning: 'auto',
};

function normalizeAppLanguagePreference(value: unknown): string {
  return value === 'Español' ? 'Español' : 'English';
}

function mergeSettingsWithDefaults(parsed: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    languagePreference: normalizeAppLanguagePreference(parsed.languagePreference),
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(parsed.notifications ?? {}) },
  };
}

function parseSettingsJson(valueJson: string): Partial<AppSettings> | null {
  const parsed = JSON.parse(valueJson) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Partial<AppSettings>;
}

function hasPersistedLanguagePreference(parsed: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(parsed, 'languagePreference');
}

function readJsonSetting(db: AppSettingsDatabase, key: string): unknown {
  const row = db.getFirstSync<{ value_json: string }>(
    'SELECT value_json FROM app_settings WHERE key = ?;',
    key,
  );
  if (!row?.value_json) return null;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return null;
  }
}

function readCaregiverLanguageForPatient(
  db: AppSettingsDatabase,
  patientId: string,
): string | null {
  const row = db.getFirstSync<{ languagePreference: string | null }>(
    `SELECT language_preference AS languagePreference
       FROM caregivers
      WHERE patient_id = ?
      LIMIT 1;`,
    patientId,
  );
  return row?.languagePreference ?? null;
}

function readAnyCaregiverLanguage(
  db: AppSettingsDatabase,
  languagePreference: string,
): string | null {
  const row = db.getFirstSync<{ languagePreference: string | null }>(
    `SELECT language_preference AS languagePreference
       FROM caregivers
      WHERE language_preference = ?
      LIMIT 1;`,
    languagePreference,
  );
  return row?.languagePreference ?? null;
}

function adoptLegacyCaregiverLanguagePreference(db: AppSettingsDatabase): string {
  const activePatientId = readJsonSetting(db, ACTIVE_PATIENT_KEY);
  if (typeof activePatientId === 'string' && activePatientId.trim()) {
    const activeCaregiverLanguage = readCaregiverLanguageForPatient(
      db,
      activePatientId.trim(),
    );
    if (activeCaregiverLanguage) {
      return normalizeAppLanguagePreference(activeCaregiverLanguage);
    }
  }

  if (readAnyCaregiverLanguage(db, 'Español')) {
    return 'Español';
  }
  return normalizeAppLanguagePreference(readAnyCaregiverLanguage(db, 'English'));
}

export function getAppSettings(): AppSettings {
  const db = getDatabase();
  const row = db.getFirstSync<{ value_json: string }>(
    'SELECT value_json FROM app_settings WHERE key = ?;',
    SETTINGS_KEY,
  );
  if (!row?.value_json) {
    const settings = {
      ...DEFAULT_SETTINGS,
      languagePreference: adoptLegacyCaregiverLanguagePreference(db),
    };
    saveAppSettings(settings);
    return settings;
  }
  try {
    const parsed = parseSettingsJson(row.value_json);
    if (!parsed) return { ...DEFAULT_SETTINGS };
    if (!hasPersistedLanguagePreference(parsed)) {
      const settings = mergeSettingsWithDefaults({
        ...parsed,
        languagePreference: adoptLegacyCaregiverLanguagePreference(db),
      });
      saveAppSettings(settings);
      return settings;
    }
    return mergeSettingsWithDefaults(parsed);
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

export function updateLanguagePreference(languagePreference: string): AppSettings {
  const current = getAppSettings();
  const updated = { ...current, languagePreference };
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

export function updateDynamicSlmLoading(enabled: boolean): AppSettings {
  const current = getAppSettings();
  const updated = { ...current, dynamicSlmLoading: enabled };
  saveAppSettings(updated);
  return updated;
}

export function updateNluDevelopmentFallback(enabled: boolean): AppSettings {
  const current = getAppSettings();
  const updated = { ...current, nluDevelopmentFallback: enabled };
  saveAppSettings(updated);
  return updated;
}

export function updateEvidenceDevelopmentFallback(enabled: boolean): AppSettings {
  const current = getAppSettings();
  const updated = { ...current, evidenceDevelopmentFallback: enabled };
  saveAppSettings(updated);
  return updated;
}

export function updateKnowledgeGraphExpansion(enabled: boolean): AppSettings {
  const current = getAppSettings();
  const updated = { ...current, knowledgeGraphExpansion: enabled };
  saveAppSettings(updated);
  return updated;
}

export function updateLiveClinicalFetch(enabled: boolean): AppSettings {
  const current = getAppSettings();
  const updated = { ...current, liveClinicalFetch: enabled };
  saveAppSettings(updated);
  try {
    const { setLiveClinicalFetch } = require('@/clinical-evidence/fixture-mode') as {
      setLiveClinicalFetch: (v: boolean) => void;
    };
    setLiveClinicalFetch(enabled);
  } catch {
    /* optional */
  }
  return updated;
}

export function updateCarePlanMode(mode: CarePlanMode): AppSettings {
  const current = getAppSettings();
  const updated = { ...current, carePlanMode: mode };
  saveAppSettings(updated);
  return updated;
}

export function updateHealthKitIntegrationEnabled(enabled: boolean): AppSettings {
  const current = getAppSettings();
  const updated = { ...current, healthKitIntegrationEnabled: enabled };
  saveAppSettings(updated);
  return updated;
}

export function updateSimulateMissingOptionalFeatures(enabled: boolean): AppSettings {
  const current = getAppSettings();
  const updated = { ...current, simulateMissingOptionalFeatures: enabled };
  saveAppSettings(updated);
  return updated;
}

/**
 * Reset developer-only test flags to their shipped defaults. Called at
 * onboarding completion so a stale `simulateMissingOptionalFeatures: true`
 * persisted from a previous dev session cannot survive a fresh onboarding —
 * the Simulate-missing flag must be off for first-run users.
 */
export function resetDeveloperTestFlags(): AppSettings {
  const current = getAppSettings();
  if (current.simulateMissingOptionalFeatures === false) {
    return current;
  }
  const updated = { ...current, simulateMissingOptionalFeatures: false };
  saveAppSettings(updated);
  return updated;
}

export function updateConciergeReasoning(mode: ConciergeReasoningMode): AppSettings {
  const current = getAppSettings();
  const updated = { ...current, conciergeReasoning: mode };
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
