/**
 * Care priorities derivation service (Care tab rework).
 *
 * Read-only, service-layer derivation over the existing patient snapshot +
 * active ADCP revision (same approved pattern as carePlanViewModel). It is
 * the ADCP's visible function on the Care tab: a consolidated, categorized
 * priority list, a short/medium/long-term care timeline, and medication
 * "areas to watch" — not a mirror of any single table.
 *
 * State-management compliance:
 *   - No snapshot fields, providers, Redux, or migrations.
 *   - Pure functions over PatientRecordSnapshot + AdcpPlanDocument.
 */

import type { AdcpPlanDocument } from '@/data/adcp/types';
import type {
  LatestUc4PriorityCardSummary,
  PatientRecordSnapshot,
} from '@/data/types';
import type { MedicationWatchCode } from '@/ml-models/uc4-micro-priorities';
import { mapMedicationNameToWatchAreas } from '@/ml-models/uc4-micro-priorities/uc4MedicationWatchMapping';
import {
  CARE_CATEGORY_ORDER,
  careCategoryForUc4Domain,
  careCategoryLabel,
  categorizeCareText,
  type CareCategoryKey,
} from './careCategories';

// ---------------------------------------------------------------------------
// Priority rows + groups
// ---------------------------------------------------------------------------

export interface CarePriorityRow {
  id: string;
  kind: 'uc4_live' | 'plan_priority';
  title: string;
  category: CareCategoryKey;
  score: number;
  status?: string | null;
  /** Present for live UC4 rows so the UI can expand the full card. */
  card?: LatestUc4PriorityCardSummary;
}

export interface CarePriorityGroup {
  category: CareCategoryKey;
  label: string;
  rows: CarePriorityRow[];
  topScore: number;
}

function categoryForUc4Card(card: LatestUc4PriorityCardSummary): CareCategoryKey {
  const byDomain = careCategoryForUc4Domain(card.domain);
  return byDomain !== 'other' ? byDomain : categorizeCareText(card.title);
}

function categoryForPlanPriority(priority: {
  title: string;
  domain: string;
}): CareCategoryKey {
  const byDomain = careCategoryForUc4Domain(priority.domain);
  return byDomain !== 'other' ? byDomain : categorizeCareText(priority.title);
}

