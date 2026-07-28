/**
 * Shared citation / sources list for Home, Care, and Concierge.
 * Pack-aware: shows source labels + optional chunk counts + expandable detail.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';

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
          <Text style={compact ? styles.bulletCompact : styles.bullet}>•</Text>
          <View style={styles.rowContent}>
            <Text style={compact ? styles.labelCompact : styles.label}>
              {s.label}
              {hasCounts && s.count !== undefined ? ` (${s.count})` : ''}
            </Text>
            {s.detail ? (
              <Text style={compact ? styles.detailCompact : styles.detail}>{s.detail}</Text>
            ) : null}
          </View>
        </View>
      ))}
      {hiddenCount > 0 ? (
        <Pressable onPress={() => setShowAll(true)} accessibilityRole="button">
          <Text style={styles.showMore}>Show {hiddenCount} more…</Text>
        </Pressable>
      ) : null}
    </>
  );

  if (!collapsible) {
    return <View style={styles.block}>{content}</View>;
  }

  return (
    <View style={styles.block}>
      <Pressable
        style={styles.toggle}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Sources, ${sources.length}`}
      >
        <Text style={compact ? styles.toggleTextCompact : styles.toggleText}>
          Sources ({sources.length})
        </Text>
        <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>
      {expanded ? content : null}
    </View>
  );
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
): CitationSource[] {
  const bySource = new Map<string, number>();
  for (const c of citations) {
    bySource.set(c.source, (bySource.get(c.source) ?? 0) + 1);
  }

  const SOURCE_LABELS: Record<string, string> = {
    pubmed: 'Medical literature',
    medlineplus: 'Health topic summary',
    rxnorm: 'Drug information',
    dailymed: 'Drug label',
    openfda: 'Drug safety data',
    orphanet: 'Rare disease guidance',
    'cdc-places': 'Community health data',
    cdc_places: 'Community health data',
    synthetic: 'Development fixture',
    'local-fixture': 'Sample guidance',
    'patient-plan': 'Care plan',
    'care-plan': 'Care plan',
    adcp_plan: 'Care plan',
    care_plan_section: 'Care plan',
    'patient-record': 'Patient record',
    'pack:spine': 'Care gaps & emergency cards',
    'pack:cpg': 'Clinical guidelines',
    'pack:medlineplus': 'Health topics',
    'pack:orphanet': 'Rare disease',
    'pack:public_health': 'Public health',
    'pack:meds_base': 'Drug labels',
    'pack:ddi': 'Drug interactions',
    'pack:dme': 'Device care',
    'pack:lit_lite': 'Medical literature',
    'pack:openfda': 'Drug safety',
    'pack:sdoh': 'Community health',
  };

  return [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({
      label: SOURCE_LABELS[source] ?? source,
      count,
    }));
}
