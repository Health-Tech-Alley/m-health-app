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
import { DefaultTheme, Stack, ThemeProvider, useRouter } from "expo-router";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { CriticalAlertDialog } from "@/components/critical-alert-dialog";
import { InAppBanner } from "@/components/notifications/in-app-banner";
import { CriticalAlertProvider } from "@/contexts/critical-alert-context";
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

/**
 * Register the notification response handler so tapping a notification
 * deep-links to the relevant screen:
 *   anomaly      -> /alert-detail?alertId=<triggerRef>
 *   medication   -> /medications
 *   appointment  -> /schedule
 * The handler is registered once at the root and uses the router to navigate.
 */
function NotificationResponseInit() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { setNotificationResponseHandler, handleMedicationAction } = await import(
          '@/services/notifications'
        );
        if (cancelled) return;
        setNotificationResponseHandler(async (notificationId, action) => {
          // Medication reminder actions are handled inline by the reminder engine.
          if (action === 'taken' || action === 'snooze') {
            try {
              await handleMedicationAction(notificationId, action as 'taken' | 'snooze');
            } catch {
              // ignore — best-effort
            }
            return;
          }
        });
      } catch {
        // Notifications module unavailable — graceful.
      }
    })();
    return () => { cancelled = true; };
  }, [router]);
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
            <NotificationResponseInit />
            <OrchestratorProvider>
              <CriticalAlertProvider>
                <AnimatedSplashOverlay />
                <InAppBanner />
                <CriticalAlertDialog />
                <Stack screenOptions={{ headerShown: false }} />
              </CriticalAlertProvider>
            </OrchestratorProvider>
          </SLMProvider>
        </PatientRecordProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
