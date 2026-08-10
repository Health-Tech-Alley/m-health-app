import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useSettings } from "@/contexts/settings-context";
import {
  languageFromPreference,
  localeFromLanguage,
  resolveActiveLanguagePreference,
  translate,
  type AppLanguage,
  type AppLocale,
  type TranslateFn,
} from "@/localization/i18n";

interface LocalizationContextValue {
  language: AppLanguage;
  locale: AppLocale;
  t: TranslateFn;
  setTemporaryLanguagePreference: (preference: string | null | undefined) => void;
  clearTemporaryLanguagePreference: () => void;
}

const LocalizationContext = createContext<LocalizationContextValue | null>(null);

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [temporaryPreference, setTemporaryPreference] = useState<string | null>(null);
  const activePreference = resolveActiveLanguagePreference({
    temporaryPreference,
    localPreference: settings.languagePreference,
  });
  const language = languageFromPreference(activePreference);
  const locale = localeFromLanguage(language);

  const t = useCallback<TranslateFn>(
    (key, params) => translate(key, language, params),
    [language],
  );

  const setTemporaryLanguagePreference = useCallback(
    (preference: string | null | undefined) => {
      setTemporaryPreference(preference ?? null);
    },
    [],
  );

  const clearTemporaryLanguagePreference = useCallback(() => {
    setTemporaryPreference(null);
  }, []);

  const value = useMemo<LocalizationContextValue>(
    () => ({
      language,
      locale,
      t,
      setTemporaryLanguagePreference,
      clearTemporaryLanguagePreference,
    }),
    [language, locale, t, setTemporaryLanguagePreference, clearTemporaryLanguagePreference],
  );

  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
}

export function useLocalization(): LocalizationContextValue {
  const ctx = useContext(LocalizationContext);
  if (!ctx) {
    throw new Error("useLocalization must be used within a LocalizationProvider");
  }
  return ctx;
}
