/**
 * CareAskRegion — Care tab Concierge region: optional children (soft-NLU /
 * in-card ask) above the intent catalog.
 *
 * Doc 40 P1c ships soft-NLU via CarePlanAskChat.
 * Proactive suggestion-strip chips (doc 40 P0) are deferred — mount here as
 * children above the catalog when resumed. Read-only mode filters the intent
 * catalog to non-mutating intents.
 */

import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CareConciergeIntentsCard } from '@/components/careConcierge/CareConciergeIntentsCard';
import { AppTheme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { isMutatingIntent } from '@/services/carePlan/carePlanMode';
import { intentCatalogList } from '@/services/carePlan/intentRouter';
import type { AdcpProposalIntentId } from '@/data/adcp/types';
import { createThemedSectionStyles } from './carePlanSectionStyles';

export interface CareAskRegionProps {
  patientId: string | null;
  writable: boolean;
  onLaunchIntent: (intent: AdcpProposalIntentId) => void;
  /**
   * Reserved slot. Doc 40 mounts its suggestion strip + ask input here.
   * Children render above the concierge intents card so the suggestion
   * strip is the first thing the caregiver sees in this region.
   */
  children?: ReactNode;
}

export function CareAskRegion({
  patientId,
  writable,
  onLaunchIntent,
  children,
}: CareAskRegionProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const sectionStyles = useMemo(() => createThemedSectionStyles(theme), [theme]);
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const allIntents = useMemo(() => intentCatalogList(), []);

  // Read-only mode hides mutating intents so the catalog matches what can run.
  const visibleIntents = useMemo(
    () => (writable ? allIntents : allIntents.filter((i) => !isMutatingIntent(i.intent))),
    [allIntents, writable],
  );

  return (
    <View style={styles.region} accessible accessibilityLabel={t('care.ask.regionLabel')}>
      {!writable ? (
        <View
          style={[styles.banner, themedStyles.banner]}
          accessible
          accessibilityLabel={t('care.ask.readOnlyBanner')}
        >
          <Text style={[styles.bannerTitle, themedStyles.primaryText]}>
            {t('care.ask.viewOnlyTitle')}
          </Text>
          <Text style={[styles.bannerBody, themedStyles.supportingText]}>
            {t('care.ask.viewOnlyBody')}
          </Text>
        </View>
      ) : null}

      {children}

      {visibleIntents.length > 0 ? (
        <CareConciergeIntentsCard
          patientId={patientId}
          onLaunch={onLaunchIntent}
          intents={visibleIntents}
        />
      ) : (
        <View style={sectionStyles.card}>
          <Text style={sectionStyles.title}>{t('care.intents.title')}</Text>
          <Text style={sectionStyles.bodyMuted}>{t('care.ask.noIntents')}</Text>
        </View>
      )}
    </View>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';

  return StyleSheet.create({
    banner: {
      backgroundColor: isDark ? 'rgba(249,115,22,0.16)' : AppTheme.colors.warningSoft,
      borderColor: AppTheme.colors.warning,
    },
    primaryText: { color: theme.appText },
    supportingText: { color: theme.appTextSupporting },
  });
}

const styles = StyleSheet.create({
  region: {
    marginBottom: 14,
  },
  banner: {
    backgroundColor: AppTheme.colors.warningSoft,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.warning,
    padding: 14,
    marginBottom: 12,
  },
  bannerTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  bannerBody: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 4,
  },
});
