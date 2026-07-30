/**
 * Repository for daily_care_entries — the per-day therapy log editable from
 * the Care screen (pain before/after, fatigue, sets, notes, etc.).
 *
 * One row per patient per date (enforced by a unique index). Upsert on save.
 */

import { getDatabase } from '../db';
import type { DailyCareEntry } from '../types';
import {
  filterCompletedExerciseKeysForAssignments,
  normalizeUniqueDevelopmentRehabExerciseKeys,
} from '../uc3RehabExercises';

type DailyCareEntryRow = Omit<
  DailyCareEntry,
  | 'exerciseRepetitions'
  | 'romDegrees'
  | 'walkingMinutes'
  | 'painScore'
  | 'painBefore'
  | 'painAfter'
  | 'fatigue'
  | 'skippedReason'
  | 'functionalTaskScore'
  | 'guidedMovementScore'
  | 'symptoms'
  | 'assignedExerciseKeys'
  | 'completedExerciseKeys'
> & {
  exerciseRepetitions?: number | null;
  romDegrees?: number | null;
  walkingMinutes?: number | null;
  painScore?: number | null;
  painBefore?: number | null;
  painAfter?: number | null;
  fatigue?: number | null;
  skippedReason?: string | null;
  functionalTaskScore?: number | null;
  guidedMovementScore?: number | null;
  symptomsJson?: string | null;
  assignedExerciseKeysJson?: string | null;
  completedExerciseKeysJson?: string | null;
};

export type DailyCareCheckInStatus = 'not_started' | 'in_progress' | 'completed';

type DailyCareEntryInput = Omit<
  Partial<DailyCareEntry>,
  'exerciseRepetitions' | 'romDegrees' | 'walkingMinutes'
> & {
  patientId: string;
  exerciseRepetitions?: number | null;
  romDegrees?: number | null;
  walkingMinutes?: number | null;
};

export const DAILY_CARE_SKIPPED_REASON_OPTIONS = [
  { label: 'Fever', value: 'fever' },
  { label: 'Vomiting', value: 'vomiting' },
  { label: 'Chest pain', value: 'chest pain' },
  { label: 'Shortness of breath', value: 'shortness of breath' },
  { label: 'Severe pain', value: 'severe pain' },
  { label: 'Fall', value: 'fall' },
  { label: 'Injury', value: 'injury' },
  { label: 'Clinician told us to stop', value: 'clinician told us to stop' },
  { label: 'Doctor told us to stop', value: 'doctor told us to stop' },
  { label: 'Nurse told us to stop', value: 'nurse told us to stop' },
  { label: 'Urgent concern', value: 'urgent' },
  { label: 'Emergency concern', value: 'emergency' },
] as const;

export type DailyCareSkippedReason =
  (typeof DAILY_CARE_SKIPPED_REASON_OPTIONS)[number]['value'];

export const DAILY_CARE_URGENT_SYMPTOM_OPTIONS = [
  { label: 'New weakness', value: 'new_weakness' },
  { label: 'Chest pain', value: 'chest_pain' },
  { label: 'Shortness of breath', value: 'shortness_of_breath' },
  { label: 'Severe sudden pain', value: 'severe_sudden_pain' },
  { label: 'Severe pain', value: 'severe_pain' },
  { label: 'Fall with injury', value: 'fall_with_injury' },
  { label: 'Confusion', value: 'confusion' },
  { label: 'Loss of consciousness', value: 'loss_of_consciousness' },
] as const;

export type DailyCareUrgentSymptomCode =
  (typeof DAILY_CARE_URGENT_SYMPTOM_OPTIONS)[number]['value'];

export const DAILY_CARE_URGENT_SYMPTOM_CODES: readonly DailyCareUrgentSymptomCode[] =
  DAILY_CARE_URGENT_SYMPTOM_OPTIONS.map((option) => option.value);

const DAILY_CARE_SKIPPED_REASON_VALUE_SET = new Set<string>(
  DAILY_CARE_SKIPPED_REASON_OPTIONS.map((option) => option.value),
);

