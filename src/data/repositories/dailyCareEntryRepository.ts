/**
 * Repository for daily_care_entries — the per-day therapy log editable from
 * the Care screen (pain before/after, fatigue, sets, notes, etc.).
 *
 * One row per patient per date (enforced by a unique index). Upsert on save.
 */

import { getDatabase } from '../db';
import type { DailyCareEntry } from '../types';

type DailyCareEntryRow = Omit<
  DailyCareEntry,
  | 'exerciseRepetitions'
  | 'romDegrees'
  | 'walkingMinutes'
  | 'painBefore'
  | 'painAfter'
  | 'fatigue'
  | 'functionalTaskScore'
  | 'guidedMovementScore'
  | 'symptoms'
> & {
  exerciseRepetitions?: number | null;
  romDegrees?: number | null;
  walkingMinutes?: number | null;
  painBefore?: number | null;
  painAfter?: number | null;
  fatigue?: number | null;
  functionalTaskScore?: number | null;
  guidedMovementScore?: number | null;
  symptomsJson?: string | null;
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

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseSymptoms(value?: string | null): string[] {
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

function serializeSymptoms(value?: string[] | null): string {
  return JSON.stringify(
    (value ?? [])
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function nullableNumber(value: number | null | undefined): number | null {
  return value ?? null;
}

function rowToDailyCareEntry(row: DailyCareEntryRow): DailyCareEntry {
  return {
    ...row,
    therapyCompleted: Boolean(row.therapyCompleted),
    caregiverConcern: Boolean(row.caregiverConcern),
    exerciseRepetitions: nullableNumber(row.exerciseRepetitions),
    romDegrees: nullableNumber(row.romDegrees),
    walkingMinutes: nullableNumber(row.walkingMinutes),
    painBefore: nullableNumber(row.painBefore),
    painAfter: nullableNumber(row.painAfter),
    fatigue: nullableNumber(row.fatigue),
    functionalTaskScore: nullableNumber(row.functionalTaskScore),
    guidedMovementScore: nullableNumber(row.guidedMovementScore),
    symptoms: parseSymptoms(row.symptomsJson),
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
  key: 'exerciseRepetitions' | 'romDegrees' | 'walkingMinutes',
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
              recommended_sets AS recommendedSets, pain_before AS painBefore,
              pain_after AS painAfter, fatigue, assistance_required AS assistanceRequired,
              caregiver_concern AS caregiverConcern,
              functional_task_score AS functionalTaskScore,
              guided_movement_score AS guidedMovementScore,
              exercise_repetitions AS exerciseRepetitions,
              rom_degrees AS romDegrees,
              walking_minutes AS walkingMinutes,
              symptoms_json AS symptomsJson,
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
  const rows = options.since
    ? db.getAllSync<DailyCareEntryRow>(
        `SELECT entry_id AS entryId, patient_id AS patientId, care_plan_id AS carePlanId,
                entry_date AS entryDate, therapy_day AS therapyDay,
                logged_by_user_id AS loggedByUserId, logged_by_role AS loggedByRole,
                therapy_completed AS therapyCompleted, sets_completed AS setsCompleted,
                recommended_sets AS recommendedSets, pain_before AS painBefore,
                pain_after AS painAfter, fatigue, assistance_required AS assistanceRequired,
                caregiver_concern AS caregiverConcern,
                functional_task_score AS functionalTaskScore,
                guided_movement_score AS guidedMovementScore,
                exercise_repetitions AS exerciseRepetitions,
                rom_degrees AS romDegrees,
                walking_minutes AS walkingMinutes,
                symptoms_json AS symptomsJson,
                notes, created_at AS createdAt, updated_at AS updatedAt
         FROM daily_care_entries
         WHERE patient_id = ? AND entry_date >= ? AND entry_date <= ?
         ORDER BY entry_date ASC
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
                recommended_sets AS recommendedSets, pain_before AS painBefore,
                pain_after AS painAfter, fatigue, assistance_required AS assistanceRequired,
                caregiver_concern AS caregiverConcern,
                functional_task_score AS functionalTaskScore,
                guided_movement_score AS guidedMovementScore,
                exercise_repetitions AS exerciseRepetitions,
                rom_degrees AS romDegrees,
                walking_minutes AS walkingMinutes,
                symptoms_json AS symptomsJson,
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
    Number.isFinite(entry.painBefore) ||
    Number.isFinite(entry.painAfter) ||
    Number.isFinite(entry.fatigue) ||
    (entry.symptoms?.length ?? 0) > 0 ||
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
  const merged: DailyCareEntry = {
    entryId: existing?.entryId ?? makeId('dce'),
    patientId: entry.patientId,
    carePlanId: entry.carePlanId ?? existing?.carePlanId,
    entryDate,
    therapyDay: entry.therapyDay ?? existing?.therapyDay,
    loggedByUserId: entry.loggedByUserId ?? existing?.loggedByUserId,
    loggedByRole: entry.loggedByRole ?? existing?.loggedByRole,
    therapyCompleted: entry.therapyCompleted ?? existing?.therapyCompleted ?? false,
    setsCompleted: entry.setsCompleted ?? existing?.setsCompleted ?? 0,
    recommendedSets: entry.recommendedSets ?? existing?.recommendedSets ?? 0,
    exerciseRepetitions: mergeOptionalNumber(entry, existing, 'exerciseRepetitions'),
    romDegrees: mergeOptionalNumber(entry, existing, 'romDegrees'),
    walkingMinutes: mergeOptionalNumber(entry, existing, 'walkingMinutes'),
    painBefore: entry.painBefore ?? existing?.painBefore,
    painAfter: entry.painAfter ?? existing?.painAfter,
    fatigue: entry.fatigue ?? existing?.fatigue,
    symptoms: entry.symptoms ?? existing?.symptoms ?? [],
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
       recommended_sets, pain_before, pain_after, fatigue, assistance_required,
       caregiver_concern, functional_task_score, guided_movement_score, notes,
       exercise_repetitions, rom_degrees, walking_minutes, symptoms_json,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
    merged.painBefore ?? null,
    merged.painAfter ?? null,
    merged.fatigue ?? null,
    merged.assistanceRequired ?? null,
    merged.caregiverConcern ? 1 : 0,
    merged.functionalTaskScore ?? null,
    merged.guidedMovementScore ?? null,
    merged.notes ?? null,
    merged.exerciseRepetitions ?? null,
    merged.romDegrees ?? null,
    merged.walkingMinutes ?? null,
    serializeSymptoms(merged.symptoms),
    merged.createdAt,
    merged.updatedAt,
  );

  return merged;
}
