import type { CarePlan, DailyCareEntry, PatientCondition } from './types';

type AssignmentRow = {
  patient_id: string;
  care_plan_id: string;
  exercise_key: string;
  active: number;
  source: string;
  created_at: string;
  updated_at: string;
};

type DailyCareRow = {
  entry_id: string;
  patient_id: string;
  care_plan_id?: string | null;
  entry_date: string;
  therapy_day?: number | null;
  logged_by_user_id?: string | null;
  logged_by_role?: string | null;
  therapy_completed: number;
  sets_completed: number;
  recommended_sets: number;
  pain_score?: number | null;
  pain_before?: number | null;
  pain_after?: number | null;
  fatigue?: number | null;
  skipped_reason?: string | null;
  assistance_required?: string | null;
  caregiver_concern: number;
  functional_task_score?: number | null;
  guided_movement_score?: number | null;
  notes?: string | null;
  exercise_repetitions?: number | null;
  rom_degrees?: number | null;
  walking_minutes?: number | null;
  symptoms_json: string;
  assigned_exercise_keys_json: string;
  completed_exercise_keys_json: string;
  created_at: string;
  updated_at: string;
};

const mockState = {
  assignments: [] as AssignmentRow[],
  dailyCareEntries: [] as DailyCareRow[],
  carePlanActivities: [
    {
      activity_id: 'provider-activity-1',
      plan_id: 'careplan-stroke',
      description: 'Imported provider activity',
    },
  ],
};

