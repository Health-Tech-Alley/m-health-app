/**
 * Reusable screen header with the Health Tech Alley logo to the left of the
 * screen title. Used by the active tab screens and settings.
 */

import { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const TEAL = '#0E6F68';
const DARK = '#123433';

export function ScreenHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.header, themedStyles.header]}>
      <View style={[styles.logoCircle, themedStyles.logoCircle]}>
        <Image
          source={require('@/assets/images/hta-logo.png')}
          style={styles.logoImage}
          resizeMode="contain"
        />
      </View>
      <View style={styles.textBlock}>
        <Text style={[styles.eyebrow, themedStyles.eyebrow]}>{eyebrow}</Text>
        <Text style={[styles.title, themedStyles.title]}>{title}</Text>
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';

  return StyleSheet.create({
    header: {
      backgroundColor: theme.appBackground,
    },
    logoCircle: {
      backgroundColor: isDark ? AppTheme.colors.brand : TEAL,
    },
    eyebrow: {
      color: isDark ? AppTheme.colors.brand : TEAL,
    },
    title: {
      color: theme.appHeaderText,
    },
  });
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  logoCircle: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: {
    width: 36,
    height: 36,
  },
  textBlock: {
    flex: 1,
  },
  eyebrow: {
    color: TEAL,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: DARK,
    marginTop: 2,
  },
});
