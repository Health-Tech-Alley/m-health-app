/**
 * Settings context.
 *
 * Holds all app-level settings (mode, theme, notification preferences) and
 * persists them to the app_settings SQLite table. The mode (demo/developer)
 * drives SLM auto-management policy and mode-gated navigation.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  getAppSettings,
  updateAppMode,
  updateCarePlanMode,
  updateTheme,
  updateNotificationPreferences,
  updateDemoDefaultModelId,
  updateDynamicSlmLoading,
  updateNluDevelopmentFallback,
  updateEvidenceDevelopmentFallback,
  updateKnowledgeGraphExpansion,
  updateHealthKitIntegrationEnabled,
  type AppSettings,
} from '@/data';
import type {
  AppMode,
  CarePlanMode,
  ThemePreference,
  NotificationPreferences,
} from '@/data/types';

interface SettingsContextValue {
  settings: AppSettings;
  mode: AppMode;
  isDeveloper: boolean;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;
  setTheme: (theme: ThemePreference) => void;
  setNotificationPreferences: (prefs: Partial<NotificationPreferences>) => void;
  setDemoDefaultModelId: (modelId: string) => void;
  setDynamicSlmLoading: (enabled: boolean) => void;
  setNluDevelopmentFallback: (enabled: boolean) => void;
  setEvidenceDevelopmentFallback: (enabled: boolean) => void;
  setKnowledgeGraphExpansion: (enabled: boolean) => void;
  setCarePlanMode: (mode: CarePlanMode) => void;
  setHealthKitIntegrationEnabled: (enabled: boolean) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => getAppSettings());

  const setMode = useCallback((mode: AppMode) => {
    const updated = updateAppMode(mode);
    setSettings(updated);
  }, []);

  const toggleMode = useCallback(() => {
    const newMode: AppMode = settings.mode === 'demo' ? 'developer' : 'demo';
    setMode(newMode);
  }, [settings.mode, setMode]);

  const setTheme = useCallback((theme: ThemePreference) => {
    const updated = updateTheme(theme);
    setSettings(updated);
  }, []);

  const setNotificationPreferences = useCallback((prefs: Partial<NotificationPreferences>) => {
    const updated = updateNotificationPreferences(prefs);
    setSettings(updated);
  }, []);

  const setDemoDefaultModelId = useCallback((modelId: string) => {
    const updated = updateDemoDefaultModelId(modelId);
    setSettings(updated);
  }, []);

  const setDynamicSlmLoading = useCallback((enabled: boolean) => {
    const updated = updateDynamicSlmLoading(enabled);
    setSettings(updated);
  }, []);

  const setNluDevelopmentFallback = useCallback((enabled: boolean) => {
    const updated = updateNluDevelopmentFallback(enabled);
    setSettings(updated);
  }, []);

  const setEvidenceDevelopmentFallback = useCallback((enabled: boolean) => {
    const updated = updateEvidenceDevelopmentFallback(enabled);
    setSettings(updated);
  }, []);

  const setKnowledgeGraphExpansion = useCallback((enabled: boolean) => {
    const updated = updateKnowledgeGraphExpansion(enabled);
    setSettings(updated);
  }, []);

  const setCarePlanMode = useCallback((mode: CarePlanMode) => {
    const updated = updateCarePlanMode(mode);
    setSettings(updated);
  }, []);

  const setHealthKitIntegrationEnabled = useCallback((enabled: boolean) => {
    const updated = updateHealthKitIntegrationEnabled(enabled);
    setSettings(updated);
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      mode: settings.mode,
      isDeveloper: settings.mode === 'developer',
      setMode,
      toggleMode,
      setTheme,
      setNotificationPreferences,
      setDemoDefaultModelId,
      setDynamicSlmLoading,
      setNluDevelopmentFallback,
      setEvidenceDevelopmentFallback,
      setKnowledgeGraphExpansion,
      setCarePlanMode,
      setHealthKitIntegrationEnabled,
    }),
    [
      settings,
      setMode,
      toggleMode,
      setTheme,
      setNotificationPreferences,
      setDemoDefaultModelId,
      setDynamicSlmLoading,
      setNluDevelopmentFallback,
      setEvidenceDevelopmentFallback,
      setKnowledgeGraphExpansion,
      setCarePlanMode,
      setHealthKitIntegrationEnabled,
    ],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return ctx;
}
