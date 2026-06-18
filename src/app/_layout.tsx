/**
 * Root layout for the Expo Router app.
 *
 * Wraps the mobile app with:
 *   SettingsProvider → PatientRecordProvider → SLMProvider → OrchestratorProvider
 *
 * PatientRecordProvider seeds the SQLite DB from the onboarding profile and
 * exposes the denormalized patient record snapshot that the orchestrator and
 * the SLM system prompt both consume.
 */

import { useEffect } from 'react';
import { DefaultTheme, Stack, ThemeProvider } from "expo-router";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { InAppBanner } from "@/components/notifications/in-app-banner";
import { ActiveAlertModal } from "@/components/dashboard/ActiveAlertModal";
import { ActiveAlertProvider } from "@/contexts/active-alert-context";
import { OrchestratorProvider } from "@/contexts/orchestrator-context";
import { PatientRecordProvider } from "@/contexts/patient-record-context";
import { SettingsProvider, useSettings } from "@/contexts/settings-context";
import { SLMProvider, useSLM } from "@/contexts/slm-context";

function SlmPolicySync() {
  const { mode } = useSettings();
  const { setPolicy } = useSLM();
  useEffect(() => {
    setPolicy(mode === 'demo' ? 'auto' : 'manual');
  }, [mode, setPolicy]);
  return null;
}

function NotificationInit() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { initNotifications } = await import('@/services/notifications');
        if (!cancelled) await initNotifications();
      } catch {
        // Notifications unavailable (Track A without expo-notifications) — graceful.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return null;
}

export default function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <SettingsProvider>
        <PatientRecordProvider>
          <SLMProvider>
            <SlmPolicySync />
            <NotificationInit />
            <OrchestratorProvider>
              <ActiveAlertProvider>
                <AnimatedSplashOverlay />
                <InAppBanner />
                <ActiveAlertModal />
                <Stack screenOptions={{ headerShown: false }} />
              </ActiveAlertProvider>
            </OrchestratorProvider>
          </SLMProvider>
        </PatientRecordProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
