import type { AdcpPlanDocument } from '@/data/adcp/types';
import type {
  LatestUc4PriorityCardSummary,
  PatientRecordSnapshot,
} from '@/data/types';
import {
  buildCarePriorityGroups,
  buildCarePrioritiesView,
  buildCareTimeline,
  buildMedicationWatchAreas,
  humanizeMedicationWatchCode,
  TIMELINE_NOW_MAX_DAYS,
} from './carePrioritiesService';

const NOW = Date.parse('2026-07-21T12:00:00.000Z');

function uc4Card(overrides: Partial<LatestUc4PriorityCardSummary> = {}): LatestUc4PriorityCardSummary {
  return {
    cardId: 'card-1',
    patientId: 'patient-1',
    runId: 'run-1',
    templateId: 'SKIN_PRESSURE_AFTER_SEATED_PERIOD',
    priorityKind: 'recurring_concern',
    title: 'Watch skin after long seated periods',
    body: 'Body text',
    domain: 'skin_pressure_prevention_context',
    score: 0.8,
    firedRuleCodes: ['R_SKIN_PRESSURE_FOCUS'],
    evidence: [],
    whatToLogNextSchema: [],
    safetyBoundary: 'Observation support only.',
    status: 'active',
    generatedAt: '2026-07-21T00:00:00.000Z',
    ...overrides,
  } as LatestUc4PriorityCardSummary;
}

function snapshot(overrides: Partial<PatientRecordSnapshot> = {}): PatientRecordSnapshot {
  return {
    latestUc4PriorityCards: [],
    carePlanGoals: [],
    carePlan: null,
    medications: [],
    ...overrides,
  } as unknown as PatientRecordSnapshot;
}

function plan(overrides: Partial<AdcpPlanDocument> = {}): AdcpPlanDocument {
  return {
    carePriorities: { priorities: [] },
    ...overrides,
  } as unknown as AdcpPlanDocument;
}

describe('buildCarePriorityGroups', () => {
  it('groups live UC4 cards by category and sorts by score', () => {
    const groups = buildCarePriorityGroups(
      snapshot({
        latestUc4PriorityCards: [
          uc4Card({ cardId: 'low', score: 0.3 }),
          uc4Card({ cardId: 'high', score: 0.9 }),
          uc4Card({
            cardId: 'med',
            title: 'Track fatigue around medication timing',
            domain: 'medication_timing_context',
            score: 0.7,
          }),
        ],
      }),
      null,
    );

    expect(groups.map((g) => g.category)).toEqual(['medication', 'skin_pressure']);
    const skin = groups.find((g) => g.category === 'skin_pressure');
    expect(skin?.rows.map((r) => r.id)).toEqual(['high', 'low']);
    expect(skin?.topScore).toBe(0.9);
  });

  it('merges durable plan priorities and dedupes promoted live cards', () => {
    const groups = buildCarePriorityGroups(
      snapshot({ latestUc4PriorityCards: [uc4Card({ cardId: 'card-1' })] }),
      plan({
        carePriorities: {
          priorities: [
            {
              priorityId: 'prio-live',
              sourceCardId: 'card-1',
              title: 'Duplicate of live card',
              description: '',
              domain: 'skin_pressure_prevention_context',
              status: 'active',
              weight: 0.5,
            },
            {
              priorityId: 'prio-durable',
              title: 'Weekly bowel routine review',
              description: '',
              domain: 'bowel_bladder_hydration_context',
              status: 'active',
              weight: 0.6,
            },
            {
              priorityId: 'prio-done',
              title: 'Dismissed priority',
              description: '',
              domain: 'breathing_context',
              status: 'dismissed',
              weight: 0.9,
            },
          ],
        },
      }),
    );

    const all = groups.flatMap((g) => g.rows.map((r) => r.id));
    expect(all).toContain('card-1');
    expect(all).toContain('prio-durable');
    expect(all).not.toContain('prio-live');
    expect(all).not.toContain('prio-done');
  });

  it('returns an empty list when there is nothing to show', () => {
    expect(buildCarePriorityGroups(snapshot(), null)).toEqual([]);
  });
});

