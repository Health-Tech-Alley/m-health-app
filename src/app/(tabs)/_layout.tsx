/**
 * Tab layout — the 5-tab shell (Home, Care, Medications, Schedule, Concierge).
 * Settings/More is a stack screen opened from Home (not a bottom tab).
 *
 * Uses Expo Router's `Tabs` component so tab switches don't stack screens.
 * The tab bar is styled to match the existing branded design: teal active
 * icon, muted inactive icon, white bar with a top border. The active icon
 * shape animates (scale + background) on focus change for a polished feel.
 *
 * Per planning/32 §4.4, the SLM status icon lives in the header (right side)
 * for every tab. The Concierge tab also uses a full status row to surface
 * model state at a glance.
 */

import { Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { Animated, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/localization/i18n";

const TAB_CONFIG: {
  name: string;
  labelKey: TranslationKey;
  icon: AppIconName;
}[] = [
  { name: "dashboard", labelKey: "tabs.home", icon: "home" },
  { name: "care", labelKey: "tabs.care", icon: "care" },
  { name: "medications", labelKey: "tabs.meds", icon: "pill" },
  { name: "schedule", labelKey: "tabs.schedule", icon: "schedule" },
  { name: "assistant", labelKey: "tabs.concierge", icon: "assistant" },
];

export default function TabsLayout() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { fontScale } = useWindowDimensions();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: AppTheme.colors.brand,
        tabBarInactiveTintColor: theme.appSectionText,
        tabBarStyle: [
          styles.tabBar,
          {
            height: tabBarHeightFor(fontScale),
            backgroundColor: theme.appTabBarBackground,
            borderTopColor: theme.appBorder,
          },
        ],
        tabBarItemStyle: styles.tabItem,
      }}
    >
      {TAB_CONFIG.map((tab) => {
        const label = t(tab.labelKey);

        return (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: label,
              tabBarLabel: ({ color }) => (
                <Text style={[styles.tabLabel, { color }]} numberOfLines={2}>
                  {label}
                </Text>
              ),
              tabBarIcon: ({ focused }) => <AnimatedTabIcon name={tab.icon} focused={focused} inactiveColor={theme.appSectionText} />,
            }}
          />
        );
      })}
    </Tabs>
  );
}

/**
 * Animated tab icon — scales up and fills the rounded background when focused,
 * scales back down and clears the background when blurred. Uses a spring for
 * a natural, tactile transition between tabs.
 */
function AnimatedTabIcon({
  name,
  focused,
  inactiveColor,
}: {
  name: AppIconName;
  focused: boolean;
  inactiveColor: string;
}) {
  const [scale] = useState(() => new Animated.Value(focused ? 1.1 : 1));
  const [bgOpacity] = useState(() => new Animated.Value(focused ? 1 : 0));

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: focused ? 1.1 : 1,
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
          size={28}
          color={focused ? AppTheme.colors.white : inactiveColor}
        />
      </Animated.View>
    </View>
  );
}

/**
 * Tab bar height grows with the accessibility font scale so two-line labels
 * (e.g. "Concierge") never clip or collide.
 */
function tabBarHeightFor(fontScale: number): number {
  if (fontScale >= 1.8) return 148;
  if (fontScale >= 1.3) return 132;
  return 114;
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: AppTheme.colors.white,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    paddingHorizontal: 6,
    paddingTop: 12,
    paddingBottom: 18,
  },
  tabItem: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 1,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 14,
    marginTop: 6,
    paddingHorizontal: 1,
    textAlign: "center",
    width: "100%",
  },
  iconCircle: {
    width: 60,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
    overflow: "hidden",
  },
  iconCircleFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    backgroundColor: AppTheme.colors.brand,
  },
});
