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

import { useEffect, useState } from 'react';
import { DefaultTheme, Stack, ThemeProvider, useRouter } from "expo-router";
import { StyleSheet, Text, View } from 'react-native';

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { CriticalAlertDialog } from "@/components/critical-alert-dialog";
import { InAppBanner } from "@/components/notifications/in-app-banner";
import { CriticalAlertProvider } from "@/contexts/critical-alert-context";
import { OrchestratorProvider } from "@/contexts/orchestrator-context";
import { PatientRecordProvider } from "@/contexts/patient-record-context";
import { SettingsProvider, useSettings } from "@/contexts/settings-context";
import { SLMProvider, useSLM } from "@/contexts/slm-context";
import { UC2RuntimeProvider } from "@/contexts/uc2-runtime-context";
import { Provider } from 'react-redux';
import { store } from '@/store';
import { initializeDatabase } from '@/data';

import * as Notifications from 'expo-notifications';
import { AndroidNotificationPriority } from 'expo-notifications';

// Add this OUTSIDE any component, at the module level
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    /**
     * @platform ios
     */
    shouldSetBadge: true,
    priority: AndroidNotificationPriority.MAX,
  }),
});

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
  const [databaseInit] = useState<{ ready: boolean; error: Error | null }>(() => {
    try {
      initializeDatabase();
      return { ready: true, error: null };
    } catch (error) {
      return {
        ready: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  });

  if (databaseInit.error) {
    return (
      <ThemeProvider value={DefaultTheme}>
        <View style={styles.initErrorScreen}>
          <Text style={styles.initErrorTitle}>Unable to initialize the app database</Text>
          <Text style={styles.initErrorMessage}>{databaseInit.error.message}</Text>
        </View>
      </ThemeProvider>
    );
  }

  if (!databaseInit.ready) {
    return (
      <ThemeProvider value={DefaultTheme}>
        <AnimatedSplashOverlay />
      </ThemeProvider>
    );
  }

  return (
    <Provider store={store}>
      <ThemeProvider value={DefaultTheme}>
        <SettingsProvider>
          <PatientRecordProvider>
            <SLMProvider>
              <SlmPolicySync />
              <NotificationInit />
              <NotificationResponseInit />
              <UC2RuntimeProvider>
                <OrchestratorProvider>
                  <CriticalAlertProvider>
                    <AnimatedSplashOverlay />
                    <InAppBanner />
                    <CriticalAlertDialog />
                    <Stack screenOptions={{ headerShown: false }} />
                  </CriticalAlertProvider>
                </OrchestratorProvider>
              </UC2RuntimeProvider>
            </SLMProvider>
          </PatientRecordProvider>
        </SettingsProvider>
      </ThemeProvider>
    </Provider>
  );
}

const styles = StyleSheet.create({
  initErrorScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  initErrorTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  initErrorMessage: {
    color: '#4B5563',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
});
