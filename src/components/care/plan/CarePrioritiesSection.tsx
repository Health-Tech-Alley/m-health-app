/**
 * Care tab "Your priorities" section (Care tab rework).
 *
 * The ADCP's visible function: a consolidated, categorized priority list
 * (live UC4 cards + durable plan priorities), a short/medium/long-term care
 * timeline, and medication "areas to watch" — grouped and collapsed by
 * default so the caregiver is not overwhelmed. Tapping a priority row
 * expands the full interactive card (logging chips + HITL actions) plus a
 * plain-language "Why you're seeing this" block from the deterministic
 * rule registry.
 */

import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Uc4PriorityCard } from '@/components/care/Uc4PriorityCard';
import { AppTheme } from '@/constants/theme';
import type { LatestUc4PriorityCardSummary } from '@/data/types';
import { UC4_RULE_REGISTRY } from '@/ml-models/uc4-micro-priorities/uc4RuleRegistry';
import type { Uc4CardResponseAction } from '@/services/uc4/uc4EvaluationService';
import type {
  CarePriorityGroup,
  CarePriorityRow,
  CarePrioritiesView,
  CareTimelineBucketKey,
  MedicationWatchArea,
} from '@/services/carePlan/carePrioritiesService';
import {
  CARE_TIMELINE_BUCKET_LABELS,
  CARE_TIMELINE_BUCKET_ORDER,
  humanizeMedicationWatchCode,
} from '@/services/carePlan/carePrioritiesService';
import { sectionStyles } from './carePlanSectionStyles';

export interface CarePrioritiesSectionProps {
  view: CarePrioritiesView;
  onExplainCard?: (card: LatestUc4PriorityCardSummary) => void;
  onExplainTimeline?: () => void;
  onExplainWatchArea?: (area: MedicationWatchArea) => void;
  /** HITL: promote a watch area into the care plan (proposal → review). */
  onAddWatchAreaToPlan?: (area: MedicationWatchArea) => void;
  onRespond?: (
    card: LatestUc4PriorityCardSummary,
    action: Uc4CardResponseAction,
    payload: {
      observationCodes: string[];
      contextCodes: string[];
      caregiverRequestedProviderReview: boolean;
    },
  ) => void;
}

const RULE_DESCRIPTIONS: ReadonlyMap<string, string> = new Map(
  UC4_RULE_REGISTRY.map((rule) => [rule.ruleCode, rule.description]),
);

function toggle(set: Record<string, boolean>, key: string): Record<string, boolean> {
  return { ...set, [key]: !set[key] };
}

