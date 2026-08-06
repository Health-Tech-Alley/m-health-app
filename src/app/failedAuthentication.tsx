import { dispatchImmediate } from "@/services/notifications/notificationService";
import { simplePrompt } from '@sbaiahmed1/react-native-biometrics';
import { router } from "expo-router";
import { Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';


const AppFailedAuthentication = () => {

    return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <Pressable
            style={[styles.button, styles.secondaryButton]}
            onPress={() => authenticateUsingBioMetrics()}>
            <Text style={styles.secondaryButtonText}>Retry Authentication</Text>
        </Pressable>
      </SafeAreaView>
    </SafeAreaProvider>
  );
};

function authenticateUsingBioMetrics() {
  try {
  simplePrompt('Authenticate')
    .then((result) => {
      if (result) {
        console.log("Biometric authentication successful.");
        dispatchImmediate({
          patientId: '1234',
          scope: 'anomaly',
          title: "User Authenticated",
          body: 'Authentication successful with biometrics',
          severity: 1,
        });
        router.push('/dashboard' as never);
      } else {
        console.warn("Biometric authentication failed or was canceled.");
        dispatchImmediate({
          patientId: '1234',
          scope: 'anomaly',
          title: "Authentication Failed",
          body: 'Biometric authentication failed or was canceled',
          severity: 1,
        });
      }
    })
    .catch((error) => {
      console.error("Biometric authentication error:", error);
      dispatchImmediate({
        patientId: '1234',
        scope: 'anomaly',
        title: "Authentication Error",
        body: 'Error during biometric authentication',
        severity: 1,
      });
    });
  } catch (error) {
    console.error("Error during biometric authentication:", error);
    dispatchImmediate({
      patientId: '1234',
      scope: 'anomaly',
      title: "Authentication Error",
      body: 'Error during biometric authentication',
      severity: 1,
    });
  }
}

const styles = StyleSheet.create({
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