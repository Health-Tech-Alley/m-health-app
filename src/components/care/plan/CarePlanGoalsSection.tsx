/**
 * Care plan "Goals & activities" section (Care tab rework).
 *
 * Goals and care-team activities are consolidated by category (skin,
 * breathing, medication, …) so the list is short and scannable; wordy text
 * is hidden behind per-item expansion. Status chips explain themselves on
 * tap. A "Care considerations" block restores the onboarding concern fields
 * (main concern, support needs, other symptoms) and surfaces the safety
 * notes / safety lines that used to be their own card. Every block offers
 * an optional Concierge explanation.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import type {
  Caregiver,
  CarePlan,
  CarePlanGoalSummary,
  Symptom,
} from '@/data/types';
import {
  categorizeCareText,
  careCategoryLabel,
  CARE_CATEGORY_ORDER,
  type CareCategoryKey,
} from '@/services/carePlan/careCategories';
import type { CarePlanSafetyLine } from '@/services/carePlan/carePlanViewModel';
import { sectionStyles } from './carePlanSectionStyles';

export interface GoalExplainRequest {
  kind: 'goal' | 'activity';
  text: string;
  status?: string | null;
  targetDate?: string | null;
}

export interface CategoryExplainRequest {
  categoryLabel: string;
  items: string[];
}

export interface CarePlanGoalsSectionProps {
  patientId?: string | null;
  primaryPlan: CarePlan | null;
  goals: CarePlanGoalSummary[];
  caregiver?: Caregiver | null;
  symptoms?: Symptom[];
  safetyNotes?: string;
  safetyLines?: CarePlanSafetyLine[];
  onExplainItem?: (request: GoalExplainRequest) => void;
  onExplainCategory?: (request: CategoryExplainRequest) => void;
  onExplainConsideration?: (text: string) => void;
}

interface GroupedItem {
  id: string;
  kind: 'goal' | 'activity';
  text: string;
  status?: string | null;
  targetDate?: string | null;
}

function toggle(set: Record<string, boolean>, key: string): Record<string, boolean> {
  return { ...set, [key]: !set[key] };
}

function statusExplanation(status: string | null | undefined): string {
  switch ((status ?? '').toLowerCase()) {
    case 'active':
      return '"Active" means this is still being worked on — the care team has not marked it complete.';
    case 'in-progress':
      return '"In progress" means work on this has started and is still going.';
    case 'completed':
      return '"Completed" means the care team marked this done.';
    case 'cancelled':
    case 'on-hold':
      return `"${status}" means this is paused for now, not abandoned.`;
    default:
      return status ? `Status reported by the care team: "${status}".` : 'No status was recorded for this item.';
  }
}

export function CarePlanGoalsSection({
  patientId,
  primaryPlan,
  goals,
  caregiver,
  symptoms = [],
  safetyNotes,
  safetyLines = [],
  onExplainItem,
  onExplainCategory,
  onExplainConsideration,
}: CarePlanGoalsSectionProps) {
  const activities = primaryPlan?.activities ?? [];
  const careTeam = parseCareTeam(primaryPlan?.careTeamDisplayJson);

  // Overview expanded by default; nested groups/items stay collapsed.
  const [sectionExpanded, setSectionExpanded] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [statusInfoFor, setStatusInfoFor] = useState<string | null>(null);
  const [expandedConsiderations, setExpandedConsiderations] = useState<Record<string, boolean>>({});
  const [expandedSummarySections, setExpandedSummarySections] = useState<Record<string, boolean>>({});

  // Group goals + activities by category.
  const groups = new Map<CareCategoryKey, GroupedItem[]>();
  const push = (item: GroupedItem) => {
    const key = categorizeCareText(item.text);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  };
  for (const goal of goals) {
    push({
      id: `goal:${goal.goalId}`,
      kind: 'goal',
      text: goal.description ?? 'Goal',
      status: goal.status,
      targetDate: goal.targetDate ?? null,
    });
  }
  for (const activity of activities) {
    push({
      id: `activity:${activity.activityId}`,
      kind: 'activity',
      text: activity.description ?? 'Activity',
      status: activity.status,
    });
  }
  const orderedGroups = CARE_CATEGORY_ORDER.filter((key) => groups.has(key)).map((key) => ({
    key,
    label: careCategoryLabel(key),
    items: groups.get(key) ?? [],
  }));

  const total = goals.length + activities.length;
  const considerations = buildConsiderations(caregiver ?? null, symptoms, safetyNotes, safetyLines);
  const hasCareAreas = orderedGroups.length > 0;
  const hasCareConsiderations = considerations.length > 0;
  const hasCareTeam = careTeam.length > 0;
  const subtitleLabels = [
    hasCareAreas ? 'Care areas' : '',
    hasCareConsiderations ? 'Care considerations' : '',
    hasCareTeam ? 'Care team' : '',
  ].filter(Boolean);
  const displayedContentKey = [
    patientId ?? 'no-patient',
    ...orderedGroups.flatMap((group) => [
      group.key,
      ...group.items.map((item) => `${item.id}:${item.status ?? ''}:${item.targetDate ?? ''}`),
    ]),
    ...considerations.map((consideration) => `${consideration.id}:${consideration.text}`),
    ...careTeam,
  ].join('|');

  useEffect(() => {
    // Keep the section overview open on content change; collapse nested parts only.
    const handle = setTimeout(() => {
      setSectionExpanded(true);
      setExpandedGroups({});
      setExpandedItems({});
      setStatusInfoFor(null);
      setExpandedConsiderations({});
      setExpandedSummarySections({});
    }, 0);
    return () => clearTimeout(handle);
  }, [displayedContentKey]);

  if (!hasCareAreas && !hasCareConsiderations && !hasCareTeam) {
    return null;
  }

  return (
    <View style={sectionStyles.card}>
      <Pressable
        style={styles.sectionHeader}
        onPress={() => setSectionExpanded((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded: sectionExpanded }}
        accessibilityLabel={`Goals and activities${total > 0 ? `, ${total} items` : ''}${
          subtitleLabels.length > 0 ? `, ${subtitleLabels.join(', ')}` : ''
        }`}
      >
        <View style={styles.sectionTitleRow}>
          <Text style={[sectionStyles.title, styles.sectionTitleText]}>Goals & activities</Text>
          {total > 0 ? (
            <View style={sectionStyles.pill}>
              <Text style={sectionStyles.pillText}>{total}</Text>
            </View>
          ) : null}
          <Text style={styles.sectionChevron}>{sectionExpanded ? '\u2304' : '\u203a'}</Text>
        </View>
        {subtitleLabels.length > 0 ? (
          <Text style={styles.sectionSubtitle}>{subtitleLabels.join(' \u00b7 ')}</Text>
        ) : null}
      </Pressable>

      {sectionExpanded ? (
        <View style={styles.expandedBody}>
          {hasCareAreas ? (
            <View>
              <Text style={styles.bodySectionTitle}>Care areas</Text>
              {orderedGroups.map((group) => {
                const expanded = Boolean(expandedGroups[group.key]);
                return (
                  <View key={group.key} style={styles.groupBlock}>
                    <View style={styles.groupHeaderRow}>
                      <Pressable
                        style={styles.groupHeader}
                        onPress={() => setExpandedGroups((current) => toggle(current, group.key))}
                        accessibilityRole="button"
                        accessibilityState={{ expanded }}
                        accessibilityLabel={`${group.label}, ${group.items.length} items`}
                      >
                        <Text style={styles.groupTitle}>{group.label}</Text>
                        <View style={styles.groupMeta}>
                          <View style={[sectionStyles.pill, sectionStyles.pillMuted]}>
                            <Text style={sectionStyles.pillMutedText}>{group.items.length}</Text>
                          </View>
                          <Text style={styles.chevron}>{expanded ? '\u2212' : '+'}</Text>
                        </View>
                      </Pressable>
                      {expanded && onExplainCategory ? (
                        <Pressable
                          onPress={() =>
                            onExplainCategory({
                              categoryLabel: group.label,
                              items: group.items.map((item) => item.text),
                            })
                          }
                          accessibilityRole="button"
                          accessibilityLabel={`Explain ${group.label} with Concierge`}
                        >
                          <Text style={styles.explainLink}>Explain</Text>
                        </Pressable>
                      ) : null}
                    </View>

                    {expanded
                      ? group.items.map((item) => {
                          const itemExpanded = Boolean(expandedItems[item.id]);
                          return (
                            <View key={item.id} style={styles.itemBlock}>
                              <Pressable
                                style={styles.itemHeader}
                                onPress={() =>
                                  setExpandedItems((current) => toggle(current, item.id))
                                }
                                accessibilityRole="button"
                                accessibilityState={{ expanded: itemExpanded }}
                                accessibilityLabel={item.text}
                              >
                                <Text
                                  style={styles.itemText}
                                  numberOfLines={itemExpanded ? undefined : 2}
                                >
                                  {item.text}
                                </Text>
                              </Pressable>
                              <View style={styles.itemMetaRow}>
                                {item.kind === 'goal' ? (
                                  <Text style={styles.kindTag}>Goal</Text>
                                ) : (
                                  <Text style={styles.kindTag}>Activity</Text>
                                )}
                                {item.status ? (
                                  <Pressable
                                    onPress={() =>
                                      setStatusInfoFor((current) =>
                                        current === item.id ? null : item.id,
                                      )
                                    }
                                    accessibilityRole="button"
                                    accessibilityLabel={`Status ${item.status}. Tap to learn what this means.`}
                                  >
                                    <Text style={styles.statusChip}>{item.status}</Text>
                                  </Pressable>
                                ) : null}
                                {item.targetDate ? (
                                  <Text style={styles.itemMeta}>Target: {item.targetDate}</Text>
                                ) : null}
                              </View>
                              {statusInfoFor === item.id ? (
                                <Text style={styles.statusExplainer}>
                                  {statusExplanation(item.status)}
                                </Text>
                              ) : null}
                              {itemExpanded && onExplainItem ? (
                                <Pressable
                                  onPress={() =>
                                    onExplainItem({
                                      kind: item.kind,
                                      text: item.text,
                                      status: item.status,
                                      targetDate: item.targetDate,
                                    })
                                  }
                                  accessibilityRole="button"
                                  accessibilityLabel="Explain this item with Concierge"
                                >
                                  <Text style={styles.explainLink}>Explain with Concierge</Text>
                                </Pressable>
                              ) : null}
                            </View>
                          );
                        })
                      : null}
                  </View>
                );
              })}
            </View>
          ) : null}

          {hasCareConsiderations ? (
            <View style={styles.summarySection}>
              <Pressable
                style={styles.summarySectionHeader}
                onPress={() =>
                  setExpandedSummarySections((current) => toggle(current, 'considerations'))
                }
                accessibilityRole="button"
                accessibilityState={{ expanded: Boolean(expandedSummarySections.considerations) }}
                accessibilityLabel="Care considerations"
              >
                <Text style={styles.summarySectionTitle}>Care considerations</Text>
                <Text style={styles.sectionChevron}>
                  {expandedSummarySections.considerations ? '\u2304' : '\u203a'}
                </Text>
              </Pressable>
              {expandedSummarySections.considerations ? (
                <View style={styles.summarySectionBody}>
                  {considerations.map((consideration) => {
                    const expanded = Boolean(expandedConsiderations[consideration.id]);
                    return (
                      <View key={consideration.id} style={styles.considerationRow}>
                        <Pressable
                          onPress={() =>
                            setExpandedConsiderations((current) =>
                              toggle(current, consideration.id),
                            )
                          }
                          accessibilityRole="button"
                          accessibilityState={{ expanded }}
                          accessibilityLabel={`${consideration.label}: ${consideration.text}`}
                        >
                          <Text style={styles.considerationLabel}>{consideration.label}</Text>
                          <Text
                            style={styles.considerationText}
                            numberOfLines={expanded ? undefined : 2}
                          >
                            {consideration.text}
                          </Text>
                        </Pressable>
                        {expanded && onExplainConsideration ? (
                          <Pressable
                            onPress={() => onExplainConsideration(consideration.text)}
                            accessibilityRole="button"
                            accessibilityLabel={`Discuss ${consideration.label} with Concierge`}
                          >
                            <Text style={styles.explainLink}>Discuss with Concierge</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}

          {hasCareTeam ? (
            <View style={styles.summarySection}>
              <Pressable
                style={styles.summarySectionHeader}
                onPress={() => setExpandedSummarySections((current) => toggle(current, 'care-team'))}
                accessibilityRole="button"
                accessibilityState={{ expanded: Boolean(expandedSummarySections['care-team']) }}
                accessibilityLabel={`Care team, ${careTeam.length} ${
                  careTeam.length === 1 ? 'member' : 'members'
                }`}
              >
                <Text style={styles.summarySectionTitle}>Care team</Text>
                <View style={styles.groupMeta}>
                  <View style={[sectionStyles.pill, sectionStyles.pillMuted]}>
                    <Text style={sectionStyles.pillMutedText}>{careTeam.length}</Text>
                  </View>
                  <Text style={styles.sectionChevron}>
                    {expandedSummarySections['care-team'] ? '\u2304' : '\u203a'}
                  </Text>
                </View>
              </Pressable>
              {expandedSummarySections['care-team'] ? (
                <View style={styles.summarySectionBody}>
                  {careTeam.map((member) => (
                    <View key={member} style={styles.careTeamRow}>
                      <Text style={sectionStyles.listBullet}>{'\u2022'}</Text>
                      <Text style={sectionStyles.listText}>{member}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

interface Consideration {
  id: string;
  label: string;
  text: string;
}

function buildConsiderations(
  caregiver: Caregiver | null,
  symptoms: Symptom[],
  safetyNotes: string | undefined,
  safetyLines: CarePlanSafetyLine[],
): Consideration[] {
  const list: Consideration[] = [];
  if (caregiver?.mainConcern?.trim()) {
    list.push({ id: 'main-concern', label: 'Main concern', text: caregiver.mainConcern.trim() });
  }
  const otherSymptoms = symptoms
    .filter((symptom) => symptom.category === 'other')
    .map((symptom) => symptom.label)
    .join(', ');
  if (otherSymptoms) {
    list.push({ id: 'other-symptoms', label: 'Other symptoms', text: otherSymptoms });
  }
  if (caregiver?.stressOrSupportNeeds?.trim()) {
    list.push({
      id: 'support-needs',
      label: 'Support needs',
      text: caregiver.stressOrSupportNeeds.trim(),
    });
  }
  const notes = (safetyNotes ?? '').trim();
  const alwaysNever = safetyLines
    .filter((line) => line.kind !== 'note')
    .map((line) => `${line.kind === 'always' ? 'Always' : 'Never'}: ${line.text}`);
  const planNotes = safetyLines.find((line) => line.kind === 'note')?.text;
  const safetyText = [
    notes,
    planNotes && planNotes !== notes ? planNotes : '',
    ...alwaysNever,
  ]
    .filter(Boolean)
    .join('\n');
  if (safetyText) {
    list.push({ id: 'safety-notes', label: 'Safety notes', text: safetyText });
  }
  return list;
}

function parseCareTeam(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  } catch {
    return [];
  }
}

const styles = StyleSheet.create({
  sectionHeader: {
    minHeight: 44,
    justifyContent: 'center',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitleText: {
    flex: 1,
  },
  sectionChevron: {
    color: AppTheme.colors.textMuted,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
  },
  sectionSubtitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    marginTop: 4,
  },
  expandedBody: {
    marginTop: 8,
  },
  bodySectionTitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  groupBlock: {
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    paddingVertical: 6,
  },
  groupHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  groupHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    minHeight: 44,
  },
  groupTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
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
  itemBlock: {
    paddingLeft: 8,
    paddingBottom: 6,
  },
  itemHeader: {
    paddingVertical: 2,
  },
  itemText: {
    color: AppTheme.colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  itemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 3,
  },
  kindTag: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusChip: {
    color: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 11,
    fontWeight: '800',
  },
  itemMeta: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  statusExplainer: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    fontStyle: 'italic',
    marginTop: 4,
  },
  summarySection: {
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
  },
  summarySectionHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 6,
  },
  summarySectionTitle: {
    flex: 1,
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  summarySectionBody: {
    paddingBottom: 6,
  },
  considerationRow: {
    paddingVertical: 6,
  },
  considerationLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  considerationText: {
    color: AppTheme.colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginTop: 2,
  },
  careTeamRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 3,
  },
  explainLink: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 4,
  },
});
