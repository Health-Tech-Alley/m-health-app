import { dispatchImmediate } from "@/services/notifications/notificationService";
import { useTranslation } from "@/hooks/use-translation";
import { useTheme } from "@/hooks/use-theme";
import type { TranslateFn } from "@/localization/i18n";
import { simplePrompt } from '@sbaiahmed1/react-native-biometrics';
import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';


const AppFailedAuthentication = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const themedStyles = useMemo(
    () => StyleSheet.create({
      container: { backgroundColor: theme.appBackground },
      errorHeader: { color: theme.appText },
      errorMessage: { color: theme.appTextSupporting },
      secondaryButton: {
        backgroundColor: theme.appSurface,
        borderColor: '#0E6F68',
      },
    }),
    [theme],
  );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.container, themedStyles.container]}>
        <Text
          style={[styles.errorHeader, themedStyles.errorHeader]}
          accessibilityRole="header">
          {t("auth.failed.title")}
        </Text>
        <Text style={[styles.errorMessage, themedStyles.errorMessage]}>
          {t("auth.failed.message")}
        </Text>
        <Pressable
          style={[styles.button, styles.secondaryButton, themedStyles.secondaryButton]}
          onPress={() => authenticateUsingBioMetrics(t)}
          accessibilityRole="button"
          accessibilityLabel={t("auth.failed.retryA11y")}
          accessibilityHint={t("auth.failed.retryHint")}>
          <Text style={styles.secondaryButtonText}>{t("auth.failed.retry")}</Text>
        </Pressable>
      </SafeAreaView>
    </SafeAreaProvider>
  );
};

function authenticateUsingBioMetrics(t: TranslateFn) {
  try {
  simplePrompt(t("auth.biometric.prompt"))
    .then((result) => {
      if (result) {
        console.log("Biometric authentication successful.");
        dispatchImmediate({
          patientId: '1234',
          scope: 'anomaly',
          title: t("auth.notification.success.title"),
          body: t("auth.notification.success.body"),
          severity: 1,
        });
        router.push('/dashboard' as never);
      } else {
        console.warn("Biometric authentication failed or was canceled.");
        dispatchImmediate({
          patientId: '1234',
          scope: 'anomaly',
          title: t("auth.notification.failed.title"),
          body: t("auth.notification.failed.body"),
          severity: 1,
        });
      }
    })
    .catch((error) => {
      console.error("Biometric authentication error:", error);
      dispatchImmediate({
        patientId: '1234',
        scope: 'anomaly',
        title: t("auth.notification.error.title"),
        body: t("auth.notification.error.body"),
        severity: 1,
      });
    });
  } catch (error) {
    console.error("Error during biometric authentication:", error);
    dispatchImmediate({
      patientId: '1234',
      scope: 'anomaly',
      title: t("auth.notification.error.title"),
      body: t("auth.notification.error.body"),
      severity: 1,
    });
  }
}

const styles = StyleSheet.create({
    errorHeader: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
    errorMessage: { fontSize: 16, textAlign: 'center', marginBottom: 20 },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  button: {
    backgroundColor: '#0E6F68',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    margin: 10,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#0E6F68',
    marginTop: 10,
  },
  secondaryButtonText: {
    color: '#0E6F68',
    fontWeight: '700',
    fontSize: 15,
    padding: 10,
  },
});

export default AppFailedAuthentication;
