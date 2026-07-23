/**
 * Repository for appointments (Schedule screen).
 *
 * One row per appointment. Created when the caregiver schedules via the form;
 * editable and deletable from the Upcoming list.
 */

import { getDatabase } from '../db';
import type { Appointment } from '../types';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

export function insertAppointment(appt: Omit<Appointment, 'appointmentId' | 'createdAt' | 'updatedAt'> & { appointmentId?: string }): Appointment {
  const db = getDatabase();
  const now = new Date().toISOString();
  const record: Appointment = {
    appointmentId: appt.appointmentId ?? makeId('appt'),
    patientId: appt.patientId,
    type: appt.type,
    provider: appt.provider,
    date: appt.date,
    time: appt.time,
    location: appt.location,
    reason: appt.reason,
    reminder: appt.reminder,
    status: appt.status ?? 'scheduled',
    createdAt: now,
    updatedAt: now,
  };

  db.runSync(
    `INSERT OR REPLACE INTO appointments
      (appointment_id, patient_id, type, provider, date, time, location, reason, reminder, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    record.appointmentId,
    record.patientId,
    record.type,
    record.provider ?? null,
    record.date,
    record.time ?? null,
    record.location ?? null,
    record.reason ?? null,
    record.reminder ?? null,
    record.status,
    record.createdAt,
    record.updatedAt,
  );

  return record;
}

export function getUpcomingAppointments(patientId: string): Appointment[] {
  const db = getDatabase();
  return db.getAllSync<Appointment>(
    `SELECT appointment_id AS appointmentId, patient_id AS patientId, type, provider,
            date, time, location, reason, reminder, status,
            created_at AS createdAt, updated_at AS updatedAt
     FROM appointments
     WHERE patient_id = ? AND status = 'scheduled'
     ORDER BY date, time;`,
    patientId,
  );
}

export function updateAppointment(appt: Appointment): Appointment {
  const db = getDatabase();
  const updatedAt = new Date().toISOString();
  db.runSync(
    `UPDATE appointments
     SET type = ?, provider = ?, date = ?, time = ?, location = ?, reason = ?, reminder = ?, status = ?, updated_at = ?
     WHERE appointment_id = ?;`,
    appt.type,
    appt.provider ?? null,
    appt.date,
    appt.time ?? null,
    appt.location ?? null,
    appt.reason ?? null,
    appt.reminder ?? null,
    appt.status,
    updatedAt,
    appt.appointmentId,
  );
  return { ...appt, updatedAt };
}

export function deleteAppointment(appointmentId: string): void {
  const db = getDatabase();
  db.runSync('DELETE FROM appointments WHERE appointment_id = ?;', appointmentId);
}

/**
 * Delete the seeded demo appointment(s) for a patient. Removes both the
 * stable-ID demo row and any previously-seeded duplicates (from before the
 * stable-ID fix) so the Schedule screen doesn't accumulate "Medication review"
 * copies across cold starts. Caregiver-added appointments are preserved.
 */
export function deleteDemoAppointmentsForPatient(patientId: string): void {
  const db = getDatabase();
  db.runSync(
    `DELETE FROM appointments
     WHERE patient_id = ?
       AND type = 'Medication review'
       AND reason = 'Quarterly medication review';`,
    patientId,
  );
}