export function CarePrioritiesSection({
  view,
  onExplainCard,
  onExplainTimeline,
  onExplainWatchArea,
  onAddWatchAreaToPlan,
  onRespond,
}: CarePrioritiesSectionProps) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [openBucket, setOpenBucket] = useState<CareTimelineBucketKey | null>(null);
  const [watchAreasExpanded, setWatchAreasExpanded] = useState(false);

  const timelineCounts = useMemo(
    () => new Map(view.timeline.map((bucket) => [bucket.key, bucket.items.length])),
    [view.timeline],
  );
  const hasTimeline = view.timeline.some((bucket) => bucket.items.length > 0);
  const openBucketItems = openBucket
    ? view.timeline.find((bucket) => bucket.key === openBucket)?.items ?? []
    : [];
  const watchAreaListKey = useMemo(
    () =>
      view.watchAreas
        .map((area) => `${area.medicationId}:${area.medicationName}:${area.watchAreas.join(',')}`)
        .join('|'),
    [view.watchAreas],
  );
  const watchAreaMedicationCount = view.watchAreas.length;
  const watchAreaCountLabel = `${watchAreaMedicationCount} ${
    watchAreaMedicationCount === 1 ? 'medication' : 'medications'
  }`;

  useEffect(() => {
    setWatchAreasExpanded(false);
  }, [watchAreaListKey]);

  return (
    <View style={sectionStyles.card} accessible accessibilityLabel="Your priorities">
      <View style={sectionStyles.headerRow}>
        <Text style={sectionStyles.title}>Your priorities</Text>
        <View style={sectionStyles.pill}>
          <Text style={sectionStyles.pillText}>{view.totalPriorities}</Text>
        </View>
      </View>
      <Text style={sectionStyles.subtitle}>
        What to pay attention to, grouped so it is easier to scan. Tap anything to see more.
      </Text>

      {view.totalPriorities === 0 && !hasTimeline && view.watchAreas.length === 0 ? (
        <Text style={sectionStyles.bodyMuted}>
          No priorities right now. Concierge will surface one when something needs your review.
        </Text>
      ) : null}

      {hasTimeline ? (
        <View style={styles.timelineBlock}>
          <View style={styles.timelineHeader}>
            <Text style={styles.subTitle}>Care timeline</Text>
            {onExplainTimeline ? (
              <Pressable
                onPress={onExplainTimeline}
                accessibilityRole="button"
                accessibilityLabel="Explain this timeline with Concierge"
              >
                <Text style={styles.explainLink}>Explain</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.bucketRow}>
            {CARE_TIMELINE_BUCKET_ORDER.map((key) => {
              const count = timelineCounts.get(key) ?? 0;
              const active = openBucket === key;
              return (
                <Pressable
                  key={key}
                  style={[styles.bucketChip, active && styles.bucketChipActive]}
                  onPress={() => setOpenBucket(active ? null : key)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: active }}
                  accessibilityLabel={`${CARE_TIMELINE_BUCKET_LABELS[key]}, ${count} items`}
                >
                  <Text style={[styles.bucketChipText, active && styles.bucketChipTextActive]}>
                    {CARE_TIMELINE_BUCKET_LABELS[key]} · {count}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {openBucket && openBucketItems.length > 0 ? (
            <View style={styles.bucketItems}>
              {openBucketItems.map((item) => (
                <View key={item.id} style={styles.bucketItemRow}>
                  <Text style={sectionStyles.listBullet}>{'\u2022'}</Text>
                  <Text style={styles.bucketItemText} numberOfLines={2}>
                    {item.text}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {openBucket && openBucketItems.length === 0 ? (
            <Text style={styles.bucketEmpty}>Nothing here yet.</Text>
          ) : null}
        </View>
      ) : null}

      {view.groups.map((group) => (
        <PriorityGroupBlock
          key={group.category}
          group={group}
          relatedNames={view.relatedByCategory[group.category] ?? []}
          expanded={Boolean(expandedGroups[group.category])}
          onToggle={() => setExpandedGroups((current) => toggle(current, group.category))}
          expandedRows={expandedRows}
          onToggleRow={(rowId) => setExpandedRows((current) => toggle(current, rowId))}
          onExplainCard={onExplainCard}
          onRespond={onRespond}
        />
      ))}

      {view.watchAreas.length > 0 ? (
        <View style={styles.watchBlock}>
          <Pressable
            style={styles.watchHeader}
            onPress={() => setWatchAreasExpanded((current) => !current)}
            accessibilityRole="button"
            accessibilityState={{ expanded: watchAreasExpanded }}
            accessibilityLabel={`Medication areas to watch, ${watchAreaCountLabel}`}
          >
            <Text style={styles.watchHeaderTitle}>Medication areas to watch</Text>
            <View style={styles.watchHeaderMeta}>
              <Text style={styles.watchCount}>{watchAreaCountLabel}</Text>
              <Text style={styles.chevron}>{watchAreasExpanded ? 'v' : '>'}</Text>
            </View>
          </Pressable>
          {watchAreasExpanded ? (
            <View style={styles.watchList}>
              {view.watchAreas.map((area) => (
                <MedicationWatchRow
                  key={area.medicationId}
                  area={area}
                  onExplain={onExplainWatchArea}
                  onAddToPlan={onAddWatchAreaToPlan}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function PriorityGroupBlock({
  group,
  relatedNames,
  expanded,
  onToggle,
  expandedRows,
  onToggleRow,
  onExplainCard,
  onRespond,
}: {
  group: CarePriorityGroup;
  relatedNames: string[];
  expanded: boolean;
  onToggle: () => void;
  expandedRows: Record<string, boolean>;
  onToggleRow: (rowId: string) => void;
  onExplainCard?: (card: LatestUc4PriorityCardSummary) => void;
  onRespond?: CarePrioritiesSectionProps['onRespond'];
}) {
  return (
    <View style={styles.groupBlock}>
      <Pressable
        style={styles.groupHeader}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${group.label}, ${group.rows.length} priorities`}
      >
        <View style={styles.groupHeaderText}>
          <Text style={styles.groupTitle}>{group.label}</Text>
          {relatedNames.length > 0 ? (
            <Text style={styles.relatedText} numberOfLines={1}>
              Related: {relatedNames.join(', ')}
            </Text>
          ) : null}
        </View>
        <View style={styles.groupMeta}>
          <View style={[sectionStyles.pill, sectionStyles.pillMuted]}>
            <Text style={sectionStyles.pillMutedText}>{group.rows.length}</Text>
          </View>
          <Text style={styles.chevron}>{expanded ? '\u2212' : '+'}</Text>
        </View>
      </Pressable>

      {expanded
        ? group.rows.map((row) => (
            <PriorityRowBlock
              key={row.id}
              row={row}
              expanded={Boolean(expandedRows[row.id])}
              onToggle={() => onToggleRow(row.id)}
              onExplainCard={onExplainCard}
              onRespond={onRespond}
            />
          ))
        : null}
    </View>
  );
}

function PriorityRowBlock({
  row,
  expanded,
  onToggle,
  onExplainCard,
  onRespond,
}: {
  row: CarePriorityRow;
  expanded: boolean;
  onToggle: () => void;
  onExplainCard?: (card: LatestUc4PriorityCardSummary) => void;
  onRespond?: CarePrioritiesSectionProps['onRespond'];
}) {
  const whyLines = row.card
    ? row.card.firedRuleCodes
        .map((code) => RULE_DESCRIPTIONS.get(code))
        .filter((line): line is string => Boolean(line))
    : [];

  return (
    <View style={styles.rowBlock}>
      <Pressable
        style={styles.rowHeader}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={row.title}
      >
        <Text style={styles.rowTitle} numberOfLines={expanded ? undefined : 2}>
          {row.title}
        </Text>
        <Text style={styles.rowScore}>{Math.round(row.score * 100)}%</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.rowBody}>
          {row.kind === 'uc4_live' && row.card ? (
            <Uc4PriorityCard
              card={row.card}
              onExplain={onExplainCard ? (card) => onExplainCard(card) : undefined}
              onRespond={onRespond}
            />
          ) : null}

          {row.kind === 'plan_priority' ? (
            <Text style={styles.planPriorityNote}>On your care plan.</Text>
          ) : null}

          {whyLines.length > 0 ? (
            <View style={styles.whyBlock}>
              <Text style={styles.whyTitle}>Why you are seeing this</Text>
              {whyLines.map((line) => (
                <View key={line} style={styles.bucketItemRow}>
                  <Text style={sectionStyles.listBullet}>{'\u2022'}</Text>
                  <Text style={styles.whyText}>{line}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function MedicationWatchRow({
  area,
  onExplain,
  onAddToPlan,
}: {
  area: MedicationWatchArea;
  onExplain?: (area: MedicationWatchArea) => void;
  onAddToPlan?: (area: MedicationWatchArea) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? area.watchAreas : area.watchAreas.slice(0, 3);
  return (
    <View style={styles.watchRow}>
      <Text style={styles.watchMedName} numberOfLines={1}>
        {area.medicationName}
      </Text>
      <View style={styles.watchChips}>
        {visible.map((code) => (
          <View key={code} style={styles.watchChip}>
            <Text style={styles.watchChipText}>{humanizeMedicationWatchCode(code)}</Text>
          </View>
        ))}
        {area.watchAreas.length > 3 ? (
          <Pressable
            onPress={() => setExpanded((current) => !current)}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Show fewer watch areas' : 'Show all watch areas'}
          >
            <Text style={styles.explainLink}>
              {expanded ? 'Less' : `+${area.watchAreas.length - 3} more`}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {onExplain || onAddToPlan ? (
        <View style={styles.watchActions}>
          {onExplain ? (
            <Pressable
              onPress={() => onExplain(area)}
              accessibilityRole="button"
              accessibilityLabel={`Explain watch areas for ${area.medicationName}`}
            >
              <Text style={styles.explainLink}>Explain</Text>
            </Pressable>
          ) : null}
          {onAddToPlan ? (
            <Pressable
              onPress={() => onAddToPlan(area)}
              accessibilityRole="button"
              accessibilityLabel={`Review watch areas for ${area.medicationName} for the care plan`}
            >
              <Text style={styles.explainLink}>Review for care plan</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  subTitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.3,
    marginTop: 6,
    marginBottom: 6,
  },
  timelineBlock: {
    marginBottom: 8,
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bucketRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  bucketChip: {
    borderRadius: 999,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  bucketChipActive: {
    backgroundColor: AppTheme.colors.brandSoft,
  },
  bucketChipText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  bucketChipTextActive: {
    color: AppTheme.colors.brand,
  },
  bucketItems: {
    marginTop: 8,
    gap: 4,
  },
  bucketItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bucketItemText: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  bucketEmpty: {
    marginTop: 8,
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  groupBlock: {
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    paddingVertical: 6,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  groupHeaderText: {
    flex: 1,
    marginRight: 8,
  },
  groupTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  relatedText: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  groupMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chevron: {
    color: AppTheme.colors.textMuted,
    fontSize: 16,
    fontWeight: '900',
  },
  rowBlock: {
    paddingLeft: 8,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
  },
  rowTitle: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  rowScore: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: '900',
  },
  rowBody: {
    paddingBottom: 8,
  },
  planPriorityNote: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    fontStyle: 'italic',
    marginBottom: 6,
  },
  whyBlock: {
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    paddingTop: 8,
    marginTop: 2,
    gap: 4,
  },
  whyTitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  whyText: {
    flex: 1,
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  watchBlock: {
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    marginTop: 6,
    paddingTop: 6,
  },
  watchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 6,
  },
  watchHeaderTitle: {
    flex: 1,
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  watchHeaderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  watchCount: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  watchList: {
    paddingTop: 4,
  },
  watchRow: {
    marginBottom: 8,
    gap: 6,
  },
  watchMedName: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  watchChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  watchActions: {
    flexDirection: 'row',
    gap: 14,
  },
  watchChip: {
    borderRadius: 999,
    backgroundColor: AppTheme.colors.brandSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  watchChipText: {
    color: AppTheme.colors.brand,
    fontSize: 11,
    fontWeight: '800',
  },
  explainLink: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: '900',
  },
});