function toDailyCareEntryRow(row: DailyCareRow) {
  return {
    entryId: row.entry_id,
    patientId: row.patient_id,
    carePlanId: row.care_plan_id,
    entryDate: row.entry_date,
    therapyDay: row.therapy_day,
    loggedByUserId: row.logged_by_user_id,
    loggedByRole: row.logged_by_role,
    therapyCompleted: row.therapy_completed,
    setsCompleted: row.sets_completed,
    recommendedSets: row.recommended_sets,
    painScore: row.pain_score,
    painBefore: row.pain_before,
    painAfter: row.pain_after,
    fatigue: row.fatigue,
    skippedReason: row.skipped_reason,
    assistanceRequired: row.assistance_required,
    caregiverConcern: row.caregiver_concern,
    functionalTaskScore: row.functional_task_score,
    guidedMovementScore: row.guided_movement_score,
    notes: row.notes,
    exerciseRepetitions: row.exercise_repetitions,
    romDegrees: row.rom_degrees,
    walkingMinutes: row.walking_minutes,
    symptomsJson: row.symptoms_json,
    assignedExerciseKeysJson: row.assigned_exercise_keys_json,
    completedExerciseKeysJson: row.completed_exercise_keys_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAssignmentRow(row: AssignmentRow) {
  return {
    patientId: row.patient_id,
    carePlanId: row.care_plan_id,
    exerciseKey: row.exercise_key,
    active: row.active,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const mockDb = {
  runSync: jest.fn((sql: string, ...args: unknown[]) => {
    if (sql.includes('INSERT INTO rehab_exercise_assignments')) {
      const [patientId, carePlanId, exerciseKey, active, source, createdAt, updatedAt] = args;
      const existing = mockState.assignments.find(
        (row) =>
          row.patient_id === patientId &&
          row.care_plan_id === carePlanId &&
          row.exercise_key === exerciseKey,
      );
      if (existing) {
        existing.active = Number(active);
        existing.source = String(source);
        existing.updated_at = String(updatedAt);
        return;
      }
      mockState.assignments.push({
        patient_id: String(patientId),
        care_plan_id: String(carePlanId),
        exercise_key: String(exerciseKey),
        active: Number(active),
        source: String(source),
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      });
      return;
    }

    if (sql.includes('INSERT OR REPLACE INTO daily_care_entries')) {
      const [
        entryId,
        patientId,
        carePlanId,
        entryDate,
        therapyDay,
        loggedByUserId,
        loggedByRole,
        therapyCompleted,
        setsCompleted,
        recommendedSets,
        painScore,
        painBefore,
        painAfter,
        fatigue,
        skippedReason,
        assistanceRequired,
        caregiverConcern,
        functionalTaskScore,
        guidedMovementScore,
        notes,
        exerciseRepetitions,
        romDegrees,
        walkingMinutes,
        symptomsJson,
        assignedExerciseKeysJson,
        completedExerciseKeysJson,
        createdAt,
        updatedAt,
      ] = args;
      const existingIndex = mockState.dailyCareEntries.findIndex(
        (row) => row.patient_id === patientId && row.entry_date === entryDate,
      );
      const nextRow: DailyCareRow = {
        entry_id: String(entryId),
        patient_id: String(patientId),
        care_plan_id: carePlanId ? String(carePlanId) : null,
        entry_date: String(entryDate),
        therapy_day: therapyDay === null ? null : Number(therapyDay),
        logged_by_user_id: loggedByUserId ? String(loggedByUserId) : null,
        logged_by_role: loggedByRole ? String(loggedByRole) : null,
        therapy_completed: Number(therapyCompleted),
        sets_completed: Number(setsCompleted),
        recommended_sets: Number(recommendedSets),
        pain_score: painScore === null ? null : Number(painScore),
        pain_before: painBefore === null ? null : Number(painBefore),
        pain_after: painAfter === null ? null : Number(painAfter),
        fatigue: fatigue === null ? null : Number(fatigue),
        skipped_reason: skippedReason ? String(skippedReason) : null,
        assistance_required: assistanceRequired ? String(assistanceRequired) : null,
        caregiver_concern: Number(caregiverConcern),
        functional_task_score: functionalTaskScore === null ? null : Number(functionalTaskScore),
        guided_movement_score: guidedMovementScore === null ? null : Number(guidedMovementScore),
        notes: notes ? String(notes) : null,
        exercise_repetitions: exerciseRepetitions === null ? null : Number(exerciseRepetitions),
        rom_degrees: romDegrees === null ? null : Number(romDegrees),
        walking_minutes: walkingMinutes === null ? null : Number(walkingMinutes),
        symptoms_json: String(symptomsJson),
        assigned_exercise_keys_json: String(assignedExerciseKeysJson),
        completed_exercise_keys_json: String(completedExerciseKeysJson),
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      };
      if (existingIndex >= 0) {
        mockState.dailyCareEntries[existingIndex] = nextRow;
      } else {
        mockState.dailyCareEntries.push(nextRow);
      }
      return;
    }

    if (sql.includes('UPDATE daily_care_entries')) {
      const updatesAssignedKeys = sql.includes('assigned_exercise_keys_json = ?');
      const updatesCompletedKeys = sql.includes('completed_exercise_keys_json = ?');
      const entryId = args[args.length - 1];
      const existing = mockState.dailyCareEntries.find((row) => row.entry_id === entryId);
      if (existing) {
        if (updatesAssignedKeys) {
          existing.assigned_exercise_keys_json = String(args[0]);
        }
        if (updatesCompletedKeys) {
          existing.completed_exercise_keys_json = String(args[updatesAssignedKeys ? 1 : 0]);
        }
        existing.updated_at = String(args[args.length - 2]);
      }
    }
  }),
  getAllSync: jest.fn((sql: string, ...args: unknown[]) => {
    if (sql.includes('FROM rehab_exercise_assignments')) {
      const [patientId, carePlanId] = args;
      return mockState.assignments
        .filter(
          (row) =>
            row.patient_id === patientId &&
            row.care_plan_id === carePlanId &&
            row.active === 1,
        )
        .sort((a, b) => a.exercise_key.localeCompare(b.exercise_key))
        .map(toAssignmentRow);
    }

    if (
      sql.includes('completed_exercise_keys_json AS completedExerciseKeysJson') &&
      !sql.includes('entry_date AS entryDate')
    ) {
      const [patientId, carePlanId, entryDate] = args;
      return mockState.dailyCareEntries
        .filter(
          (row) =>
            row.patient_id === patientId &&
            row.care_plan_id === carePlanId &&
            (!entryDate || row.entry_date === entryDate),
        )
        .map((row) => ({
          entryId: row.entry_id,
          completedExerciseKeysJson: row.completed_exercise_keys_json,
        }));
    }

    if (sql.includes('FROM daily_care_entries')) {
      const [patientId, sinceOrUntil, maybeUntil] = args;
      const hasSince = sql.includes('entry_date >= ?');
      const since = hasSince ? String(sinceOrUntil) : undefined;
      const until = hasSince ? String(maybeUntil) : String(sinceOrUntil);
      return mockState.dailyCareEntries
        .filter((row) => {
          if (row.patient_id !== patientId) return false;
          if (since && row.entry_date < since) return false;
          return row.entry_date <= until;
        })
        .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
        .map(toDailyCareEntryRow);
    }

    return [];
  }),
  getFirstSync: jest.fn((sql: string, ...args: unknown[]) => {
    if (sql.includes('FROM daily_care_entries')) {
      const [patientId, entryDate] = args;
      const row = mockState.dailyCareEntries.find(
        (entry) => entry.patient_id === patientId && entry.entry_date === entryDate,
      );
      return row ? toDailyCareEntryRow(row) : null;
    }
    return null;
  }),
};

jest.mock('./db', () => ({
  getDatabase: () => mockDb,
}));

beforeAll(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

import {
  getDailyCareEntries,
  getDailyCareEntry,
  upsertDailyCareEntry,
} from './repositories/dailyCareEntryRepository';
import {
  getRehabExerciseAssignments,
  replaceRehabExerciseAssignments,
  seedDevelopmentRehabExercisesIfEligible,
} from './repositories/rehabExerciseAssignmentRepository';
import {
  calculateRehabExerciseAssignmentCounts,
  filterCompletedExerciseKeysForAssignments,
  getAssignedDevelopmentRehabExercises,
  isUc3DevelopmentExerciseAssignmentEligible,
  mapConditionsToUc3ConditionGroup,
} from './uc3RehabExercises';

const activeCarePlan: CarePlan = {
  planId: 'careplan-stroke',
  patientId: 'patient-stroke',
  version: 1,
  effectiveDate: '2026-07-01',
  status: 'active',
  intent: 'plan',
  createdAt: '2026-07-01T00:00:00.000Z',
  activities: [
    {
      activityId: 'provider-activity-1',
      planId: 'careplan-stroke',
      status: 'in-progress',
      description: 'Imported provider activity',
      sequence: 0,
    },
  ],
};

const strokeConditions: PatientCondition[] = [
  {
    conditionId: 'condition-stroke',
    patientId: 'patient-stroke',
    name: 'Cerebrovascular accident',
    snomedCode: '230690007',
    conditionRole: 'primary_diagnosis',
  },
];

beforeEach(() => {
  mockDb.runSync.mockClear();
  mockDb.getAllSync.mockClear();
  mockDb.getFirstSync.mockClear();
  mockState.assignments = [];
  mockState.dailyCareEntries = [];
  mockState.carePlanActivities = [
    {
      activity_id: 'provider-activity-1',
      plan_id: 'careplan-stroke',
      description: 'Imported provider activity',
    },
  ];
});

describe('UC3 development rehab exercise assignment path', () => {
  it('persists Advanced Developer Settings assignment changes for the active patient and CarePlan', () => {
    replaceRehabExerciseAssignments({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      exerciseKeys: ['supported_arm_reach', 'sit_to_stand'],
    });

    expect(getRehabExerciseAssignments('patient-stroke', 'careplan-stroke')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseKey: 'sit_to_stand',
          source: 'developer_uc3_v2',
          active: true,
        }),
        expect.objectContaining({
          exerciseKey: 'supported_arm_reach',
          source: 'developer_uc3_v2',
          active: true,
        }),
      ]),
    );

    replaceRehabExerciseAssignments({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      exerciseKeys: ['grasp_release'],
    });

    expect(getRehabExerciseAssignments('patient-stroke', 'careplan-stroke')).toEqual([
      expect.objectContaining({
        exerciseKey: 'grasp_release',
        source: 'developer_uc3_v2',
        active: true,
      }),
    ]);
  });

  it('does not expose assignments to another patient', () => {
    replaceRehabExerciseAssignments({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      exerciseKeys: ['supported_arm_reach'],
    });

    expect(getRehabExerciseAssignments('other-patient', 'careplan-stroke')).toEqual([]);
  });

  it('keeps assignments isolated by CarePlan', () => {
    replaceRehabExerciseAssignments({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      exerciseKeys: ['supported_arm_reach'],
    });
    replaceRehabExerciseAssignments({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-second',
      exerciseKeys: ['assisted_walking'],
    });

    expect(getRehabExerciseAssignments('patient-stroke', 'careplan-stroke')).toEqual([
      expect.objectContaining({ exerciseKey: 'supported_arm_reach' }),
    ]);
    expect(getRehabExerciseAssignments('patient-stroke', 'careplan-second')).toEqual([
      expect.objectContaining({ exerciseKey: 'assisted_walking' }),
    ]);
  });

  it('exposes only assigned exercises for the Care daily completion UI', () => {
    const assignments = replaceRehabExerciseAssignments({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      exerciseKeys: ['sit_to_stand', 'assisted_walking'],
    });

    expect(getAssignedDevelopmentRehabExercises(assignments).map((exercise) => exercise.key)).toEqual([
      'sit_to_stand',
      'assisted_walking',
    ]);
  });

  it('keeps imported provider CarePlan activities unchanged', () => {
    const originalActivities = JSON.stringify(mockState.carePlanActivities);

    replaceRehabExerciseAssignments({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      exerciseKeys: ['supported_arm_reach'],
    });

    expect(JSON.stringify(mockState.carePlanActivities)).toBe(originalActivities);
    expect(
      mockDb.runSync.mock.calls.some((call) => String(call[0]).includes('care_plan_activities')),
    ).toBe(false);
  });

  it('saves and reloads completed keys through the daily repository', () => {
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      assignedExerciseKeys: ['supported_arm_reach', 'sit_to_stand'],
      completedExerciseKeys: ['supported_arm_reach', 'sit_to_stand'],
    });

    expect(getDailyCareEntry('patient-stroke', '2026-07-16')).toEqual(
      expect.objectContaining({
        assignedExerciseKeys: ['supported_arm_reach', 'sit_to_stand'],
        completedExerciseKeys: ['supported_arm_reach', 'sit_to_stand'],
      }),
    );
  });

  it('deduplicates assigned keys and prunes completed keys to that entry assignment', () => {
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      assignedExerciseKeys: ['supported_arm_reach', 'supported_arm_reach'],
      completedExerciseKeys: ['supported_arm_reach', 'sit_to_stand'],
    });

    expect(getDailyCareEntry('patient-stroke', '2026-07-16')).toEqual(
      expect.objectContaining({
        assignedExerciseKeys: ['supported_arm_reach'],
        completedExerciseKeys: ['supported_arm_reach'],
      }),
    );
  });

  it('does not carry completions into the next date', () => {
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      completedExerciseKeys: ['supported_arm_reach'],
    });
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-17',
    });

    expect(getDailyCareEntry('patient-stroke', '2026-07-17')?.completedExerciseKeys).toEqual([]);
  });

  it('ignores unassigned and unknown completed keys', () => {
    const assignments = replaceRehabExerciseAssignments({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      exerciseKeys: ['supported_arm_reach'],
    });

    expect(
      filterCompletedExerciseKeysForAssignments(
        ['supported_arm_reach', 'sit_to_stand', 'unknown_key'],
        assignments,
      ),
    ).toEqual(['supported_arm_reach']);
  });

  it('maps assigned and completed counts without repetitions, sets, session or minutes', () => {
    const assignments = replaceRehabExerciseAssignments({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      exerciseKeys: ['supported_arm_reach', 'sit_to_stand'],
    });

    expect(
      calculateRehabExerciseAssignmentCounts(assignments, [
        'supported_arm_reach',
        'supported_arm_reach',
        'unknown_key',
      ]),
    ).toEqual({
      exercisesAssigned: 2,
      exercisesCompleted: 1,
    });
  });

  it('preserves zero completed exercises', () => {
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      completedExerciseKeys: [],
    });

    const entry = getDailyCareEntry('patient-stroke', '2026-07-16') as DailyCareEntry;
    expect(entry.completedExerciseKeys).toEqual([]);
  });

  it('updates only today when assignments are replaced', () => {
    replaceRehabExerciseAssignments({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      exerciseKeys: ['supported_arm_reach', 'sit_to_stand'],
    });
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-15',
      assignedExerciseKeys: ['supported_arm_reach', 'sit_to_stand'],
      completedExerciseKeys: ['supported_arm_reach', 'sit_to_stand'],
    });
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      assignedExerciseKeys: ['supported_arm_reach', 'sit_to_stand'],
      completedExerciseKeys: ['supported_arm_reach', 'sit_to_stand'],
    });

    replaceRehabExerciseAssignments({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      exerciseKeys: ['supported_arm_reach'],
    });

    expect(getDailyCareEntry('patient-stroke', '2026-07-15')).toEqual(
      expect.objectContaining({
        assignedExerciseKeys: ['supported_arm_reach', 'sit_to_stand'],
        completedExerciseKeys: ['supported_arm_reach', 'sit_to_stand'],
      }),
    );
    expect(getDailyCareEntry('patient-stroke', '2026-07-16')).toEqual(
      expect.objectContaining({
        assignedExerciseKeys: ['supported_arm_reach'],
        completedExerciseKeys: ['supported_arm_reach'],
      }),
    );
  });

  it('patient switching replaces assignment visibility', () => {
    replaceRehabExerciseAssignments({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      exerciseKeys: ['supported_arm_reach'],
    });
    replaceRehabExerciseAssignments({
      patientId: 'patient-two',
      carePlanId: 'careplan-stroke',
      exerciseKeys: ['assisted_walking'],
    });

    expect(getRehabExerciseAssignments('patient-stroke', 'careplan-stroke')).toEqual([
      expect.objectContaining({ exerciseKey: 'supported_arm_reach' }),
    ]);
    expect(getRehabExerciseAssignments('patient-two', 'careplan-stroke')).toEqual([
      expect.objectContaining({ exerciseKey: 'assisted_walking' }),
    ]);
  });

  it('loads date-scoped completions through rehab daily entries', () => {
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      assignedExerciseKeys: ['supported_arm_reach'],
      completedExerciseKeys: ['supported_arm_reach'],
    });

    expect(
      getDailyCareEntries('patient-stroke', {
        since: '2026-07-16',
        until: '2026-07-16',
      })[0],
    ).toEqual(
      expect.objectContaining({
        assignedExerciseKeys: ['supported_arm_reach'],
        completedExerciseKeys: ['supported_arm_reach'],
      }),
    );
  });

  it('saves and reloads pain score without using legacy before or after pain values', () => {
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      painScore: 6,
    });

    expect(getDailyCareEntry('patient-stroke', '2026-07-16')).toEqual(
      expect.objectContaining({
        painScore: 6,
        painBefore: null,
        painAfter: null,
      }),
    );

    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-17',
      painBefore: 2,
      painAfter: 7,
    });

    expect(getDailyCareEntry('patient-stroke', '2026-07-17')).toEqual(
      expect.objectContaining({
        painScore: null,
        painBefore: 2,
        painAfter: 7,
      }),
    );
  });

  it('preserves intentional zero pain score', () => {
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      painScore: 0,
    });

    expect(getDailyCareEntry('patient-stroke', '2026-07-16')?.painScore).toBe(0);
  });

  it('stores skipped reason only for incomplete sessions and clears it when completed', () => {
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      therapyCompleted: true,
      skippedReason: 'fever',
    });

    expect(getDailyCareEntry('patient-stroke', '2026-07-16')?.skippedReason).toBeNull();

    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      therapyCompleted: false,
      skippedReason: 'fever',
    });

    expect(getDailyCareEntry('patient-stroke', '2026-07-16')?.skippedReason).toBe('fever');

    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      therapyCompleted: true,
    });

    expect(getDailyCareEntry('patient-stroke', '2026-07-16')?.skippedReason).toBeNull();
  });

  it('does not inherit skipped reason into the next date', () => {
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      therapyCompleted: false,
      skippedReason: 'clinician told us to stop',
    });
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-17',
    });

    expect(getDailyCareEntry('patient-stroke', '2026-07-17')?.skippedReason).toBeNull();
  });

  it('stores exact urgent symptom codes while preserving nonurgent symptoms', () => {
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      symptoms: [
        'mild stiffness',
        'new_weakness',
        'new_weakness',
        'chest_pain',
        'mild stiffness',
      ],
    });

    expect(getDailyCareEntry('patient-stroke', '2026-07-16')?.symptoms).toEqual([
      'mild stiffness',
      'new_weakness',
      'chest_pain',
    ]);
  });

  it('does not inherit urgent symptoms into the next date', () => {
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      symptoms: ['new_weakness', 'severe_pain'],
    });
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-17',
    });

    expect(getDailyCareEntry('patient-stroke', '2026-07-17')?.symptoms).toEqual([]);
  });

  it('keeps daily pain, skipped reason, and symptoms isolated by patient', () => {
    upsertDailyCareEntry({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      painScore: 4,
      skippedReason: 'urgent',
      symptoms: ['confusion'],
    });
    upsertDailyCareEntry({
      patientId: 'patient-two',
      carePlanId: 'careplan-stroke',
      entryDate: '2026-07-16',
      painScore: 1,
      symptoms: ['mild stiffness'],
    });

    expect(getDailyCareEntry('patient-stroke', '2026-07-16')).toEqual(
      expect.objectContaining({
        painScore: 4,
        skippedReason: 'urgent',
        symptoms: ['confusion'],
      }),
    );
    expect(getDailyCareEntry('patient-two', '2026-07-16')).toEqual(
      expect.objectContaining({
        painScore: 1,
        skippedReason: null,
        symptoms: ['mild stiffness'],
      }),
    );
  });

  it('uses SNOMED condition codes for eligibility and never patient identity', () => {
    expect(mapConditionsToUc3ConditionGroup(strokeConditions)).toBe('post_stroke_rehabilitation');
    expect(isUc3DevelopmentExerciseAssignmentEligible(strokeConditions, activeCarePlan)).toBe(true);
    expect(
      isUc3DevelopmentExerciseAssignmentEligible(
        [
          {
            conditionId: 'condition-name-only',
            patientId: 'patient-stroke',
            name: 'Cerebrovascular accident',
            conditionRole: 'primary_diagnosis',
          },
        ],
        activeCarePlan,
      ),
    ).toBe(false);
    expect(
      isUc3DevelopmentExerciseAssignmentEligible(
        [{ ...strokeConditions[0], patientId: 'unrelated-patient' }],
        activeCarePlan,
      ),
    ).toBe(true);
  });
});