export function buildCarePriorityGroups(
  snapshot: PatientRecordSnapshot | null,
  plan: AdcpPlanDocument | null,
): CarePriorityGroup[] {
  const liveCards = snapshot?.latestUc4PriorityCards ?? [];
  const liveIds = new Set(liveCards.map((card) => card.cardId));

  const rows: CarePriorityRow[] = liveCards.map((card) => ({
    id: card.cardId,
    kind: 'uc4_live',
    title: card.title,
    category: categoryForUc4Card(card),
    score: card.score,
    status: card.status,
    card,
  }));

  for (const priority of plan?.carePriorities.priorities ?? []) {
    if (priority.status !== 'active') continue;
    if (priority.sourceCardId && liveIds.has(priority.sourceCardId)) continue;
    rows.push({
      id: priority.priorityId,
      kind: 'plan_priority',
      title: priority.title,
      category: categoryForPlanPriority(priority),
      score: priority.weight,
      status: priority.status,
    });
  }

  const byCategory = new Map<CareCategoryKey, CarePriorityRow[]>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }

  return CARE_CATEGORY_ORDER.filter((key) => byCategory.has(key)).map((key) => {
    const groupRows = (byCategory.get(key) ?? []).sort((a, b) => b.score - a.score);
    return {
      category: key,
      label: careCategoryLabel(key),
      rows: groupRows,
      topScore: groupRows[0]?.score ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Care timeline (Now / Next / Later / Ongoing)
// ---------------------------------------------------------------------------

export type CareTimelineBucketKey = 'now' | 'next' | 'later' | 'ongoing';

export const CARE_TIMELINE_BUCKET_ORDER: CareTimelineBucketKey[] = [
  'now',
  'next',
  'later',
  'ongoing',
];

export const CARE_TIMELINE_BUCKET_LABELS: Record<CareTimelineBucketKey, string> = {
  now: 'Now',
  next: 'Next',
  later: 'Later',
  ongoing: 'Ongoing',
};

/** Goals due within this many days land in "Now". */
export const TIMELINE_NOW_MAX_DAYS = 14;
/** Goals due within this many days land in "Next". */
export const TIMELINE_NEXT_MAX_DAYS = 60;

export interface CareTimelineItem {
  id: string;
  text: string;
  category: CareCategoryKey;
  source: 'goal' | 'activity' | 'priority' | 'watch_area';
  targetDate?: string | null;
}

export interface CareTimelineBucket {
  key: CareTimelineBucketKey;
  label: string;
  items: CareTimelineItem[];
}

function daysUntil(targetDate: string, nowMs: number): number | null {
  const targetMs = Date.parse(`${targetDate.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(targetMs)) return null;
  const todayMs = nowMs - (nowMs % 86_400_000);
  return Math.round((targetMs - todayMs) / 86_400_000);
}

function bucketForGoal(targetDate: string | null | undefined, nowMs: number): CareTimelineBucketKey {
  if (!targetDate) return 'ongoing';
  const days = daysUntil(targetDate, nowMs);
  if (days == null) return 'ongoing';
  if (days <= TIMELINE_NOW_MAX_DAYS) return 'now';
  if (days <= TIMELINE_NEXT_MAX_DAYS) return 'next';
  return 'later';
}

export function buildCareTimeline(
  snapshot: PatientRecordSnapshot | null,
  plan: AdcpPlanDocument | null,
  nowMs: number = Date.now(),
): CareTimelineBucket[] {
  const buckets = new Map<CareTimelineBucketKey, CareTimelineItem[]>();
  const push = (key: CareTimelineBucketKey, item: CareTimelineItem) => {
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  };

  // This week: live UC4 priorities + active plan priorities.
  for (const card of snapshot?.latestUc4PriorityCards ?? []) {
    push('now', {
      id: `priority:${card.cardId}`,
      text: card.title,
      category: categoryForUc4Card(card),
      source: 'priority',
    });
  }
  const liveIds = new Set((snapshot?.latestUc4PriorityCards ?? []).map((c) => c.cardId));
  for (const priority of plan?.carePriorities.priorities ?? []) {
    if (priority.status !== 'active') continue;
    if (priority.sourceCardId && liveIds.has(priority.sourceCardId)) continue;
    push('now', {
      id: `priority:${priority.priorityId}`,
      text: priority.title,
      category: categoryForPlanPriority(priority),
      source: 'priority',
    });
  }

  // Goals bucket by target date.
  for (const goal of snapshot?.carePlanGoals ?? []) {
    const text = goal.description ?? 'Goal';
    push(bucketForGoal(goal.targetDate, nowMs), {
      id: `goal:${goal.goalId}`,
      text,
      category: categorizeCareText(text),
      source: 'goal',
      targetDate: goal.targetDate ?? null,
    });
  }

  // Care-team activities are standing work → ongoing.
  for (const activity of snapshot?.carePlan?.activities ?? []) {
    if (activity.status && activity.status !== 'active' && activity.status !== 'in-progress') {
      continue;
    }
    const text = activity.description ?? 'Care team activity';
    push('ongoing', {
      id: `activity:${activity.activityId}`,
      text,
      category: categorizeCareText(text),
      source: 'activity',
    });
  }

  return CARE_TIMELINE_BUCKET_ORDER.map((key) => ({
    key,
    label: CARE_TIMELINE_BUCKET_LABELS[key],
    items: buckets.get(key) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Medication "areas to watch"
// ---------------------------------------------------------------------------

export interface MedicationWatchArea {
  medicationId: string;
  medicationName: string;
  watchAreas: MedicationWatchCode[];
}

export function buildMedicationWatchAreas(
  snapshot: PatientRecordSnapshot | null,
): MedicationWatchArea[] {
  return (snapshot?.medications ?? [])
    .filter((medication) => medication.active)
    .map((medication) => ({
      medicationId: medication.medicationId,
      medicationName: medication.name,
      watchAreas: mapMedicationNameToWatchAreas(medication.name),
    }))
    .filter((entry) => entry.watchAreas.length > 0);
}

const WATCH_CODE_LABELS: Record<MedicationWatchCode, string> = {
  SLEEPINESS_FATIGUE: 'Sleepiness or fatigue',
  DIZZINESS_OR_LIGHTHEADEDNESS: 'Dizziness or lightheadedness',
  WEAKNESS_OR_LOW_TONE_CONCERN: 'Weakness or low tone',
  MOOD_BEHAVIOR_CHANGE: 'Mood or behavior changes',
  APPETITE_OR_HYDRATION_CHANGE: 'Appetite or hydration changes',
  BOWEL_CHANGE: 'Bowel changes',
  BREATHING_CONCERN: 'Breathing',
  HEART_RATE_OR_BP_CONCERN: 'Heart rate or blood pressure',
  SKIN_RASH_OR_ALLERGY_CONCERN: 'Skin rash or allergy',
  MISSED_OR_DELAYED_DOSE: 'Missed or delayed doses',
  MEDICATION_TIMING_CONTEXT_NEEDED: 'What was happening around dose time',
};

export function humanizeMedicationWatchCode(code: MedicationWatchCode | string): string {
  return (
    WATCH_CODE_LABELS[code as MedicationWatchCode] ??
    code.replace(/_/g, ' ').toLowerCase()
  );
}

// ---------------------------------------------------------------------------
// Knowledge-graph relations (read-only, display-only)
// ---------------------------------------------------------------------------

/**
 * Annotate categories with related condition/medication names from the
 * knowledge graph ("Related: spasticity, baclofen"). Best-effort: any
 * projector/DB failure degrades to no annotations. Read-only — the graph
 * is built from SQLite and never written here.
 */
export function buildRelatedNamesByCategory(
  patientId: string | null | undefined,
): Partial<Record<CareCategoryKey, string[]>> {
  if (!patientId) return {};
  try {
    // Lazy require to keep this module's import graph light (same pattern as
    // contextAssembler) and to stay Track-A safe if the KG layer changes.
    const { GraphProjector } =
      require('@/knowledge/graph/graph-projector') as typeof import('@/knowledge/graph/graph-projector');
    const { buildContextSubgraph } =
      require('@/knowledge/graph/context-subgraph') as typeof import('@/knowledge/graph/context-subgraph');
    const graph = new GraphProjector().build(patientId, 30);
    const subgraph = buildContextSubgraph(graph, patientId);

    const names = [...subgraph.relatedConditions, ...subgraph.relatedMedications]
      .map((node) => node.label?.trim() ?? '')
      .filter((label) => label.length > 0);

    const related: Partial<Record<CareCategoryKey, string[]>> = {};
    for (const name of names) {
      const category = categorizeCareText(name);
      if (category === 'other') continue;
      const list = related[category] ?? [];
      if (!list.includes(name) && list.length < 3) {
        related[category] = [...list, name];
      }
    }
    return related;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Combined view
// ---------------------------------------------------------------------------

export interface CarePrioritiesView {
  groups: CarePriorityGroup[];
  timeline: CareTimelineBucket[];
  watchAreas: MedicationWatchArea[];
  totalPriorities: number;
  /** KG-derived related condition/medication names, keyed by category. */
  relatedByCategory: Partial<Record<CareCategoryKey, string[]>>;
}

export function buildCarePrioritiesView(
  snapshot: PatientRecordSnapshot | null,
  plan: AdcpPlanDocument | null,
  nowMs: number = Date.now(),
): CarePrioritiesView {
  const groups = buildCarePriorityGroups(snapshot, plan);
  return {
    groups,
    timeline: buildCareTimeline(snapshot, plan, nowMs),
    watchAreas: buildMedicationWatchAreas(snapshot),
    totalPriorities: groups.reduce((sum, group) => sum + group.rows.length, 0),
    relatedByCategory: buildRelatedNamesByCategory(snapshot?.patient?.patientId),
  };
}
