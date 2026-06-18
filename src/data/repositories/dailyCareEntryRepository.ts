/**
 * Repository for daily_care_entries — the per-day therapy log editable from
 * the Care screen (pain before/after, fatigue, sets, notes, etc.).
 *
 * One row per patient per date (enforced by a unique index). Upsert on save.
 */

import { getDatabase } from '../db';
import type { DailyCareEntry } from '../types';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getDailyCareEntry(patientId: string, entryDate: string = todayIsoDate()): DailyCareEntry | null {
  const db = getDatabase();
  return (
    db.getFirstSync<DailyCareEntry>(
      `SELECT entry_id AS entryId, patient_id AS patientId, care_plan_id AS carePlanId,
              entry_date AS entryDate, therapy_day AS therapyDay,
              logged_by_user_id AS loggedByUserId, logged_by_role AS loggedByRole,
              therapy_completed AS therapyCompleted, sets_completed AS setsCompleted,
              recommended_sets AS recommendedSets, pain_before AS painBefore,
              pain_after AS painAfter, fatigue, assistance_required AS assistanceRequired,
              caregiver_concern AS caregiverConcern,
              functional_task_score AS functionalTaskScore,
              guided_movement_score AS guidedMovementScore,
              notes, created_at AS createdAt, updated_at AS updatedAt
       FROM daily_care_entries
       WHERE patient_id = ? AND entry_date = ?;`,
      patientId,
      entryDate,
    ) ?? null
  );
}

export function upsertDailyCareEntry(entry: Partial<DailyCareEntry> & { patientId: string }): DailyCareEntry {
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
    painBefore: entry.painBefore ?? existing?.painBefore,
    painAfter: entry.painAfter ?? existing?.painAfter,
    fatigue: entry.fatigue ?? existing?.fatigue,
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
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
    merged.createdAt,
    merged.updatedAt,
  );

  return merged;
}