describe('buildCareTimeline', () => {
  const base = snapshot({
    latestUc4PriorityCards: [uc4Card({ cardId: 'card-1' })],
    carePlanGoals: [
      { goalId: 'g-now', description: 'Skin checks', targetDate: '2026-07-30', status: 'active' },
      { goalId: 'g-next', description: 'Increase walking minutes', targetDate: '2026-08-25', status: 'active' },
      { goalId: 'g-later', description: 'Annual equipment review', targetDate: '2026-12-01', status: 'active' },
      { goalId: 'g-ongoing', description: 'Daily hydration', targetDate: null, status: 'active' },
    ] as never,
    carePlan: {
      planId: 'plan-1',
      activities: [
        { activityId: 'a-1', planId: 'plan-1', status: 'active', description: 'Reposition every 2 hours', sequence: 0 },
        { activityId: 'a-2', planId: 'plan-1', status: 'completed', description: 'Old activity', sequence: 1 },
      ],
    } as never,
  });

  it('buckets items by horizon', () => {
    const timeline = buildCareTimeline(base, null, NOW);
    const byKey = Object.fromEntries(timeline.map((b) => [b.key, b.items.map((i) => i.id)]));

    expect(byKey.now).toContain('priority:card-1');
    expect(byKey.now).toContain('goal:g-now');
    expect(byKey.next).toEqual(['goal:g-next']);
    expect(byKey.later).toEqual(['goal:g-later']);
    expect(byKey.ongoing).toContain('goal:g-ongoing');
    expect(byKey.ongoing).toContain('activity:a-1');
    expect(byKey.ongoing).not.toContain('activity:a-2');
  });

  it('treats goals due within TIMELINE_NOW_MAX_DAYS as now', () => {
    const inWindow = new Date(NOW + (TIMELINE_NOW_MAX_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
    const timeline = buildCareTimeline(
      snapshot({
        carePlanGoals: [
          { goalId: 'g', description: 'Soon', targetDate: inWindow, status: 'active' },
        ] as never,
      }),
      null,
      NOW,
    );
    expect(timeline.find((b) => b.key === 'now')?.items.map((i) => i.id)).toContain('goal:g');
  });
});

describe('buildMedicationWatchAreas', () => {
  it('maps active medications to watch areas and skips inactive ones', () => {
    const areas = buildMedicationWatchAreas(
      snapshot({
        medications: [
          { medicationId: 'm-1', patientId: 'p', name: 'Baclofen', active: true },
          { medicationId: 'm-2', patientId: 'p', name: 'Old med', active: false },
        ] as never,
      }),
    );
    expect(areas).toHaveLength(1);
    expect(areas[0].medicationName).toBe('Baclofen');
    expect(areas[0].watchAreas).toContain('SLEEPINESS_FATIGUE');
  });
});

describe('humanizeMedicationWatchCode', () => {
  it('humanizes known codes and degrades gracefully', () => {
    expect(humanizeMedicationWatchCode('SLEEPINESS_FATIGUE')).toBe('Sleepiness or fatigue');
    expect(humanizeMedicationWatchCode('SOMETHING_NEW')).toBe('something new');
  });
});

describe('buildCarePrioritiesView', () => {
  it('combines groups, timeline, and watch areas with a total count', () => {
    const view = buildCarePrioritiesView(
      snapshot({
        latestUc4PriorityCards: [uc4Card()],
        medications: [{ medicationId: 'm-1', patientId: 'p', name: 'Keppra', active: true }] as never,
      }),
      null,
      NOW,
    );
    expect(view.totalPriorities).toBe(1);
    expect(view.groups).toHaveLength(1);
    expect(view.timeline).toHaveLength(4);
    expect(view.watchAreas).toHaveLength(1);
  });
});
