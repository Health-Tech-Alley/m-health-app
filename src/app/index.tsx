/**
 * First route — onboarding gate.
 *
 * If onboarding has not been completed, show the onboarding screen.
 * Otherwise redirect to the tab-based dashboard layout.
 */

import { Redirect } from "expo-router";

import { hasCompletedOnboarding } from "@/services/onboarding/onboardingService";

export default function HomeScreen() {
  if (hasCompletedOnboarding()) {
    return <Redirect href="/(tabs)/dashboard" />;
  }
  return <Redirect href="/onboarding" />;
}
