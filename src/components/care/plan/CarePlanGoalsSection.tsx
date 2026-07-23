/**
 * Care plan "Goals & activities" section (Care tab rework).
 *
 * Goals and care-team activities are consolidated by category (skin,
 * breathing, medication, …) so the list is short and scannable; wordy text
 * is hidden behind per-item expansion. Status chips explain themselves on
 * tap. A "Care considerations" block restores the onboarding concern fields
 * (main concern, support needs, other symptoms, mobility, daily routine).
 * Safety notes stay off this list. Every block offers an optional Concierge
 * explanation.
 */

import { useEffect, useMemo, useState } from 'react';
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
import { narrativeToBullets } from '@/services/carePlan/considerationBullets';
import type { PatientNluContext } from '@/nlu/types';
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
  /** Baseline daily routine from onboarding / patient record. */
  dailyRoutine?: string | null;
  /** Functional mobility scales (GMFCS, FMS, …) from ADCP or patient. */
  functionalScales?: Record<string, string> | null;
  /** ADCP extensions.careContext narratives when present. */
  careContextExtension?: {
    mainConcern?: string;
    supportNeeds?: string;
    dailyRoutine?: string;
    mobilitySummary?: string;
    otherNotes?: string;
  } | null;
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

/** Collapse verbose EHR/FHIR goal text into a short scannable line. */
function summarizeGoalText(raw: string, maxLen = 96): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  // Drop common FHIR boilerplate prefixes.
  t = t
    .replace(/^(goal|activity|care plan goal|objective)\s*[:\-–—]\s*/i, '')
    .replace(/\b(patient|caregiver)\s+(will|should|to)\s+/gi, '')
    .replace(/\s*\([^)]{0,40}\)\s*$/g, '')
    .trim();
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}\u2026`;
}

export function CarePlanGoalsSection({
  patientId,
  primaryPlan,
  goals,
  caregiver,
  symptoms = [],
  dailyRoutine,
  functionalScales,
  careContextExtension,
  onExplainItem,
  onExplainCategory,
  onExplainConsideration,
}: CarePlanGoalsSectionProps) {
  const activities = useMemo(
    () => primaryPlan?.activities ?? [],
    [primaryPlan?.activities],
  );
  const careTeam = parseCareTeam(primaryPlan?.careTeamDisplayJson);

  // Overview + care-area groups open by default so bullet cards are visible.
  const [sectionExpanded, setSectionExpanded] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [statusInfoFor, setStatusInfoFor] = useState<string | null>(null);
  const [expandedConsiderations, setExpandedConsiderations] = useState<Record<string, boolean>>({});
  const [expandedSummarySections, setExpandedSummarySections] = useState<Record<string, boolean>>(
    {},
  );

  // Group goals + activities by category.
  const orderedGroups = useMemo(() => {
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
    return CARE_CATEGORY_ORDER.filter((key) => groups.has(key)).map((key) => ({
      key,
      label: careCategoryLabel(key),
      items: groups.get(key) ?? [],
    }));
  }, [goals, activities]);

  const total = goals.length + activities.length;
  const considerations = buildConsiderations({
    caregiver: caregiver ?? null,
    symptoms,
    dailyRoutine,
    functionalScales,
    careContextExtension,
  });
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

  // Open every care-area group whenever plan content changes (no flash of collapsed previews).
  useEffect(() => {
    const openGroups: Record<string, boolean> = {};
    for (const g of orderedGroups) openGroups[g.key] = true;
    const handle = setTimeout(() => {
      setSectionExpanded(true);
      setExpandedGroups(openGroups);
      setExpandedItems({});
      setStatusInfoFor(null);
      setExpandedConsiderations({});
      setExpandedSummarySections({});
    }, 0);
    return () => clearTimeout(handle);
  }, [displayedContentKey, orderedGroups]);

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
                // Default open: missing key means expanded so first paint shows bullets.
                const expanded = expandedGroups[group.key] !== false;
                return (
                  <View key={group.key} style={styles.groupBlock}>
                    <View style={styles.groupHeaderRow}>
                      <Pressable
                        style={styles.groupHeader}
                        onPress={() =>
                          setExpandedGroups((current) => ({
                            ...current,
                            [group.key]: !(current[group.key] !== false),
                          }))
                        }
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

                    {expanded ? (
                      <View style={styles.bulletList}>
                        {group.items.map((item) => {
                          const itemExpanded = Boolean(expandedItems[item.id]);
                          const summary = summarizeGoalText(item.text);
                          return (
                            <View key={item.id} style={styles.bulletRow}>
                              <Text style={styles.bulletMark}>{'\u2022'}</Text>
                              <View style={styles.bulletBody}>
                                <Pressable
                                  onPress={() =>
                                    setExpandedItems((current) => toggle(current, item.id))
                                  }
                                  accessibilityRole="button"
                                  accessibilityState={{ expanded: itemExpanded }}
                                  accessibilityLabel={summary}
                                >
                                  <Text style={styles.bulletText}>
                                    {itemExpanded ? item.text : summary}
                                  </Text>
                                  <View style={styles.itemMetaRow}>
                                    <Text style={styles.kindTag}>
                                      {item.kind === 'goal' ? 'Goal' : 'Activity'}
                                    </Text>
                                    {item.status ? (
                                      <Pressable
                                        onPress={() =>
                                          setStatusInfoFor((current) =>
                                            current === item.id ? null : item.id,
                                          )
                                        }
                                        accessibilityRole="button"
                                        accessibilityLabel={`Status ${item.status}`}
                                      >
                                        <Text style={styles.statusChip}>{item.status}</Text>
                                      </Pressable>
                                    ) : null}
                                    {item.targetDate ? (
                                      <Text style={styles.itemMeta}>
                                        Target {item.targetDate}
                                      </Text>
                                    ) : null}
                                  </View>
                                </Pressable>
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
                                    <Text style={styles.explainLink}>
                                      Explain with Concierge
                                    </Text>
                                  </Pressable>
                                ) : null}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ) : (
                      <View style={styles.previewList}>
                        {group.items.slice(0, 3).map((item) => (
                          <Text key={item.id} style={styles.previewLine} numberOfLines={1}>
                            {'\u2022'} {summarizeGoalText(item.text, 72)}
                          </Text>
                        ))}
                        {group.items.length > 3 ? (
                          <Text style={styles.previewMore}>
                            +{group.items.length - 3} more
                          </Text>
                        ) : null}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ) : null}

          {hasCareConsiderations ? (
            <View style={styles.summarySection} accessible accessibilityLabel="Care considerations">
              <View style={styles.summarySectionHeaderStatic}>
                <Text style={styles.summarySectionTitle}>Care considerations</Text>
              </View>
              <View style={styles.summarySectionBody}>
                {considerations.map((consideration) => {
                  const expanded = Boolean(expandedConsiderations[consideration.id]);
                  const bullets =
                    consideration.bullets.length > 0
                      ? consideration.bullets
                      : [consideration.text];
                  return (
                    <View key={consideration.id} style={styles.considerationBlock}>
                      <Pressable
                        style={styles.considerationHeader}
                        onPress={() =>
                          setExpandedConsiderations((current) =>
                            toggle(current, consideration.id),
                          )
                        }
                        accessibilityRole="button"
                        accessibilityState={{ expanded }}
                        accessibilityLabel={`${consideration.label}, ${bullets.length} points`}
                      >
                        <Text style={styles.considerationLabel}>{consideration.label}</Text>
                        <View style={styles.groupMeta}>
                          <View style={[sectionStyles.pill, sectionStyles.pillMuted]}>
                            <Text style={sectionStyles.pillMutedText}>
                              {bullets.length}
                            </Text>
                          </View>
                          <Text style={styles.chevron}>{expanded ? '\u2212' : '+'}</Text>
                        </View>
                      </Pressable>
                      {expanded ? (
                        <>
                          <View style={styles.bulletList}>
                            {bullets.map((bullet, idx) => (
                              <View
                                key={`${consideration.id}-b-${idx}`}
                                style={styles.bulletRow}
                              >
                                <Text style={styles.bulletMark}>{'\u2022'}</Text>
                                <Text style={styles.bulletText}>{bullet}</Text>
                              </View>
                            ))}
                          </View>
                          <Text style={styles.considerationFullText}>
                            {consideration.text}
                          </Text>
                          {onExplainConsideration ? (
                            <Pressable
                              onPress={() => onExplainConsideration(consideration.text)}
                              accessibilityRole="button"
                              accessibilityLabel={`Discuss ${consideration.label} with Concierge`}
                            >
                              <Text style={styles.explainLink}>
                                Discuss with Concierge
                              </Text>
                            </Pressable>
                          ) : null}
                        </>
                      ) : null}
                    </View>
                  );
                })}
              </View>
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
  /** Original onboarding / ADCP narrative (for Concierge explain). */
  text: string;
  /** NLU-assisted short bullets for display. */
  bullets: string[];
}

const SCALE_LABELS: Record<string, string> = {
  gmfcs: 'GMFCS',
  fms: 'FMS',
  macs: 'MACS',
  cfcs: 'CFCS',
  edacs: 'EDACS',
};

function buildNluContextForConsiderations(input: {
  caregiver: Caregiver | null;
  symptoms: Symptom[];
  functionalScales?: Record<string, string> | null;
  narratives: string[];
}): PatientNluContext {
  const scaleKeywords = Object.entries(input.functionalScales ?? {})
    .filter(([, v]) => v && v !== 'Not assessed')
    .map(([k, v]) => `${SCALE_LABELS[k] ?? k} ${v}`);
  const symptomLabels = input.symptoms.map((s) => s.label).filter(Boolean);
  // Harvest distinctive tokens from narratives as knowledge keywords for linking.
  const fromNarratives = input.narratives
    .join(' ')
    .toLowerCase()
    .match(
      /\b(breathing|swallowing|seizure|seizures|positioning|skin|comfort|energy|transfer|transfers|medication|medications|meals|coughing|choking|fever|recovery|procedure|procedures|organization|changes)\b/g,
    );
  const knowledgeKeywords = [
    ...new Set([...(fromNarratives ?? []), ...scaleKeywords.map((s) => s.toLowerCase())]),
  ];
  return {
    patientId: '',
    patientName: '',
    conditions: [],
    comorbidities: [],
    medications: [],
    symptoms: symptomLabels,
    knowledgeKeywords,
    vitalTypes: ['SpO2', 'heart rate', 'respiratory rate', 'oxygen'],
  };
}

function toConsideration(
  id: string,
  label: string,
  text: string,
  ctx: PatientNluContext,
): Consideration {
  return {
    id,
    label,
    text,
    bullets: narrativeToBullets(text, ctx),
  };
}

function buildConsiderations(input: {
  caregiver: Caregiver | null;
  symptoms: Symptom[];
  dailyRoutine?: string | null;
  functionalScales?: Record<string, string> | null;
  careContextExtension?: CarePlanGoalsSectionProps['careContextExtension'];
}): Consideration[] {
  const list: Consideration[] = [];
  const ext = input.careContextExtension;

  const mainConcern =
    input.caregiver?.mainConcern?.trim() || ext?.mainConcern?.trim() || '';
  const otherSymptoms = input.symptoms
    .filter((symptom) => symptom.category === 'other')
    .map((symptom) => symptom.label)
    .join(', ');
  const support =
    input.caregiver?.stressOrSupportNeeds?.trim() || ext?.supportNeeds?.trim() || '';
  const mobility =
    formatFunctionalScales(input.functionalScales) ||
    ext?.mobilitySummary?.trim() ||
    '';
  const routine =
    input.dailyRoutine?.trim() || ext?.dailyRoutine?.trim() || '';
  const otherNotes = ext?.otherNotes?.trim() || '';

  const nluCtx = buildNluContextForConsiderations({
    caregiver: input.caregiver,
    symptoms: input.symptoms,
    functionalScales: input.functionalScales,
    narratives: [mainConcern, support, routine, mobility, otherNotes, otherSymptoms],
  });

  if (mainConcern) {
    list.push(toConsideration('main-concern', 'Main concern', mainConcern, nluCtx));
  }

  if (otherSymptoms) {
    // Already a short list — still bulletize for consistency.
    list.push(toConsideration('other-symptoms', 'Other symptoms', otherSymptoms, nluCtx));
  }

  if (support) {
    list.push(toConsideration('support-needs', 'Support needs', support, nluCtx));
  }

  if (mobility) {
    list.push(toConsideration('mobility', 'Mobility & function', mobility, nluCtx));
  }

  if (routine) {
    list.push(toConsideration('daily-routine', 'Daily routine', routine, nluCtx));
  }

  if (otherNotes) {
    list.push(toConsideration('other-notes', 'Additional notes', otherNotes, nluCtx));
  }

  return list;
}

function formatFunctionalScales(
  scales: Record<string, string> | null | undefined,
): string {
  if (!scales) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(scales)) {
    const v = value?.trim();
    if (!v || v.toLowerCase() === 'not assessed') continue;
    const label = SCALE_LABELS[key.toLowerCase()] ?? key.toUpperCase();
    parts.push(`${label}: ${v}`);
  }
  return parts.join(' · ');
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
  bulletList: {
    paddingTop: 4,
    paddingBottom: 4,
    gap: 2,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 12,
    backgroundColor: AppTheme.colors.softSurface,
    marginBottom: 6,
    paddingRight: 10,
    paddingLeft: 12,
  },
  bulletMark: {
    color: AppTheme.colors.brand,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 1,
    lineHeight: 20,
  },
  bulletBody: {
    flex: 1,
  },
  bulletText: {
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  previewList: {
    paddingLeft: 4,
    paddingBottom: 4,
    gap: 2,
  },
  previewLine: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  previewMore: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
    marginLeft: 2,
  },
  itemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
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
  summarySectionHeaderStatic: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
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
  considerationBlock: {
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
  },
  considerationHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 4,
  },
  considerationLabel: {
    flex: 1,
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  considerationFullText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    fontStyle: 'italic',
    marginTop: 8,
    marginBottom: 2,
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
