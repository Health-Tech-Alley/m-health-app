import type { ReactNode } from "react";
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";

type MainTabHeaderProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  icon?: AppIconName;
  logoSource?: ImageSourcePropType;
  rightContent?: ReactNode;
};

export function MainTabHeader({
  title,
  subtitle,
  eyebrow,
  icon,
  logoSource,
  rightContent,
}: MainTabHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.topRow}>
        {logoSource ? (
          <View style={styles.logoCircle}>
            <Image source={logoSource} style={styles.logoImage} resizeMode="contain" />
          </View>
        ) : icon ? (
          <View style={styles.iconCircle}>
            <AppIcon name={icon} size={26} color={AppTheme.colors.white} />
          </View>
        ) : null}

        <View style={styles.textBlock}>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
        </View>

        {rightContent ? <View style={styles.rightSlot}>{rightContent}</View> : null}
      </View>

      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: AppTheme.colors.screen,
    marginBottom: 24,
  },
  topRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  logoCircle: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: AppTheme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImage: {
    width: 40,
    height: 40,
  },
  iconCircle: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: AppTheme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
  },
  subtitle: {
    marginTop: 18,
    color: AppTheme.colors.textSoft,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: "400",
  },
  rightSlot: {
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "center",
  },
});
