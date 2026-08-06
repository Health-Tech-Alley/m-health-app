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

import { DefaultTheme, router, Stack, ThemeProvider, useRouter } from "expo-router";
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

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

import { dispatchImmediate } from "@/services/notifications/notificationService";
import { simplePrompt } from '@sbaiahmed1/react-native-biometrics';
import { NativeModules } from "react-native";
import { installConsoleCapture } from "./logging/consoleCapture";
import { isSensorAvailable } from '@sbaiahmed1/react-native-biometrics';

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

async function authenticateUsingBioMetrics(): Promise<boolean> {
  try {
    const { available, biometryType } = await isSensorAvailable();

    console.log(
      `Biometric sensor available: ${available}, type: ${biometryType}`
    );

    if (!available) {
      console.warn("Biometric sensor is not available on this device.");
      return false;
    }

    const result = await simplePrompt("Authenticate");

    if (result) {
      console.log("Biometric authentication successful.");

      await dispatchImmediate({
        patientId: "1234",
        scope: "anomaly",
        title: "User Authenticated",
        body: "Authentication successful with biometrics",
        severity: 1,
      });

      return true;
    }

    console.warn("Biometric authentication failed or was canceled.");

    await dispatchImmediate({
      patientId: "1234",
      scope: "anomaly",
      title: "Authentication Failed",
      body: "Biometric authentication failed or was canceled",
      severity: 1,
    });

    router.replace("/failedAuthentication" as never);
    return false;
  } catch (error) {
    console.error("Biometric authentication error:", error);

    await dispatchImmediate({
      patientId: "1234",
      scope: "anomaly",
      title: "Authentication Error",
      body: "Error during biometric authentication",
      severity: 1,
    });

    router.replace("/failedAuthentication" as never);
    return false;
  }
}

export default function RootLayout() {

  const appState = useRef(AppState.currentState);

  // for authentication on app launch
  const authenticating = useRef(false);
  const hasAuthenticatedThisLaunch = useRef(false);

  const authenticate = async () => {

    if (authenticating.current) return;
    
    authenticating.current = true;
    try {
      await authenticateUsingBioMetrics();
      hasAuthenticatedThisLaunch.current = true;
      return true;
    } finally {
      authenticating.current = false;
    }
  };

  useEffect(() => {
    (async () => {
      await authenticate();
    })();
  }, []);

  useEffect(() => {
      installConsoleCapture();
  }, []);

  useEffect(() => {
  const subscription = AppState.addEventListener("change", async (nextState) => {
    const previous = appState.current;
    appState.current = nextState;
    console.log(previous, "->", nextState);
    if (
      (previous === "background") && nextState === "active"
    ) {
      await authenticateUsingBioMetrics();
    }
  });

  return () => subscription.remove();
}, []);

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
