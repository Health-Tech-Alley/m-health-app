/**
 * Settings context.
 *
 * Holds all app-level settings (mode, theme, notification preferences) and
 * persists them to the app_settings SQLite table. The mode (demo/developer)
 * drives SLM auto-management policy and mode-gated navigation.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme, type ColorSchemeName } from 'react-native';

import {
  getAppSettings,
  updateAppMode,
  updateCarePlanMode,
  updateConciergeReasoning,
  updateTheme,
  updateLanguagePreference,
  updateNotificationPreferences,
  updateDemoDefaultModelId,
  updateDynamicSlmLoading,
  updateNluDevelopmentFallback,
  updateEvidenceDevelopmentFallback,
  updateKnowledgeGraphExpansion,
  updateLiveClinicalFetch,
  updateHealthKitIntegrationEnabled,
  updateSimulateMissingOptionalFeatures,
  type AppSettings,
} from '@/data';
import type {
  AppMode,
  CarePlanMode,
  ConciergeReasoningMode,
  ThemePreference,
  NotificationPreferences,
} from '@/data/types';

export type EffectiveColorScheme = 'light' | 'dark';

interface SettingsContextValue {
  settings: AppSettings;
  mode: AppMode;
  isDeveloper: boolean;
  effectiveColorScheme: EffectiveColorScheme;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;
  setTheme: (theme: ThemePreference) => void;
  setLanguagePreference: (languagePreference: string) => void;
  setNotificationPreferences: (prefs: Partial<NotificationPreferences>) => void;
  setDemoDefaultModelId: (modelId: string) => void;
  setDynamicSlmLoading: (enabled: boolean) => void;
  setNluDevelopmentFallback: (enabled: boolean) => void;
  setEvidenceDevelopmentFallback: (enabled: boolean) => void;
  setKnowledgeGraphExpansion: (enabled: boolean) => void;
  setLiveClinicalFetch: (enabled: boolean) => void;
  setCarePlanMode: (mode: CarePlanMode) => void;
  setHealthKitIntegrationEnabled: (enabled: boolean) => void;
  setSimulateMissingOptionalFeatures: (enabled: boolean) => void;
  setConciergeReasoning: (mode: ConciergeReasoningMode) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function resolveEffectiveColorScheme(
  preference: ThemePreference,
  systemScheme: ColorSchemeName,
): EffectiveColorScheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemScheme === 'dark' ? 'dark' : 'light';
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => getAppSettings());
  const systemColorScheme = useColorScheme();
  const effectiveColorScheme = resolveEffectiveColorScheme(
    settings.theme,
    systemColorScheme,
  );

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

  const setLanguagePreference = useCallback((languagePreference: string) => {
    const updated = updateLanguagePreference(languagePreference);
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

  const setLiveClinicalFetch = useCallback((enabled: boolean) => {
    const updated = updateLiveClinicalFetch(enabled);
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

  const setSimulateMissingOptionalFeatures = useCallback((enabled: boolean) => {
    const updated = updateSimulateMissingOptionalFeatures(enabled);
    setSettings(updated);
  }, []);

  const setConciergeReasoning = useCallback((mode: ConciergeReasoningMode) => {
    const updated = updateConciergeReasoning(mode);
    setSettings(updated);
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      mode: settings.mode,
      isDeveloper: settings.mode === 'developer',
      effectiveColorScheme,
      setMode,
      toggleMode,
      setTheme,
      setLanguagePreference,
      setNotificationPreferences,
      setDemoDefaultModelId,
      setDynamicSlmLoading,
      setNluDevelopmentFallback,
      setEvidenceDevelopmentFallback,
      setKnowledgeGraphExpansion,
      setLiveClinicalFetch,
      setCarePlanMode,
      setHealthKitIntegrationEnabled,
      setSimulateMissingOptionalFeatures,
      setConciergeReasoning,
    }),
    [
      settings,
      effectiveColorScheme,
      setMode,
      toggleMode,
      setTheme,
      setLanguagePreference,
      setNotificationPreferences,
      setDemoDefaultModelId,
      setDynamicSlmLoading,
      setNluDevelopmentFallback,
      setEvidenceDevelopmentFallback,
      setKnowledgeGraphExpansion,
      setLiveClinicalFetch,
      setCarePlanMode,
      setHealthKitIntegrationEnabled,
      setSimulateMissingOptionalFeatures,
      setConciergeReasoning,
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
