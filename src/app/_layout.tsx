/**
 * Root layout for the Expo Router app.
 *
 * Wraps the mobile app with SLMProvider so official screens can access
 * Ethan's SLM provider through the service layer.
 */

import { DefaultTheme, Stack, ThemeProvider } from "expo-router";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { OrchestratorProvider } from "@/contexts/orchestrator-context";
import { SLMProvider } from "@/contexts/slm-context";

export default function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <SLMProvider>
        <OrchestratorProvider>
          <AnimatedSplashOverlay />
          <Stack screenOptions={{ headerShown: false }} />
        </OrchestratorProvider>
      </SLMProvider>
    </ThemeProvider>
  );
}