describe('seedDevelopmentRehabExercisesIfEligible', () => {
  it('assigns all development exercises for a post-stroke persona', () => {
    const seeded = seedDevelopmentRehabExercisesIfEligible({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      conditions: strokeConditions,
    });

    expect(seeded).toBe(true);
    const assignments = getRehabExerciseAssignments('patient-stroke', 'careplan-stroke');
    expect(assignments).toHaveLength(5);
    expect(assignments.every((a) => a.active)).toBe(true);
    expect(assignments.every((a) => a.source === 'seed:fhir_import')).toBe(true);
    expect(assignments.map((a) => a.exerciseKey)).toEqual(
      expect.arrayContaining([
        'supported_arm_reach',
        'grasp_release',
        'sit_to_stand',
        'supported_weight_shift',
        'assisted_walking',
      ]),
    );
  });

  it('is a no-op for non-UC3 personas (e.g. cerebral palsy)', () => {
    const cpConditions: PatientCondition[] = [
      {
        conditionId: 'condition-cp',
        patientId: 'patient-cp',
        name: 'Cerebral palsy',
        snomedCode: '8845000',
        conditionRole: 'primary_diagnosis',
      },
    ];

    const seeded = seedDevelopmentRehabExercisesIfEligible({
      patientId: 'patient-cp',
      carePlanId: 'careplan-cp',
      conditions: cpConditions,
    });

    expect(seeded).toBe(false);
    expect(getRehabExerciseAssignments('patient-cp', 'careplan-cp')).toEqual([]);
  });

  it('is a no-op when conditions lack a SNOMED code', () => {
    const seeded = seedDevelopmentRehabExercisesIfEligible({
      patientId: 'patient-stroke',
      carePlanId: 'careplan-stroke',
      conditions: [{ ...strokeConditions[0], snomedCode: undefined }],
    });

    expect(seeded).toBe(false);
    expect(getRehabExerciseAssignments('patient-stroke', 'careplan-stroke')).toEqual([]);
  });
});