const DAILY_CARE_URGENT_SYMPTOM_CODE_SET = new Set<string>(
  DAILY_CARE_URGENT_SYMPTOM_CODES,
);

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseStringArrayJson(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function serializeStringArray(value?: string[] | null): string {
  return JSON.stringify(
    (value ?? [])
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function isDailyCareUrgentSymptomCode(value: string): value is DailyCareUrgentSymptomCode {
  return DAILY_CARE_URGENT_SYMPTOM_CODE_SET.has(value);
}

function normalizeSkippedReason(
  value: string | null | undefined,
): DailyCareSkippedReason | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!DAILY_CARE_SKIPPED_REASON_VALUE_SET.has(trimmed)) {
    throw new Error(`Daily care skipped reason is not supported: ${trimmed}`);
  }
  return trimmed as DailyCareSkippedReason;
}

export function mergeDailyCareUrgentSymptoms(
  existingSymptoms: readonly string[] | null | undefined,
  selectedUrgentSymptomCodes: readonly string[] | null | undefined,
): string[] {
  const nextSymptoms: string[] = [];
  const seen = new Set<string>();

  for (const symptom of existingSymptoms ?? []) {
    const normalized = symptom.trim();
    if (!normalized || isDailyCareUrgentSymptomCode(normalized) || seen.has(normalized)) {
      continue;
    }
    nextSymptoms.push(normalized);
    seen.add(normalized);
  }

  const selectedUrgentSymptoms = new Set<DailyCareUrgentSymptomCode>();
  for (const symptom of selectedUrgentSymptomCodes ?? []) {
    const normalized = symptom.trim();
    if (isDailyCareUrgentSymptomCode(normalized)) {
      selectedUrgentSymptoms.add(normalized);
    }
  }

  for (const symptom of DAILY_CARE_URGENT_SYMPTOM_CODES) {
    if (selectedUrgentSymptoms.has(symptom) && !seen.has(symptom)) {
      nextSymptoms.push(symptom);
      seen.add(symptom);
    }
  }

  return nextSymptoms;
}

function nullableNumber(value: number | null | undefined): number | null {
  return value ?? null;
}

function rowToDailyCareEntry(row: DailyCareEntryRow): DailyCareEntry {
  const symptoms = parseStringArrayJson(row.symptomsJson);

  return {
    ...row,
    therapyCompleted: Boolean(row.therapyCompleted),
    caregiverConcern: Boolean(row.caregiverConcern),
    exerciseRepetitions: nullableNumber(row.exerciseRepetitions),
    romDegrees: nullableNumber(row.romDegrees),
    walkingMinutes: nullableNumber(row.walkingMinutes),
    painScore: nullableNumber(row.painScore),
    painBefore: nullableNumber(row.painBefore),
    painAfter: nullableNumber(row.painAfter),
    fatigue: nullableNumber(row.fatigue),
    skippedReason: row.skippedReason ?? null,
    functionalTaskScore: nullableNumber(row.functionalTaskScore),
    guidedMovementScore: nullableNumber(row.guidedMovementScore),
    symptoms: mergeDailyCareUrgentSymptoms(symptoms, symptoms),
    assignedExerciseKeys: normalizeUniqueDevelopmentRehabExerciseKeys(
      parseStringArrayJson(row.assignedExerciseKeysJson),
    ),
    completedExerciseKeys: normalizeUniqueDevelopmentRehabExerciseKeys(
      parseStringArrayJson(row.completedExerciseKeysJson),
    ),
  };
}

function hasOwnEntryValue(entry: DailyCareEntryInput, key: keyof DailyCareEntryInput): boolean {
  return Object.prototype.hasOwnProperty.call(entry, key);
}

function normalizeOptionalNumber(
  value: number | null | undefined,
  field: string,
): number | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) {
    throw new Error(`Daily care entry ${field} must be a finite number.`);
  }
  return value;
}

function mergeOptionalNumber(
  entry: DailyCareEntryInput,
  existing: DailyCareEntry | null,
  key: 'exerciseRepetitions' | 'romDegrees' | 'walkingMinutes' | 'painScore',
): number | null | undefined {
  if (!hasOwnEntryValue(entry, key)) return existing?.[key];
  return normalizeOptionalNumber(entry[key], key);
}

