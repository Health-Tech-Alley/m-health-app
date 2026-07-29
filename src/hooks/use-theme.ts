/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useSettings } from '@/contexts/settings-context';

export function useTheme() {
  const { effectiveColorScheme } = useSettings();
  return Colors[effectiveColorScheme];
}
