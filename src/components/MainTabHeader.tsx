import { useMemo, type ReactNode } from "react";
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { SlmStatusIcon } from "@/components/concierge/SlmStatusIcon";
import { AppTheme } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const accessDpDarkLogo = require("@/assets/images/access-dp-foreground-dark.png");

type MainTabHeaderProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  icon?: AppIconName;
  logoSource?: ImageSourcePropType;
  brandText?: string;
  brandSubtitle?: string;
  rightContent?: ReactNode;
};

export function MainTabHeader({
  title,
  subtitle,
  eyebrow,
  icon,
  logoSource,
  brandText,
  brandSubtitle,
  rightContent,
}: MainTabHeaderProps) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createStyles(theme), [theme]);
  const showBrandText = Boolean(brandText && logoSource);
  const resolvedLogoSource =
    showBrandText && brandText === "ACCESS-DP" && theme.appBackground === "#000000"
      ? accessDpDarkLogo
      : logoSource;

  return (
    <View style={[styles.header, themedStyles.header]}>
      <View style={styles.topRow}>
        {logoSource ? (
          <View
            style={[
              styles.logoCircle,
              themedStyles.logoCircle,
              showBrandText && styles.brandLogoCircle,
              showBrandText && themedStyles.brandLogoCircle,
            ]}
            accessible={false}
          >
            <Image
              source={resolvedLogoSource}
              style={[
                styles.logoImage,
                showBrandText && styles.brandLogoImage,
              ]}
              resizeMode="contain"
              accessible={false}
              accessibilityIgnoresInvertColors
            />
          </View>
        ) : icon ? (
          <View style={[styles.iconCircle, themedStyles.iconCircle]}>
            <AppIcon name={icon} size={26} color={AppTheme.colors.white} />
          </View>
        ) : null}

        <View style={styles.textBlock}>
          {showBrandText ? (
            <View style={styles.brandTextBlock}>
              <Text
                style={styles.brandText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                accessibilityLabel={brandText}
              >
                {brandText === "ACCESS-DP" ? (
                  <>
                    <Text style={[styles.brandTextPrimary, themedStyles.brandTextPrimary]}>ACCESS</Text>
                    <Text style={styles.brandTextAccent}>-DP</Text>
                  </>
                ) : (
                  <Text style={themedStyles.brandTextPrimary}>{brandText}</Text>
                )}
              </Text>
              {brandSubtitle ? (
                <Text
                  style={[styles.brandSubtitle, themedStyles.brandSubtitle]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                >
                  {brandSubtitle}
                </Text>
              ) : null}
            </View>
          ) : (
            <>
              {eyebrow ? <Text style={[styles.eyebrow, themedStyles.eyebrow]}>{eyebrow}</Text> : null}
              <Text style={[styles.title, themedStyles.title]} numberOfLines={2}>
                {title}
              </Text>
            </>
          )}
        </View>

        {rightContent ? (
          <View style={styles.rightSlot}>
            <View style={styles.rightRow}>
              {rightContent}
              <SlmStatusIcon compact />
            </View>
          </View>
        ) : (
          <View style={styles.rightSlot}>
            <SlmStatusIcon compact />
          </View>
        )}
      </View>

      {subtitle ? <Text style={[styles.subtitle, themedStyles.subtitle]}>{subtitle}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === "#000000";

  return StyleSheet.create({
    header: {
      backgroundColor: theme.appBackground,
    },
    logoCircle: {
      backgroundColor: AppTheme.colors.brand,
    },
    brandLogoCircle: {
      backgroundColor: "transparent",
      borderColor: "transparent",
      borderWidth: 0,
    },
    iconCircle: {
      backgroundColor: AppTheme.colors.brand,
    },
    eyebrow: {
      color: AppTheme.colors.brand,
    },
    title: {
      color: theme.appText,
    },
    brandTextPrimary: {
      color: isDark ? theme.appText : "#002868",
    },
    brandSubtitle: {
      color: isDark ? theme.appTextSupporting : "#52638F",
    },
    subtitle: {
      color: theme.appTextSupporting,
    },
  });
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
  brandLogoCircle: {
    width: 54,
    height: 54,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  logoImage: {
    width: 40,
    height: 40,
  },
  brandLogoImage: {
    width: 56,
    height: 56,
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
  brandTextBlock: {
    minWidth: 0,
    justifyContent: "center",
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
  brandText: {
    fontSize: 18,
    lineHeight: 21,
    fontWeight: "900",
  },
  brandTextPrimary: {
    color: "#002868",
  },
  brandTextAccent: {
    color: "#0090A0",
  },
  brandSubtitle: {
    color: "#52638F",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
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
  rightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});