export function getDailyCareEntry(patientId: string, entryDate: string = todayIsoDate()): DailyCareEntry | null {
  const db = getDatabase();
  const row =
    db.getFirstSync<DailyCareEntryRow>(
      `SELECT entry_id AS entryId, patient_id AS patientId, care_plan_id AS carePlanId,
              entry_date AS entryDate, therapy_day AS therapyDay,
              logged_by_user_id AS loggedByUserId, logged_by_role AS loggedByRole,
              therapy_completed AS therapyCompleted, sets_completed AS setsCompleted,
              recommended_sets AS recommendedSets, pain_score AS painScore,
              pain_before AS painBefore, pain_after AS painAfter, fatigue,
              skipped_reason AS skippedReason, assistance_required AS assistanceRequired,
              caregiver_concern AS caregiverConcern,
              functional_task_score AS functionalTaskScore,
              guided_movement_score AS guidedMovementScore,
              exercise_repetitions AS exerciseRepetitions,
              rom_degrees AS romDegrees,
              walking_minutes AS walkingMinutes,
              symptoms_json AS symptomsJson,
              assigned_exercise_keys_json AS assignedExerciseKeysJson,
              completed_exercise_keys_json AS completedExerciseKeysJson,
              notes, created_at AS createdAt, updated_at AS updatedAt
       FROM daily_care_entries
       WHERE patient_id = ? AND entry_date = ?;`,
      patientId,
      entryDate,
    ) ?? null;
  return row ? rowToDailyCareEntry(row) : null;
}

export function getDailyCareEntries(
  patientId: string,
  options: { limit?: number; since?: string; until?: string } = {},
): DailyCareEntry[] {
  const db = getDatabase();
  const limit = options.limit ?? 30;
  const until = options.until ?? todayIsoDate();
  // Always take the most recent rows in-range (DESC + limit), then sort ASC
  // for consumers. ASC+limit previously dropped today's logs on long windows.
  const rows = options.since
    ? db.getAllSync<DailyCareEntryRow>(
        `SELECT entry_id AS entryId, patient_id AS patientId, care_plan_id AS carePlanId,
                entry_date AS entryDate, therapy_day AS therapyDay,
                logged_by_user_id AS loggedByUserId, logged_by_role AS loggedByRole,
                therapy_completed AS therapyCompleted, sets_completed AS setsCompleted,
                recommended_sets AS recommendedSets, pain_score AS painScore,
                pain_before AS painBefore, pain_after AS painAfter, fatigue,
                skipped_reason AS skippedReason, assistance_required AS assistanceRequired,
                caregiver_concern AS caregiverConcern,
                functional_task_score AS functionalTaskScore,
                guided_movement_score AS guidedMovementScore,
                exercise_repetitions AS exerciseRepetitions,
                rom_degrees AS romDegrees,
                walking_minutes AS walkingMinutes,
                symptoms_json AS symptomsJson,
                assigned_exercise_keys_json AS assignedExerciseKeysJson,
                completed_exercise_keys_json AS completedExerciseKeysJson,
                notes, created_at AS createdAt, updated_at AS updatedAt
         FROM daily_care_entries
         WHERE patient_id = ? AND entry_date >= ? AND entry_date <= ?
         ORDER BY entry_date DESC
         LIMIT ?;`,
        patientId,
        options.since,
        until,
        limit,
      )
    : db.getAllSync<DailyCareEntryRow>(
        `SELECT entry_id AS entryId, patient_id AS patientId, care_plan_id AS carePlanId,
                entry_date AS entryDate, therapy_day AS therapyDay,
                logged_by_user_id AS loggedByUserId, logged_by_role AS loggedByRole,
                therapy_completed AS therapyCompleted, sets_completed AS setsCompleted,
                recommended_sets AS recommendedSets, pain_score AS painScore,
                pain_before AS painBefore, pain_after AS painAfter, fatigue,
                skipped_reason AS skippedReason, assistance_required AS assistanceRequired,
                caregiver_concern AS caregiverConcern,
                functional_task_score AS functionalTaskScore,
                guided_movement_score AS guidedMovementScore,
                exercise_repetitions AS exerciseRepetitions,
                rom_degrees AS romDegrees,
                walking_minutes AS walkingMinutes,
                symptoms_json AS symptomsJson,
                assigned_exercise_keys_json AS assignedExerciseKeysJson,
                completed_exercise_keys_json AS completedExerciseKeysJson,
                notes, created_at AS createdAt, updated_at AS updatedAt
         FROM daily_care_entries
         WHERE patient_id = ? AND entry_date <= ?
         ORDER BY entry_date DESC
         LIMIT ?;`,
        patientId,
        until,
        limit,
      );
  return rows
    .map(rowToDailyCareEntry)
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate));
}

