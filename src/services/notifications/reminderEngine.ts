/**
 * Reminder engine (deterministic — no SLM).
 *
 * Derives local notification schedules from structured med schedules
 * (`medication_schedules`) and upcoming appointments. There is no
 * appointments table yet, so appointment reminders are a logged no-op until
 * the scheduling service is built.
 *
 * Respects `notification_preferences`:
 *  - if a scope is disabled, no notifications are scheduled for it
 *  - medication reminders that fall inside quiet hours are shifted to
 *    `quiet_hours_end` (never dropped, except when overridden by a severity-3
 *    anomaly dispatch path which bypasses this engine)
 *
 * The engine is invoked on app start (see `_layout.tsx`) and whenever a
 * med schedule or preference changes (via `rescheduleAll`).
 */

import {
  cancelByScope,
  scheduleLocalNotification,
} from './notificationService';
import {
  getActiveMedications,
  getActiveMedicationSchedules,
  getNotificationPreferences,
  getUpcomingAppointments,
  insertCaregiverAction,
  updateNotificationAction,
} from '@/data';
import type { MedicationSchedule } from '@/data';
import { audit } from '@/services/audit/auditService';

const SNOOZE_MINUTES = 15;
const LOOKAHEAD_DAYS = 14;

/**
 * Reschedule medication + appointment reminders for a patient. Cancels
 * existing pending notifications for those scopes first.
 */
export async function rescheduleAll(patientId: string): Promise<void> {
  await rescheduleMedicationReminders(patientId);
  await rescheduleAppointmentReminders(patientId);
}

/**
 * Rebuild all medication reminders from active med schedules.
 */
export async function rescheduleMedicationReminders(patientId: string): Promise<void> {
  const prefs = safeGetPreferences();
  if (!prefs.medication) {
    await cancelByScope('medication');
    return;
  }

  await cancelByScope('medication');

  const schedules = getActiveMedicationSchedules(patientId);
  const meds = getActiveMedications(patientId);
  const medById = new Map(meds.map((m) => [m.medicationId, m]));

  const now = new Date();
  for (const schedule of schedules) {
    const med = medById.get(schedule.medicationId);
    if (!med) continue;
    const times = computeUpcomingTimes(schedule, now, LOOKAHEAD_DAYS, prefs);
    for (const fireAt of times) {
      const title = `Medication: ${med.name}`;
      const bodyParts: string[] = [];
      if (schedule.doseLabel) bodyParts.push(schedule.doseLabel);
      else if (med.dosage) bodyParts.push(med.dosage);
      bodyParts.push(`scheduled for ${schedule.timeOfDay}`);
      bodyParts.push('Mark as given or snooze 15 min.');
      const body = bodyParts.join(' · ');

      try {
        await scheduleLocalNotification({
          patientId,
          scope: 'medication',
          triggerRef: schedule.scheduleId,
          title,
          body,
          triggerWhen: fireAt,
        });
      } catch (err) {
        console.warn('[reminderEngine] schedule med reminder failed:', err);
      }
    }
  }
}

/**
 * Appointment reminders. Reads scheduled appointments and schedules one
 * reminder per appointment at (appointment time - lead time). Skips
 * cancelled/completed appointments. Respects the appointment scope toggle.
 */
export async function rescheduleAppointmentReminders(patientId: string): Promise<void> {
  const prefs = safeGetPreferences();
  if (!prefs.appointment) {
    await cancelByScope('appointment');
    return;
  }

  await cancelByScope('appointment');

  const appointments = getUpcomingAppointments(patientId);
  const leadMinutes = prefs.appointmentLeadTimeMin ?? 30;
  const now = new Date();

  for (const appt of appointments) {
    if (appt.status !== 'scheduled') continue;

    const fireAt = computeAppointmentFireTime(appt.date, appt.time, leadMinutes);
    if (!fireAt || fireAt <= now) continue;

    const title = appt.provider
      ? `Appointment: ${appt.provider}`
      : 'Upcoming appointment';
    const bodyParts: string[] = [];
    if (appt.type) bodyParts.push(appt.type);
    if (appt.time) bodyParts.push(appt.time);
    if (appt.location) bodyParts.push(appt.location);
    bodyParts.push('Opens the Schedule tab to review.');
    const body = bodyParts.join(' · ');

    try {
      await scheduleLocalNotification({
        patientId,
        scope: 'appointment',
        triggerRef: appt.appointmentId,
        title,
        body,
        triggerWhen: fireAt,
      });
    } catch (err) {
      console.warn('[reminderEngine] schedule appointment reminder failed:', err);
    }
  }
}

/**
 * Compute the fire time for an appointment reminder: the appointment date +
 * optional time, minus the lead-time minutes. Returns null if the time can't
 * be parsed.
 */
