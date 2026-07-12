import { getDatabase } from '../db';
import type { CarePlan, CarePlanActivity } from '../types';

export type UpsertCarePlanInput = Omit<CarePlan, 'activities'> & {
  activities?: CarePlanActivity[];
};

export function upsertCarePlan(plan: UpsertCarePlanInput): void {
  const db = getDatabase();
  db.runSync(
    `INSERT INTO care_plans (
       plan_id, patient_id, version, effective_date, safety_notes,
       emergency_contact, status, intent, title, description, period_start,
       period_end, care_team_display_json, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(plan_id) DO UPDATE SET
       patient_id = excluded.patient_id,
       version = excluded.version,
       effective_date = excluded.effective_date,
       safety_notes = excluded.safety_notes,
       emergency_contact = excluded.emergency_contact,
       status = excluded.status,
       intent = excluded.intent,
       title = excluded.title,
       description = excluded.description,
       period_start = excluded.period_start,
       period_end = excluded.period_end,
       care_team_display_json = excluded.care_team_display_json;`,
    plan.planId,
    plan.patientId,
    plan.version,
    plan.effectiveDate,
    plan.safetyNotes ?? null,
    plan.emergencyContact ?? null,
    plan.status ?? null,
    plan.intent ?? null,
    plan.title ?? null,
    plan.description ?? null,
    plan.periodStart ?? null,
    plan.periodEnd ?? null,
    plan.careTeamDisplayJson ?? null,
    plan.createdAt,
  );

  db.runSync('DELETE FROM care_plan_activities WHERE plan_id = ?;', plan.planId);
  for (const activity of plan.activities ?? []) {
    db.runSync(
      `INSERT OR REPLACE INTO care_plan_activities
         (activity_id, plan_id, status, description, sequence)
       VALUES (?, ?, ?, ?, ?);`,
      activity.activityId,
      activity.planId,
      activity.status ?? null,
      activity.description ?? null,
      activity.sequence,
    );
  }
}

export function getActiveCarePlanForPatient(patientId: string): CarePlan | null {
  const db = getDatabase();
  const plan = db.getFirstSync<Omit<CarePlan, 'activities'>>(
    `SELECT plan_id AS planId, patient_id AS patientId, version,
            effective_date AS effectiveDate, safety_notes AS safetyNotes,
            emergency_contact AS emergencyContact, status, intent, title,
            description, period_start AS periodStart, period_end AS periodEnd,
            care_team_display_json AS careTeamDisplayJson, created_at AS createdAt
     FROM care_plans
     WHERE patient_id = ?
       AND COALESCE(status, 'active') = 'active'
       AND COALESCE(intent, '') <> 'hedis-aligned'
     ORDER BY COALESCE(period_start, effective_date) DESC, version DESC
     LIMIT 1;`,
    patientId,
  );
  if (!plan) return null;

  const activities = db.getAllSync<CarePlanActivity>(
    `SELECT activity_id AS activityId, plan_id AS planId, status, description, sequence
     FROM care_plan_activities
     WHERE plan_id = ?
     ORDER BY sequence ASC;`,
    plan.planId,
  );

  return { ...plan, activities };
}

export function getCarePlansForPatient(patientId: string): CarePlan[] {
  const db = getDatabase();
  const plans = db.getAllSync<Omit<CarePlan, 'activities'>>(
    `SELECT plan_id AS planId, patient_id AS patientId, version,
            effective_date AS effectiveDate, safety_notes AS safetyNotes,
            emergency_contact AS emergencyContact, status, intent, title,
            description, period_start AS periodStart, period_end AS periodEnd,
            care_team_display_json AS careTeamDisplayJson, created_at AS createdAt
     FROM care_plans
     WHERE patient_id = ?
     ORDER BY COALESCE(period_start, effective_date) DESC, version DESC;`,
    patientId,
  );

  return plans.map((plan) => {
    const activities = db.getAllSync<CarePlanActivity>(
      `SELECT activity_id AS activityId, plan_id AS planId, status, description, sequence
       FROM care_plan_activities
       WHERE plan_id = ?
       ORDER BY sequence ASC;`,
      plan.planId,
    );
    return { ...plan, activities };
  });
}
