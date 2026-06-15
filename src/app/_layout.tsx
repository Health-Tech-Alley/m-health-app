/**
 * Root layout for the Expo Router app.
 *
 * Wraps the mobile app with SLMProvider so official screens can access
 * Ethan's SLM provider through the service layer.
 */

import { DefaultTheme, Stack, ThemeProvider } from "expo-router";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { SLMProvider } from "@/contexts/slm-context";

export default function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <SLMProvider>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }} />
      </SLMProvider>
    </ThemeProvider>
  );
}