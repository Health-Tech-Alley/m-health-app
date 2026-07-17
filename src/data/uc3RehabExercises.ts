import type {
  CarePlan,
  PatientCondition,
  RehabExerciseAssignment,
  RehabExerciseAssignmentCounts,
  RehabExerciseDefinition,
  RehabExerciseKey,
  SupportedUc3ConditionGroup,
} from './types';

export const DEVELOPMENT_UC3_REHAB_EXERCISE_SOURCE = 'developer_uc3_v2' as const;

export const DEVELOPMENT_UC3_REHAB_EXERCISES: readonly RehabExerciseDefinition[] = [
  {
    key: 'supported_arm_reach',
    label: 'Supported arm reach / shoulder range-of-motion',
  },
  {
    key: 'grasp_release',
    label: 'Grasp-and-release practice',
  },
  {
    key: 'sit_to_stand',
    label: 'Sit-to-stand practice',
  },
  {
    key: 'supported_weight_shift',
    label: 'Supported weight-shifting practice',
  },
  {
    key: 'assisted_walking',
    label: 'Assisted walking practice',
  },
];

export const SUPPORTED_UC3_STROKE_REHAB_SNOMED_CODES = new Set([
  '230690007',
  '278286009',
  '22325002',
]);

const DEVELOPMENT_UC3_REHAB_EXERCISE_KEYS = new Set(
  DEVELOPMENT_UC3_REHAB_EXERCISES.map((exercise) => exercise.key),
);

export function isDevelopmentRehabExerciseKey(value: string): value is RehabExerciseKey {
  return DEVELOPMENT_UC3_REHAB_EXERCISE_KEYS.has(value as RehabExerciseKey);
}

export function normalizeUniqueDevelopmentRehabExerciseKeys(
  values: readonly string[] | undefined,
): RehabExerciseKey[] {
  const uniqueKeys = new Set<RehabExerciseKey>();
  for (const value of values ?? []) {
    if (isDevelopmentRehabExerciseKey(value)) {
      uniqueKeys.add(value);
    }
  }
  return Array.from(uniqueKeys);
}

export function mapConditionsToUc3ConditionGroup(
  conditions: readonly PatientCondition[],
): SupportedUc3ConditionGroup | null {
  const hasStrokeRehabCode = conditions.some((condition) => {
    if (condition.conditionRole === 'history_context') return false;
    const snomedCode = condition.snomedCode?.trim();
    return Boolean(snomedCode && SUPPORTED_UC3_STROKE_REHAB_SNOMED_CODES.has(snomedCode));
  });

  return hasStrokeRehabCode ? 'post_stroke_rehabilitation' : null;
}

export function isUc3DevelopmentExerciseAssignmentEligible(
  conditions: readonly PatientCondition[],
  carePlan: CarePlan | null,
): boolean {
  return Boolean(carePlan && mapConditionsToUc3ConditionGroup(conditions));
}

export function getAssignedDevelopmentRehabExercises(
  assignments: readonly Pick<RehabExerciseAssignment, 'exerciseKey' | 'active'>[],
): RehabExerciseDefinition[] {
  const activeAssignmentKeys = new Set(
    assignments
      .filter((assignment) => assignment.active)
      .map((assignment) => assignment.exerciseKey),
  );

  return DEVELOPMENT_UC3_REHAB_EXERCISES.filter((exercise) =>
    activeAssignmentKeys.has(exercise.key),
  );
}

export function filterCompletedExerciseKeysForAssignments(
  completedExerciseKeys: readonly string[] | undefined,
  assignments: readonly Pick<RehabExerciseAssignment, 'exerciseKey' | 'active'>[],
): RehabExerciseKey[] {
  const activeAssignmentKeys = new Set(
    assignments
      .filter((assignment) => assignment.active)
      .map((assignment) => assignment.exerciseKey),
  );
  const uniqueCompletedKeys = new Set<RehabExerciseKey>();

  for (const key of normalizeUniqueDevelopmentRehabExerciseKeys(completedExerciseKeys)) {
    if (activeAssignmentKeys.has(key)) {
      uniqueCompletedKeys.add(key);
    }
  }

  return Array.from(uniqueCompletedKeys);
}

export function calculateRehabExerciseAssignmentCounts(
  assignments: readonly Pick<RehabExerciseAssignment, 'exerciseKey' | 'active'>[],
  completedExerciseKeys: readonly string[] | undefined,
): RehabExerciseAssignmentCounts {
  const activeAssignmentKeys = new Set<RehabExerciseKey>();

  for (const assignment of assignments) {
    if (assignment.active && isDevelopmentRehabExerciseKey(assignment.exerciseKey)) {
      activeAssignmentKeys.add(assignment.exerciseKey);
    }
  }

  const completedKeys = filterCompletedExerciseKeysForAssignments(
    completedExerciseKeys,
    Array.from(activeAssignmentKeys).map((exerciseKey) => ({
      exerciseKey,
      active: true,
    })),
  );

  return {
    exercisesAssigned: activeAssignmentKeys.size,
    exercisesCompleted: completedKeys.length,
  };
}
