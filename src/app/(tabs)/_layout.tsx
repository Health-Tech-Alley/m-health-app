/**
 * Tab navigation layout for the post-onboarding app shell.
 *
 * Five tabs: Dashboard, Care, Medications, Schedule, Settings. Screens
 * manage their own headers, so `headerShown` is false for every tab. The
 * active tab uses the brand teal (#0E6F68); the tab bar is white.
 */

import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

const TEAL = '#0E6F68';
const MUTED = '#526866';

const TABS: { name: string; title: string; icon: string }[] = [
  { name: 'dashboard', title: 'Dashboard', icon: '🏠' },
  { name: 'care', title: 'Care', icon: '❤️' },
  { name: 'medications', title: 'Meds', icon: '💊' },
  { name: 'schedule', title: 'Schedule', icon: '📅' },
  { name: 'settings', title: 'Settings', icon: '⚙️' },
];

function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return (
    <View style={styles.iconWrap}>
      <Text style={[styles.icon, focused && styles.iconFocused]}>{icon}</Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: TEAL,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarItemStyle: styles.tabBarItem,
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused }) => <TabIcon icon={tab.icon} focused={focused} />,
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E4E7EC',
    height: 64,
    paddingBottom: 6,
    paddingTop: 4,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  tabBarItem: {
    paddingVertical: 2,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 18,
    opacity: 0.55,
  },
  iconFocused: {
    opacity: 1,
  },
});
