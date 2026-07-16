import { getDatabase } from '../db';
import type { CarePlanRehabMetric } from '../types';

type DatabaseLike = ReturnType<typeof getDatabase>;

export function upsertCarePlanRehabMetric(
  metric: CarePlanRehabMetric,
  db: DatabaseLike = getDatabase(),
): void {
  db.runSync(
    `INSERT INTO care_plan_rehab_metrics
      (id, patient_id, care_plan_id, care_plan_activity_id, metric_key, display_name,
       baseline_value, target_value, unit, duration_days, source_goal_id,
       source_baseline_observation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(patient_id, care_plan_id, metric_key) DO UPDATE SET
       id = excluded.id,
       care_plan_activity_id = excluded.care_plan_activity_id,
       display_name = excluded.display_name,
       baseline_value = excluded.baseline_value,
       target_value = excluded.target_value,
       unit = excluded.unit,
       duration_days = excluded.duration_days,
       source_goal_id = excluded.source_goal_id,
       source_baseline_observation_id = excluded.source_baseline_observation_id,
       updated_at = excluded.updated_at;`,
    metric.id,
    metric.patientId,
    metric.carePlanId,
    metric.carePlanActivityId ?? null,
    metric.metricKey,
    metric.displayName,
    metric.baselineValue ?? null,
    metric.targetValue ?? null,
    metric.unit,
    metric.durationDays,
    metric.sourceGoalId ?? null,
    metric.sourceBaselineObservationId ?? null,
    metric.createdAt,
    metric.updatedAt,
  );
}

export function replaceCarePlanRehabMetrics(
  patientId: string,
  carePlanId: string,
  metrics: CarePlanRehabMetric[],
  db: DatabaseLike = getDatabase(),
): void {
  db.runSync(
    `DELETE FROM care_plan_rehab_metrics
     WHERE patient_id = ? AND care_plan_id = ?;`,
    patientId,
    carePlanId,
  );

  for (const metric of metrics) {
    upsertCarePlanRehabMetric(metric, db);
  }
}

export function getCarePlanRehabMetrics(
  patientId: string,
  carePlanId: string,
): CarePlanRehabMetric[] {
  const db = getDatabase();
  return db.getAllSync<CarePlanRehabMetric>(
    `SELECT id,
            patient_id AS patientId,
            care_plan_id AS carePlanId,
            care_plan_activity_id AS carePlanActivityId,
            metric_key AS metricKey,
            display_name AS displayName,
            baseline_value AS baselineValue,
            target_value AS targetValue,
            unit,
            duration_days AS durationDays,
            source_goal_id AS sourceGoalId,
            source_baseline_observation_id AS sourceBaselineObservationId,
            created_at AS createdAt,
            updated_at AS updatedAt
     FROM care_plan_rehab_metrics
     WHERE patient_id = ? AND care_plan_id = ?
     ORDER BY rowid ASC;`,
    patientId,
    carePlanId,
  );
}
