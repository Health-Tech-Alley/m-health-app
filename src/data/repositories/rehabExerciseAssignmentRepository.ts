import { getDatabase } from '../db';
import type { RehabExerciseAssignment, RehabExerciseKey } from '../types';
import {
  DEVELOPMENT_UC3_REHAB_EXERCISE_SOURCE,
  DEVELOPMENT_UC3_REHAB_EXERCISES,
  normalizeUniqueDevelopmentRehabExerciseKeys,
} from '../uc3RehabExercises';
import { clearUnassignedCompletedExerciseKeys } from './dailyCareEntryRepository';

type RehabExerciseAssignmentRow = {
  patientId: string;
  carePlanId: string;
  exerciseKey: RehabExerciseKey;
  active: number | boolean;
  source: RehabExerciseAssignment['source'];
  createdAt: string;
  updatedAt: string;
};

export function getRehabExerciseAssignments(
  patientId: string,
  carePlanId: string,
): RehabExerciseAssignment[] {
  const db = getDatabase();
  const rows = db.getAllSync<RehabExerciseAssignmentRow>(
    `SELECT patient_id AS patientId,
            care_plan_id AS carePlanId,
            exercise_key AS exerciseKey,
            active,
            source,
            created_at AS createdAt,
            updated_at AS updatedAt
     FROM rehab_exercise_assignments
     WHERE patient_id = ?
       AND care_plan_id = ?
       AND active = 1
     ORDER BY exercise_key ASC;`,
    patientId,
    carePlanId,
  );

  return rows.map((row) => ({
    ...row,
    active: Boolean(row.active),
  }));
}

export function replaceRehabExerciseAssignments(input: {
  patientId: string;
  carePlanId: string;
  exerciseKeys: readonly string[];
  source?: RehabExerciseAssignment['source'];
}): RehabExerciseAssignment[] {
  const db = getDatabase();
  const now = new Date().toISOString();
  const activeKeys = normalizeUniqueDevelopmentRehabExerciseKeys(input.exerciseKeys);
  const activeKeySet = new Set(activeKeys);
  const source = input.source ?? DEVELOPMENT_UC3_REHAB_EXERCISE_SOURCE;

  for (const exercise of DEVELOPMENT_UC3_REHAB_EXERCISES) {
    const active = activeKeySet.has(exercise.key);
    db.runSync(
      `INSERT INTO rehab_exercise_assignments (
         patient_id, care_plan_id, exercise_key, active, source, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(patient_id, care_plan_id, exercise_key) DO UPDATE SET
         active = excluded.active,
         source = excluded.source,
         updated_at = excluded.updated_at;`,
      input.patientId,
      input.carePlanId,
      exercise.key,
      active ? 1 : 0,
      source,
      now,
      now,
    );
  }

  clearUnassignedCompletedExerciseKeys(input.patientId, input.carePlanId, activeKeys);

  return getRehabExerciseAssignments(input.patientId, input.carePlanId);
}