function computeAppointmentFireTime(
  dateStr: string,
  timeStr: string | undefined,
  leadMinutes: number,
): Date | null {
  const date = new Date(`${dateStr}T00:00:00`);
  if (isNaN(date.getTime())) return null;

  if (timeStr) {
    // Accept "HH:mm", "HH:mm:ss", or "10:30 AM"-style labels.
    const trimmed = timeStr.trim();
    const match24 = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    let hours = 9;
    let minutes = 0;
    if (match24) {
      hours = parseInt(match24[1], 10);
      minutes = parseInt(match24[2], 10);
    } else if (match12) {
      hours = parseInt(match12[1], 10);
      minutes = parseInt(match12[2], 10);
      const meridiem = match12[3].toUpperCase();
      if (meridiem === 'PM' && hours < 12) hours += 12;
      if (meridiem === 'AM' && hours === 12) hours = 0;
    } else {
      // Unparseable time label — fall back to 09:00.
      hours = 9;
      minutes = 0;
    }
    date.setHours(hours, minutes, 0, 0);
  } else {
    date.setHours(9, 0, 0, 0);
  }

  date.setMinutes(date.getMinutes() - leadMinutes);
  return date;
}

/**
 * Handle a medication-reminder notification action (caregiver HITL).
 */
export async function handleMedicationAction(
  notificationId: string,
  action: 'taken' | 'snooze',
): Promise<void> {
  const nowIso = new Date().toISOString();
  updateNotificationAction(notificationId, action, nowIso);
  audit({
    actor: 'caregiver',
    action: action === 'taken' ? 'med_taken' : 'med_snooze',
    resourceType: 'notification',
    resourceId: notificationId,
    payload: { action },
  });
  if (action === 'taken') {
    insertCaregiverAction({
      actionId: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      patientId: 'unknown',
      caregiverId: 'caregiver',
      type: 'ack',
      payloadJson: JSON.stringify({ notificationId, source: 'medication_reminder' }),
      createdAt: nowIso,
    });
  }
}

/**
 * Snooze a medication reminder: cancel + reschedule +SNOOZE_MINUTES.
 */
export async function snoozeMedicationReminder(
  notificationId: string,
  minutes: number = SNOOZE_MINUTES,
): Promise<void> {
  const fireAt = new Date(Date.now() + minutes * 60 * 1000);
  await updateNotificationAction(notificationId, 'snooze', new Date().toISOString());
  try {
    await scheduleLocalNotification({
      patientId: 'unknown',
      scope: 'medication',
      triggerRef: notificationId,
      title: 'Medication reminder (snoozed)',
      body: `Snoozed ${minutes} min. Mark as given when administered.`,
      triggerWhen: fireAt,
    });
  } catch (err) {
    console.warn('[reminderEngine] snooze reschedule failed:', err);
  }
}

function safeGetPreferences() {
  try {
    return getNotificationPreferences();
  } catch {
    return {
      anomaly: true,
      medication: true,
      appointment: true,
      appointmentLeadTimeMin: 30,
      careTask: true,
    };
  }
}

/**
 * Compute the next `LOOKAHEAD_DAYS` worth of fire-times for a schedule,
 * shifting any that fall inside quiet hours to `quiet_hours_end`.
 */
function computeUpcomingTimes(
  schedule: MedicationSchedule,
  now: Date,
  days: number,
  prefs: { quietHoursStart?: string; quietHoursEnd?: string },
): Date[] {
  const [hh, mm] = schedule.timeOfDay.split(':').map((s) => parseInt(s, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return [];

  const activeDays = parseDaysOfWeek(schedule.daysOfWeek);
  const times: Date[] = [];

  for (let offset = 0; offset < days; offset++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hh, mm, 0, 0);
    if (candidate <= now) continue;
    if (!activeDays.has(candidate.getDay())) continue;
    times.push(shiftForQuietHours(candidate, prefs));
  }
  return times;
}

function parseDaysOfWeek(csv?: string): Set<number> {
  if (!csv || csv.trim() === '') return new Set([0, 1, 2, 3, 4, 5, 6]);
  const days = csv
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n >= 0 && n <= 6);
  return new Set(days);
}

function shiftForQuietHours(
  candidate: Date,
  prefs: { quietHoursStart?: string; quietHoursEnd?: string },
): Date {
  if (!prefs.quietHoursStart || !prefs.quietHoursEnd) return candidate;
  const start = parseHHMM(prefs.quietHoursStart, candidate);
  const end = parseHHMM(prefs.quietHoursEnd, candidate);
  if (!start || !end) return candidate;

  let inQuiet: boolean;
  if (start <= end) {
    inQuiet = candidate >= start && candidate < end;
  } else {
    // quiet hours span midnight, e.g. 22:00 → 07:00
    inQuiet = candidate >= start || candidate < end;
  }
  if (!inQuiet) return candidate;

  const shifted = new Date(end);
  if (shifted <= candidate) shifted.setDate(shifted.getDate() + 1);
  return shifted;
}

function parseHHMM(hhmm: string, base: Date): Date | null {
  const [hh, mm] = hhmm.split(':').map((s) => parseInt(s, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const d = new Date(base);
  d.setHours(hh, mm, 0, 0);
  return d;
}
