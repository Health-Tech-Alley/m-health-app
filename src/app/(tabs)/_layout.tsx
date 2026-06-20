/**
 * Tab layout — the 6-tab shell (Dashboard, Care, Medications, Schedule,
 * Concierge, More).
 *
 * Uses Expo Router's `Tabs` component so tab switches don't stack screens.
 * The tab bar is styled to match the existing branded design: teal active
 * icon, muted inactive icon, white bar with a top border. The active icon
 * circle animates (scale + background) on focus change for a polished feel.
 */

import { useEffect, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { Tabs } from "expo-router";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";

const TAB_CONFIG: {
  name: string;
  label: string;
  icon: AppIconName;
}[] = [
  { name: "dashboard", label: "Home", icon: "home" },
  { name: "care", label: "Care", icon: "care" },
  { name: "medications", label: "Meds", icon: "pill" },
  { name: "schedule", label: "Schedule", icon: "schedule" },
  { name: "assistant", label: "Concierge", icon: "assistant" },
  { name: "more", label: "More", icon: "more" },
];

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: AppTheme.colors.brand,
        tabBarInactiveTintColor: AppTheme.colors.navMuted,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabItem,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      {TAB_CONFIG.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.label,
            tabBarIcon: ({ focused }) => (
              <AnimatedTabIcon name={tab.icon} focused={focused} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

/**
 * Animated tab icon — scales up and fills the circle background when focused,
 * scales back down and clears the background when blurred. Uses a spring for
 * a natural, tactile transition between tabs.
 */
function AnimatedTabIcon({
  name,
  focused,
}: {
  name: AppIconName;
  focused: boolean;
}) {
  const [scale] = useState(() => new Animated.Value(focused ? 1.15 : 1));
  const [bgOpacity] = useState(() => new Animated.Value(focused ? 1 : 0));

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: focused ? 1.15 : 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(bgOpacity, {
        toValue: focused ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [focused, scale, bgOpacity]);

  return (
    <View style={styles.iconCircle}>
      <Animated.View
        style={[
          styles.iconCircleFill,
          { opacity: bgOpacity },
        ]}
      />
      <Animated.View style={{ transform: [{ scale }] }}>
        <AppIcon
          name={name}
          size={22}
          color={focused ? AppTheme.colors.white : AppTheme.colors.navMuted}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: AppTheme.colors.white,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    height: 88,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 12,
  },
  tabItem: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "900",
    marginTop: 2,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  iconCircleFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 20,
    backgroundColor: AppTheme.colors.brand,
  },
});
