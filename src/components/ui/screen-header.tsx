/**
 * Reusable screen header with the Health Tech Alley logo to the left of the
 * screen title. Used by the active tab screens and settings.
 */

import { Image, StyleSheet, Text, View } from 'react-native';

const TEAL = '#0E6F68';
const DARK = '#123433';

export function ScreenHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View style={styles.header}>
      <View style={styles.logoCircle}>
        <Image
          source={require('@/assets/images/hta-logo.png')}
          style={styles.logoImage}
          resizeMode="contain"
        />
      </View>
      <View style={styles.textBlock}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
    </View>
  );
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
