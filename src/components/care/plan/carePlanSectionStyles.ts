/**
 * Shared visual rules for the Care tab section components (planning/41 §8.3).
 *
 * One card radius / padding / type scale. Section components import from here
 * instead of redefining the same look in each file.
 */

import { StyleSheet } from 'react-native';
import { AppTheme, Colors } from '@/constants/theme';

type CareSectionTheme = (typeof Colors)[keyof typeof Colors];

export const sectionStyles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 16,
    marginBottom: 14,
    ...AppTheme.shadow,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  subtitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  eyebrow: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  divider: {
    height: 1,
    backgroundColor: AppTheme.colors.border,
    marginVertical: 12,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metaItem: {
    flexGrow: 1,
    flexBasis: '40%',
  },
  metaLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  metaValue: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: AppTheme.colors.brandSoft,
  },
  pillText: {
    color: AppTheme.colors.brand,
    fontSize: 11,
    fontWeight: '900',
  },
  pillMuted: {
    backgroundColor: AppTheme.colors.chip,
  },
  pillMutedText: {
    color: AppTheme.colors.textSoft,
    fontSize: 11,
    fontWeight: '900',
  },
  bodyText: {
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  bodyMuted: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    gap: 10,
  },
  listBullet: {
    color: AppTheme.colors.brand,
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
  },
  listText: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
});

export function createThemedSectionStyles(theme: CareSectionTheme) {
  const isDark = theme.appBackground === '#000000';
  const brandText = isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand;

  return StyleSheet.create({
    card: {
      ...StyleSheet.flatten(sectionStyles.card),
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
      ...(isDark ? { elevation: 0, shadowOpacity: 0 } : null),
    },
    headerRow: sectionStyles.headerRow,
    title: { ...StyleSheet.flatten(sectionStyles.title), color: theme.appText },
    subtitle: { ...StyleSheet.flatten(sectionStyles.subtitle), color: theme.appTextMuted },
    pill: { ...StyleSheet.flatten(sectionStyles.pill), backgroundColor: theme.appBrandSoftSurface },
    pillText: { ...StyleSheet.flatten(sectionStyles.pillText), color: brandText },
    pillMuted: { ...StyleSheet.flatten(sectionStyles.pillMuted), backgroundColor: theme.appControlSurface },
    pillMutedText: { ...StyleSheet.flatten(sectionStyles.pillMutedText), color: theme.appTextSupporting },
    bodyMuted: { ...StyleSheet.flatten(sectionStyles.bodyMuted), color: theme.appTextSupporting },
    listRow: { ...StyleSheet.flatten(sectionStyles.listRow), borderTopColor: theme.appBorder },
    listBullet: { ...StyleSheet.flatten(sectionStyles.listBullet), color: brandText },
    listText: { ...StyleSheet.flatten(sectionStyles.listText), color: theme.appText },
  });
}