export function hasDailyCareEntryValues(entry: DailyCareEntry | null): boolean {
  if (!entry) return false;
  return (
    entry.therapyCompleted ||
    entry.setsCompleted > 0 ||
    Number.isFinite(entry.exerciseRepetitions) ||
    Number.isFinite(entry.romDegrees) ||
    Number.isFinite(entry.walkingMinutes) ||
    Number.isFinite(entry.painScore) ||
    Number.isFinite(entry.painBefore) ||
    Number.isFinite(entry.painAfter) ||
    Number.isFinite(entry.fatigue) ||
    Boolean(entry.skippedReason?.trim()) ||
    (entry.symptoms?.length ?? 0) > 0 ||
    (entry.completedExerciseKeys?.length ?? 0) > 0 ||
    Boolean(entry.notes?.trim())
  );
}

export function getDailyCareCheckInStatus(entry: DailyCareEntry | null): DailyCareCheckInStatus {
  if (!hasDailyCareEntryValues(entry)) return 'not_started';
  return entry?.therapyCompleted ? 'completed' : 'in_progress';
}

export function upsertDailyCareEntry(entry: DailyCareEntryInput): DailyCareEntry {
  const db = getDatabase();
  const now = new Date().toISOString();
  const entryDate = entry.entryDate ?? todayIsoDate();

  const existing = getDailyCareEntry(entry.patientId, entryDate);
  const therapyCompleted = entry.therapyCompleted ?? existing?.therapyCompleted ?? false;
  const skippedReason = therapyCompleted
    ? null
    : hasOwnEntryValue(entry, 'skippedReason')
      ? normalizeSkippedReason(entry.skippedReason)
      : existing?.skippedReason ?? null;
  const symptoms = hasOwnEntryValue(entry, 'symptoms')
    ? mergeDailyCareUrgentSymptoms(entry.symptoms, entry.symptoms)
    : existing?.symptoms ?? [];
  const assignedExerciseKeys = hasOwnEntryValue(entry, 'assignedExerciseKeys')
    ? normalizeUniqueDevelopmentRehabExerciseKeys(entry.assignedExerciseKeys)
    : existing?.assignedExerciseKeys ?? [];
  const nextCompletedExerciseKeys = hasOwnEntryValue(entry, 'completedExerciseKeys')
    ? normalizeUniqueDevelopmentRehabExerciseKeys(entry.completedExerciseKeys)
    : existing?.completedExerciseKeys ?? [];
  const completedExerciseKeys = assignedExerciseKeys.length > 0 || hasOwnEntryValue(entry, 'assignedExerciseKeys')
    ? filterCompletedExerciseKeysForAssignments(
        nextCompletedExerciseKeys,
        assignedExerciseKeys.map((exerciseKey) => ({ exerciseKey, active: true })),
      )
    : nextCompletedExerciseKeys;
  const merged: DailyCareEntry = {
    entryId: existing?.entryId ?? makeId('dce'),
    patientId: entry.patientId,
    carePlanId: entry.carePlanId ?? existing?.carePlanId,
    entryDate,
    therapyDay: entry.therapyDay ?? existing?.therapyDay,
    loggedByUserId: entry.loggedByUserId ?? existing?.loggedByUserId,
    loggedByRole: entry.loggedByRole ?? existing?.loggedByRole,
    therapyCompleted,
    setsCompleted: entry.setsCompleted ?? existing?.setsCompleted ?? 0,
    recommendedSets: entry.recommendedSets ?? existing?.recommendedSets ?? 0,
    exerciseRepetitions: mergeOptionalNumber(entry, existing, 'exerciseRepetitions'),
    romDegrees: mergeOptionalNumber(entry, existing, 'romDegrees'),
    walkingMinutes: mergeOptionalNumber(entry, existing, 'walkingMinutes'),
    painScore: mergeOptionalNumber(entry, existing, 'painScore'),
    painBefore: entry.painBefore ?? existing?.painBefore,
    painAfter: entry.painAfter ?? existing?.painAfter,
    fatigue: entry.fatigue ?? existing?.fatigue,
    skippedReason,
    symptoms,
    assignedExerciseKeys,
    completedExerciseKeys,
    assistanceRequired: entry.assistanceRequired ?? existing?.assistanceRequired,
    caregiverConcern: entry.caregiverConcern ?? existing?.caregiverConcern ?? false,
    functionalTaskScore: entry.functionalTaskScore ?? existing?.functionalTaskScore,
    guidedMovementScore: entry.guidedMovementScore ?? existing?.guidedMovementScore,
    notes: entry.notes ?? existing?.notes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  db.runSync(
    `INSERT OR REPLACE INTO daily_care_entries
      (entry_id, patient_id, care_plan_id, entry_date, therapy_day,
       logged_by_user_id, logged_by_role, therapy_completed, sets_completed,
       recommended_sets, pain_score, pain_before, pain_after, fatigue,
       skipped_reason, assistance_required, caregiver_concern,
       functional_task_score, guided_movement_score, notes,
       exercise_repetitions, rom_degrees, walking_minutes, symptoms_json,
       assigned_exercise_keys_json, completed_exercise_keys_json,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    merged.entryId,
    merged.patientId,
    merged.carePlanId ?? null,
    merged.entryDate,
    merged.therapyDay ?? null,
    merged.loggedByUserId ?? null,
    merged.loggedByRole ?? null,
    merged.therapyCompleted ? 1 : 0,
    merged.setsCompleted,
    merged.recommendedSets,
    merged.painScore ?? null,
    merged.painBefore ?? null,
    merged.painAfter ?? null,
    merged.fatigue ?? null,
    merged.skippedReason ?? null,
    merged.assistanceRequired ?? null,
    merged.caregiverConcern ? 1 : 0,
    merged.functionalTaskScore ?? null,
    merged.guidedMovementScore ?? null,
    merged.notes ?? null,
    merged.exerciseRepetitions ?? null,
    merged.romDegrees ?? null,
    merged.walkingMinutes ?? null,
    serializeStringArray(merged.symptoms),
    serializeStringArray(merged.assignedExerciseKeys),
    serializeStringArray(merged.completedExerciseKeys),
    merged.createdAt,
    merged.updatedAt,
  );

  return merged;
}

export function clearUnassignedCompletedExerciseKeys(
  patientId: string,
  carePlanId: string,
  activeExerciseKeys: readonly string[],
): void {
  const db = getDatabase();
  const entryDate = todayIsoDate();
  const rows = db.getAllSync<{
    entryId: string;
    completedExerciseKeysJson?: string | null;
  }>(
    `SELECT entry_id AS entryId,
            completed_exercise_keys_json AS completedExerciseKeysJson
     FROM daily_care_entries
     WHERE patient_id = ?
       AND care_plan_id = ?
       AND entry_date = ?;`,
    patientId,
    carePlanId,
    entryDate,
  );
  const activeAssignedExerciseKeys = normalizeUniqueDevelopmentRehabExerciseKeys(activeExerciseKeys);
  const activeAssignments = activeAssignedExerciseKeys.map((exerciseKey) => ({
      exerciseKey,
      active: true,
    }));

  for (const row of rows) {
    const currentKeys = normalizeUniqueDevelopmentRehabExerciseKeys(
      parseStringArrayJson(row.completedExerciseKeysJson),
    );
    const nextKeys = filterCompletedExerciseKeysForAssignments(currentKeys, activeAssignments);
    if (nextKeys.length === currentKeys.length && nextKeys.every((key, index) => key === currentKeys[index])) {
      db.runSync(
        `UPDATE daily_care_entries
         SET assigned_exercise_keys_json = ?,
             updated_at = ?
         WHERE entry_id = ?;`,
        serializeStringArray(activeAssignedExerciseKeys),
        new Date().toISOString(),
        row.entryId,
      );
      continue;
    }

    db.runSync(
      `UPDATE daily_care_entries
       SET assigned_exercise_keys_json = ?,
           completed_exercise_keys_json = ?,
           updated_at = ?
       WHERE entry_id = ?;`,
      serializeStringArray(activeAssignedExerciseKeys),
      serializeStringArray(nextKeys),
      new Date().toISOString(),
      row.entryId,
    );
  }
}
