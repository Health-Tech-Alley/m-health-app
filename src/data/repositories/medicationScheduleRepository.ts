/**
 * Repository for medication schedules (structured reminder times).
 */

import { getDatabase } from '../db';
import type { MedicationSchedule } from '../types';

export function upsertMedicationSchedule(schedule: MedicationSchedule): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO medication_schedules
      (schedule_id, medication_id, patient_id, time_of_day, days_of_week, dose_label, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    schedule.scheduleId,
    schedule.medicationId,
    schedule.patientId,
    schedule.timeOfDay,
    schedule.daysOfWeek ?? null,
    schedule.doseLabel ?? null,
    schedule.active ? 1 : 0,
    schedule.createdAt,
  );
}

export function getActiveMedicationSchedules(patientId: string): MedicationSchedule[] {
  const db = getDatabase();
  return db.getAllSync<MedicationSchedule>(
    `SELECT schedule_id AS scheduleId, medication_id AS medicationId,
            patient_id AS patientId, time_of_day AS timeOfDay,
            days_of_week AS daysOfWeek, dose_label AS doseLabel,
            active, created_at AS createdAt
     FROM medication_schedules
     WHERE patient_id = ? AND active = 1
     ORDER BY time_of_day;`,
    patientId,
  );
}

export function getMedicationSchedulesForMedication(medicationId: string): MedicationSchedule[] {
  const db = getDatabase();
  return db.getAllSync<MedicationSchedule>(
    `SELECT schedule_id AS scheduleId, medication_id AS medicationId,
            patient_id AS patientId, time_of_day AS timeOfDay,
            days_of_week AS daysOfWeek, dose_label AS doseLabel,
            active, created_at AS createdAt
     FROM medication_schedules
     WHERE medication_id = ?;`,
    medicationId,
  );
}

export function deleteMedicationSchedule(scheduleId: string): void {
  const db = getDatabase();
  db.runSync('DELETE FROM medication_schedules WHERE schedule_id = ?;', scheduleId);
}

export function deactivateMedicationSchedule(scheduleId: string): void {
  const db = getDatabase();
  db.runSync('UPDATE medication_schedules SET active = 0 WHERE schedule_id = ?;', scheduleId);
}
