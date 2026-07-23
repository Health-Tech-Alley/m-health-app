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

import { DefaultTheme, Stack, ThemeProvider, useRouter } from "expo-router";
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { CriticalAlertDialog } from "@/components/critical-alert-dialog";
import { HypotheticalCriticalBanner } from "@/components/notifications/hypothetical-critical-banner";
import { InAppBanner } from "@/components/notifications/in-app-banner";
import { CriticalAlertProvider } from "@/contexts/critical-alert-context";
import { OrchestratorProvider } from "@/contexts/orchestrator-context";
import { PatientRecordProvider } from "@/contexts/patient-record-context";
import { SensorProvider } from "@/contexts/sensor-context";
import { SettingsProvider, useSettings } from "@/contexts/settings-context";
import { SLMProvider, useSLM } from "@/contexts/slm-context";
import { UC2RuntimeProvider } from "@/contexts/uc2-runtime-context";
import { initializeDatabase } from '@/data';
import { store } from '@/store';
import { Provider } from 'react-redux';

import * as Notifications from 'expo-notifications';
import { AndroidNotificationPriority } from 'expo-notifications';

import { Directory, Paths } from "expo-file-system";
import { NativeModules } from "react-native";

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

/**
 * react-native-file-logger needs a native module (dev/EAS build).
 * Never static-import the package here: its entry requires NativeFileLogger
 * under TurboModules and TurboModuleRegistry.getEnforcing throws when absent.
 * Probe NativeModules only, then dynamic-import if present.
 */
function isFileLoggerNativeAvailable(): boolean {
  const bridge = NativeModules.FileLogger as { configure?: unknown } | null | undefined;
  return Boolean(bridge && typeof bridge.configure === "function");
}

function LoggerInit() {
  useEffect(() => {
    if (!isFileLoggerNativeAvailable()) {
      console.log(
        "[FileLogger] Native module unavailable — skipping file log setup",
      );
      return;
    }
    void (async () => {
      try {
        const { FileLogger } = await import("react-native-file-logger");
        const logsDir = new Directory(Paths.document, "logs");
        if (!logsDir.exists) {
          logsDir.create();
        }
        await FileLogger.configure({
          logsDirectory: logsDir.uri,
          captureConsole: false,
        });
        console.log("FileLogger configured, dir:", logsDir.uri);
        FileLogger.info("Logger test entry");
      } catch (err) {
        console.warn("[FileLogger] configure skipped:", err);
      }
    })();
  }, []);
  return null;
}

function SlmPolicySync() {
  const { mode, settings } = useSettings();
  const { setPolicy } = useSLM();
  useEffect(() => {
    if (settings.dynamicSlmLoading !== false) {
      setPolicy('auto');
    } else {
      setPolicy(mode === 'demo' ? 'auto' : 'manual');
    }
  }, [mode, settings.dynamicSlmLoading, setPolicy]);
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
              <LoggerInit />
              <NotificationInit />
              <NotificationResponseInit />
              <SensorProvider>
                <UC2RuntimeProvider>
                  <OrchestratorProvider>
                    <CriticalAlertProvider>
                      <AnimatedSplashOverlay />
                      <InAppBanner />
                      <HypotheticalCriticalBanner />
                      <CriticalAlertDialog />
                      <Stack screenOptions={{ headerShown: false }} />
                    </CriticalAlertProvider>
                  </OrchestratorProvider>
                </UC2RuntimeProvider>
              </SensorProvider>
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
