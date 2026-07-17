const { readFileSync } = require('fs');
const { join } = require('path');

import type { DailyCareEntry, PatientRecordSnapshot } from '../../data/types';
import { calculateComplexityScore } from '../../ml-models/uc3-rehab';
import { adaptPatientRecordSnapshotToUC3Input } from './uc3PatientStateAdapter';

const NOW = new Date('2026-07-16T12:00:00.000Z');

function dailyEntry(overrides: Partial<DailyCareEntry> = {}): DailyCareEntry {
  return {
    entryId: `entry-${overrides.entryDate ?? '2026-07-01'}`,
    patientId: 'patient-uc3',
    carePlanId: 'careplan-uc3',
    entryDate: '2026-07-01',
    therapyCompleted: true,
    setsCompleted: 0,
    recommendedSets: 0,
    exerciseRepetitions: 8,
    romDegrees: 42,
    walkingMinutes: 5,
    painScore: 4,
    fatigue: 3,
    assignedExerciseKeys: ['supported_arm_reach'],
    completedExerciseKeys: ['supported_arm_reach'],
    caregiverConcern: false,
    symptoms: [],
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-01T09:05:00.000Z',
    ...overrides,
  };
}

function snapshot(overrides: Partial<PatientRecordSnapshot> = {}): PatientRecordSnapshot {
  const condition = {
    conditionId: 'condition-uc3',
    patientId: 'patient-uc3',
    name: 'Documented rehabilitation need',
    snomedCode: '230690007',
    conditionRole: 'primary_diagnosis' as const,
  };

  return {
    patient: {
      patientId: 'patient-uc3',
      name: 'James-shaped Sample',
      preferredName: 'Sample',
      age: '67',
      location: 'Allegheny County, PA',
      baselineDailyRoutine: 'Limited walking endurance after discharge.',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    safetyNotes: 'Fall risk during transfers.',
    caregiver: {
      caregiverId: 'caregiver-uc3',
      patientId: 'patient-uc3',
      name: 'Maya',
      relationship: 'daughter',
      availability: 'daily',
      medicalComfortLevel: 'comfortable',
      mainConcern: 'Balance and fall risk.',
      createdAt: '2026-07-01T00:00:00.000Z',
    },
    conditions: [condition],
    comorbidities: [],
    primaryCondition: condition,
    pendingReviewConditions: [],
    symptoms: [],
    wearable: {
      deviceId: 'watch-uc3',
      patientId: 'patient-uc3',
      deviceType: 'Apple Watch',
      connected: true,
      baselineStatus: 'connected',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    medications: [],
    medicationCandidates: [],
    medicationConfirmationRequirements: {},
    functionalObservations: [
      {
        patientId: 'patient-uc3',
        observationId: 'obs-mobility',
        measurementType: 'mobility_assistance_level',
        recordedAt: '2026-07-01T00:00:00.000Z',
        textValue: 'Requires caregiver assistance for transfers.',
        sourceCode: 'mobility',
        sourceType: 'fhir',
      },
    ],
    thresholds: [],
    carePlan: {
      planId: 'careplan-uc3',
      patientId: 'patient-uc3',
      version: 1,
      effectiveDate: '2026-07-01',
      status: 'active',
      intent: 'plan',
      title: 'Home rehabilitation',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-28',
      safetyNotes: 'Stop for urgent symptoms.',
      createdAt: '2026-07-01T00:00:00.000Z',
      activities: [
        {
          activityId: 'activity-uc3',
          planId: 'careplan-uc3',
          status: 'in-progress',
          description: 'Practice supported arm reach.',
          sequence: 0,
        },
      ],
    },
    carePlans: [],
    rehabPlanMetrics: [
      {
        id: 'metric-rom',
        patientId: 'patient-uc3',
        carePlanId: 'careplan-uc3',
        metricKey: 'romDegrees',
        displayName: 'Shoulder ROM',
        baselineValue: 40,
        targetValue: 70,
        unit: 'degrees',
        durationDays: 28,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'metric-pain',
        patientId: 'patient-uc3',
        carePlanId: 'careplan-uc3',
        metricKey: 'painScore',
        displayName: 'Pain',
        baselineValue: 5,
        targetValue: 2,
        unit: '0-10',
        durationDays: 28,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    rehabExerciseAssignments: [],
    todayDailyCareEntry: null,
    rehabDailyEntries: [dailyEntry()],
    careContextItems: [
      {
        itemId: 'context-mobility',
        patientId: 'patient-uc3',
        contextCategory: 'mobility',
        plainTitle: 'Home mobility',
        factualSummary: 'Uses a walker and caregiver support.',
        sourceExcerpt: 'Uses walker.',
        sourceDocument: 'summary',
        sourceSection: 'care',
        handling: [],
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    timelineEvents: [
      {
        eventId: 'timeline-discharge',
        patientId: 'patient-uc3',
        eventType: 'discharge_restrictions',
        title: 'Discharge',
        summary: 'Home therapy with caregiver support.',
        visitIndex: 1,
        daysFromFirstVisit: 0,
        daysBeforeLatestVisit: 0,
        sourceFile: 'summary',
        sourceSection: 'discharge',
        confidence: 'high',
        clinicalRelevance: 'rehab',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    carePlanGoals: [
      {
        goalId: 'goal-uc3',
        description: 'Improve functional range of motion.',
        status: 'active',
      },
    ],
    knowledgeStats: { total: 0, bySource: {} },
    enrichmentStats: { total: 0, bySource: {} },
    bundlePending: false,
    bundleStatus: { state: 'complete', chunksAdded: 0 },
    lastRefreshedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function readyInput(input: PatientRecordSnapshot) {
  const result = adaptPatientRecordSnapshotToUC3Input(input, NOW);
  expect(result.status).toBe('ready');
  return result.status === 'ready' ? result : null;
}

describe('adaptPatientRecordSnapshotToUC3Input', () => {
  it('maps a generic James-shaped snapshot without identity branching', () => {
    const result = readyInput(snapshot());

    expect(result?.input.patient.patientId).toBe('patient-uc3');
    expect(result?.input.patient.displayName).toBe('Sample');
    expect(result?.input.plan.planId).toBe('careplan-uc3');
    expect(result?.input.logs).toHaveLength(1);
  });

  it('derives condition group from SNOMED and uses Jay complexity scoring', () => {
    const result = readyInput(snapshot());
    const ehrContext = result!.input.ehrContext;

    expect(ehrContext.conditionGroup).toBe('post_stroke_rehabilitation');
    expect(ehrContext.complexityMetadata).toEqual(calculateComplexityScore(ehrContext));
  });

  it('uses Jay plan direction and each historical date stored assignments for counts', () => {
    const result = readyInput(
      snapshot({
        rehabDailyEntries: [
          dailyEntry({
            entryDate: '2026-07-01',
            assignedExerciseKeys: ['supported_arm_reach', 'supported_arm_reach', 'sit_to_stand'],
            completedExerciseKeys: [
              'supported_arm_reach',
              'supported_arm_reach',
              'sit_to_stand',
            ],
          }),
          dailyEntry({
            entryDate: '2026-07-02',
            assignedExerciseKeys: ['supported_arm_reach'],
            completedExerciseKeys: ['supported_arm_reach', 'supported_arm_reach', 'sit_to_stand'],
          }),
        ],
      }),
    );

    expect(result?.input.plan.metrics.romDegrees.higherIsBetter).toBe(true);
    expect(result?.input.plan.metrics.painScore.higherIsBetter).toBe(false);
    expect(result?.input.logs.map((log) => [log.date, log.exercisesAssigned, log.exercisesCompleted])).toEqual([
      ['2026-07-01', 2, 2],
      ['2026-07-02', 1, 1],
    ]);
  });

  it('warns and omits exercise counts for an older entry without assigned keys', () => {
    const legacyEntry = dailyEntry({ entryDate: '2026-07-01' });
    delete legacyEntry.assignedExerciseKeys;
    const result = readyInput(snapshot({ rehabDailyEntries: [legacyEntry] }));

    expect(result?.input.logs[0].exercisesAssigned).toBeUndefined();
    expect(result?.input.logs[0].exercisesCompleted).toBeUndefined();
    expect(result?.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'missing_daily_assigned_exercises' })]),
    );
  });

  it('maps painScore, skippedReason, and urgent symptom codes without legacy pain fields', () => {
    const result = readyInput(
      snapshot({
        rehabDailyEntries: [
          dailyEntry({
            painScore: 3,
            painBefore: 9,
            painAfter: 8,
            therapyCompleted: false,
            skippedReason: 'fever',
            symptoms: ['new_weakness', 'chest_pain'],
          }),
        ],
      }),
    );
    const log = result!.input.logs[0] as Record<string, unknown>;

    expect(log.painScore).toBe(3);
    expect(log.painBefore).toBeUndefined();
    expect(log.painAfter).toBeUndefined();
    expect(log.skippedReason).toBe('fever');
    expect(log.symptoms).toEqual(['new_weakness', 'chest_pain']);
  });

  it('keeps short history adapter-ready', () => {
    expect(readyInput(snapshot({ rehabDailyEntries: [] }))?.status).toBe('ready');
  });

  it('returns not_ready only for structural blockers', () => {
    const cases: PatientRecordSnapshot[] = [
      snapshot({ patient: null }),
      snapshot({ carePlan: null, rehabPlanMetrics: [] }),
      snapshot({
        conditions: [{ ...snapshot().conditions[0], snomedCode: undefined }],
        primaryCondition: null,
      }),
      snapshot({ rehabPlanMetrics: [] }),
      snapshot({
        carePlan: {
          ...snapshot().carePlan!,
          periodStart: '2026-07-28',
          periodEnd: '2026-07-01',
        },
      }),
    ];

    expect(cases.map((item) => adaptPatientRecordSnapshotToUC3Input(item, NOW).status)).toEqual([
      'not_ready',
      'not_ready',
      'not_ready',
      'not_ready',
      'not_ready',
    ]);
  });

  it('does not access disallowed data paths or fixture-specific branches', () => {
    const source = readFileSync(join(__dirname, 'uc3PatientStateAdapter.ts'), 'utf8');

    expect(source).not.toMatch(/\b(sql|sqlite|repository|repositories|redux|fhir|fixture)\b/i);
    expect(source).not.toMatch(/from ['"].*(app|tsx|json)['"]/i);
    expect(source).not.toMatch(/James|Diane|patient-james|fixture date/i);
    expect(source).not.toMatch(/higherIsBetter|normalizeUniqueDevelopmentRehabExerciseKeys/);
  });
});
