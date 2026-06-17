/**
 * Settings route — redirects to the settings tab.
 */

import { Redirect } from 'expo-router';

export default function SettingsRoute() {
  return <Redirect href="/(tabs)/settings" />;
}
