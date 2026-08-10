/**
 * Shared citation / sources list for Home, Care, and Concierge.
 * Pack-aware: shows source labels + optional chunk counts + expandable detail.
 */

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import type { TranslateFn } from '@/localization/i18n';

export type CitationSource = {
  label: string;
  /** Optional count of chunks from this source */
  count?: number;
  /** Optional short detail (e.g. "Drug label · Baclofen") */
  detail?: string;
};

export type CitationListProps = {
  sources: CitationSource[];
  /** Show "Sources (n)" toggle header */
  collapsible?: boolean;
  defaultExpanded?: boolean;
  /** Max items before "Show more" */
  maxItems?: number;
  /** Compact mode for small cards */
  compact?: boolean;
};

export function CitationList({
  sources,
  collapsible = true,
  defaultExpanded = false,
  maxItems = 8,
  compact = false,
}: CitationListProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createStyles(theme), [theme]);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showAll, setShowAll] = useState(false);

  if (sources.length === 0) return null;

  const visible = showAll ? sources : sources.slice(0, maxItems);
  const hiddenCount = sources.length - visible.length;
  const hasCounts = sources.some((s) => s.count !== undefined);

  const content = (
    <>
      {visible.map((s, i) => (
        <View key={`${s.label}-${i}`} style={styles.row}>
          <Text style={[compact ? styles.bulletCompact : styles.bullet, themedStyles.bullet]}>•</Text>
          <View style={styles.rowContent}>
            <Text style={[compact ? styles.labelCompact : styles.label, themedStyles.label]}>
              {s.label}
              {hasCounts && s.count !== undefined ? ` (${s.count})` : ''}
            </Text>
            {s.detail ? (
              <Text style={[compact ? styles.detailCompact : styles.detail, themedStyles.detail]}>{s.detail}</Text>
            ) : null}
          </View>
        </View>
      ))}
      {hiddenCount > 0 ? (
        <Pressable onPress={() => setShowAll(true)} accessibilityRole="button">
          <Text style={[styles.showMore, themedStyles.showMore]}>
            {t('common.showMore', { count: hiddenCount })}
          </Text>
        </Pressable>
      ) : null}
    </>
  );

  if (!collapsible) {
    return <View style={[styles.block, themedStyles.block]}>{content}</View>;
  }

  return (
    <View style={[styles.block, themedStyles.block]}>
      <Pressable
        style={styles.toggle}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t('common.sourcesA11y', { count: sources.length })}
      >
        <Text style={[compact ? styles.toggleTextCompact : styles.toggleText, compact ? themedStyles.toggleTextCompact : themedStyles.toggleText]}>
          {t('common.sourcesCount', { count: sources.length })}
        </Text>
        <Text style={[styles.chevron, themedStyles.chevron]}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>
      {expanded ? content : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';

  return StyleSheet.create({
    block: {
      borderTopColor: theme.appBorder,
      ...(isDark
        ? {
            backgroundColor: theme.appSurface,
            borderRadius: 12,
            paddingHorizontal: 8,
            paddingBottom: 8,
          }
        : null),
    },
    toggleText: {
      color: theme.appText,
    },
    toggleTextCompact: {
      color: theme.appTextSupporting,
    },
    chevron: {
      color: theme.appTextSupporting,
    },
    bullet: {
      color: theme.appTextSupporting,
    },
    label: {
      color: theme.appText,
    },
    detail: {
      color: theme.appTextSupporting,
    },
    showMore: {
      color: isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand,
    },
  });
}

const styles = StyleSheet.create({
  block: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: AppTheme.colors.border,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  toggleText: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  toggleTextCompact: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  chevron: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 6,
  },
  bullet: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
  },
  bulletCompact: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
  },
  rowContent: {
    flex: 1,
  },
  label: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  labelCompact: {
    color: AppTheme.colors.text,
    fontSize: 12,
    fontWeight: '500',
  },
  detail: {
    color: AppTheme.colors.textSoft,
    fontSize: 11,
    marginTop: 1,
  },
  detailCompact: {
    color: AppTheme.colors.textSoft,
    fontSize: 10,
    marginTop: 1,
  },
  showMore: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
});

/**
 * Convert RetrievedCitation[] to CitationSource[] with counts per source.
 */
export function citationsToSources(
  citations: { source: string; text?: string }[],
  t?: TranslateFn,
): CitationSource[] {
  const bySource = new Map<string, number>();
  for (const c of citations) {
    bySource.set(c.source, (bySource.get(c.source) ?? 0) + 1);
  }

  const SOURCE_LABELS: Record<string, string> = {
    pubmed: t?.('common.source.medicalLiterature') ?? 'Medical literature',
    medlineplus: t?.('common.source.healthTopicSummary') ?? 'Health topic summary',
    rxnorm: t?.('common.source.drugInformation') ?? 'Drug information',
    dailymed: t?.('common.source.drugLabel') ?? 'Drug label',
    openfda: t?.('common.source.drugSafetyData') ?? 'Drug safety data',
    orphanet: t?.('common.source.rareDiseaseGuidance') ?? 'Rare disease guidance',
    'cdc-places': t?.('common.source.communityHealthData') ?? 'Community health data',
    cdc_places: t?.('common.source.communityHealthData') ?? 'Community health data',
    synthetic: t?.('common.source.developmentFixture') ?? 'Development fixture',
    'local-fixture': t?.('common.source.sampleGuidance') ?? 'Sample guidance',
    'patient-plan': t?.('common.source.carePlan') ?? 'Care plan',
    'care-plan': t?.('common.source.carePlan') ?? 'Care plan',
    adcp_plan: t?.('common.source.carePlan') ?? 'Care plan',
    care_plan_section: t?.('common.source.carePlan') ?? 'Care plan',
    'patient-record': t?.('common.source.patientRecord') ?? 'Patient record',
    'pack:spine': t?.('common.source.careGapsEmergencyCards') ?? 'Care gaps & emergency cards',
    'pack:cpg': t?.('common.source.clinicalGuidelines') ?? 'Clinical guidelines',
    'pack:medlineplus': t?.('common.source.healthTopics') ?? 'Health topics',
    'pack:orphanet': t?.('common.source.rareDisease') ?? 'Rare disease',
    'pack:public_health': t?.('common.source.publicHealth') ?? 'Public health',
    'pack:meds_base': t?.('common.source.drugLabels') ?? 'Drug labels',
    'pack:ddi': t?.('common.source.drugInteractions') ?? 'Drug interactions',
    'pack:dme': t?.('common.source.deviceCare') ?? 'Device care',
    'pack:lit_lite': t?.('common.source.medicalLiterature') ?? 'Medical literature',
    'pack:openfda': t?.('common.source.drugSafety') ?? 'Drug safety',
    'pack:sdoh': t?.('common.source.communityHealthData') ?? 'Community health',
  };

  return [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({
      label: SOURCE_LABELS[source] ?? source,
      count,
    }));
}
