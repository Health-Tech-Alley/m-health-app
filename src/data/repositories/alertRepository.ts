/**
 * Repository for alerts and caregiver actions.
 */

import { getDatabase } from '../db';
import type { Alert, CaregiverAction } from '../types';

export function insertAlert(alert: Alert): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO alerts
      (alert_id, patient_id, severity, status, title, body, ml_score, ml_features_json,
       pipeline_path, initial_anomaly_type, post_hitl_anomaly_type, feature_quality_json,
       score_ratio, ae_score, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    alert.alertId,
    alert.patientId,
    alert.severity,
    alert.status,
    alert.title,
    alert.body,
    alert.mlScore ?? null,
    alert.mlFeaturesJson ?? null,
    alert.pipelinePath ?? null,
    alert.initialAnomalyType ?? null,
    alert.postHitlAnomalyType ?? null,
    alert.featureQualityJson ?? null,
    alert.scoreRatio ?? null,
    alert.aeScore ?? null,
    alert.createdAt,
    alert.resolvedAt ?? null,
  );
}

const ALERT_SELECT_COLUMNS = `
  alert_id AS alertId, patient_id AS patientId, severity, status, title, body,
  ml_score AS mlScore, ml_features_json AS mlFeaturesJson,
  pipeline_path AS pipelinePath, initial_anomaly_type AS initialAnomalyType,
  post_hitl_anomaly_type AS postHitlAnomalyType,
  feature_quality_json AS featureQualityJson, score_ratio AS scoreRatio,
  ae_score AS aeScore, created_at AS createdAt, resolved_at AS resolvedAt
`;

export function getOpenAlerts(patientId: string): Alert[] {
  const db = getDatabase();
  return db.getAllSync<Alert>(
    `SELECT ${ALERT_SELECT_COLUMNS}
     FROM alerts
     WHERE patient_id = ? AND status = 'open'
     ORDER BY severity DESC, created_at DESC;`,
    patientId,
  );
}

export const getActiveAlerts = getOpenAlerts;

export function getAlertById(alertId: string): Alert | null {
  const db = getDatabase();
  return (
    db.getFirstSync<Alert>(
      `SELECT ${ALERT_SELECT_COLUMNS}
       FROM alerts WHERE alert_id = ?;`,
      alertId,
    ) ?? null
  );
}

/**
 * All alerts for the alerts log (Dashboard). Excludes `removed` alerts (which
 * are hidden from the log but retained for audit). Ordered newest-first.
 *
 * The log groups these into Active (open / acknowledged) and Inactive
 * (dismissed / resolved / escalated).
 */
export function getAlertsForLog(patientId: string): Alert[] {
  const db = getDatabase();
  return db.getAllSync<Alert>(
    `SELECT ${ALERT_SELECT_COLUMNS}
     FROM alerts
     WHERE patient_id = ? AND status != 'removed'
     ORDER BY created_at DESC;`,
    patientId,
  );
}

export function updateAlertStatus(
  alertId: string,
  status: Alert['status'],
): void {
  const db = getDatabase();
  const resolvedAt = status === 'resolved' || status === 'escalated' ? new Date().toISOString() : null;
  db.runSync(
    'UPDATE alerts SET status = ?, resolved_at = ? WHERE alert_id = ?;',
    status,
    resolvedAt,
    alertId,
  );
}

/** Update ML-derived fields after a post-HITL UC2 re-run. */
export function updateAlertMlFields(
  alertId: string,
  fields: {
    severity?: Alert['severity'];
    postHitlAnomalyType?: string;
    mlScore?: number;
    scoreRatio?: number;
    aeScore?: number;
    title?: string;
    body?: string;
  },
): void {
  const db = getDatabase();
  const existing = getAlertById(alertId);
  if (!existing) return;
  db.runSync(
    `UPDATE alerts SET
       severity = ?,
       post_hitl_anomaly_type = ?,
       ml_score = ?,
       score_ratio = ?,
       ae_score = ?,
       title = ?,
       body = ?
     WHERE alert_id = ?;`,
    fields.severity ?? existing.severity,
    fields.postHitlAnomalyType ?? existing.postHitlAnomalyType ?? null,
    fields.mlScore ?? existing.mlScore ?? null,
    fields.scoreRatio ?? existing.scoreRatio ?? null,
    fields.aeScore ?? existing.aeScore ?? null,
    fields.title ?? existing.title,
    fields.body ?? existing.body ?? null,
    alertId,
  );
}

/**
 * Permanently suppress the critical-alert popup for this alert. The alert is
 * retained (status `dismissed`) and shows as inactive in the alerts log.
 */
export function dismissAlert(alertId: string): void {
  updateAlertStatus(alertId, 'dismissed');
}

/**
 * Remove an alert from the alerts log. The row is retained in SQLite (status
 * `removed`) so the tamper-evident audit trail stays intact.
 */
export function removeAlert(alertId: string): void {
  updateAlertStatus(alertId, 'removed');
}

export function insertCaregiverAction(action: CaregiverAction): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO caregiver_actions
      (action_id, alert_id, patient_id, caregiver_id, type, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    action.actionId,
    action.alertId ?? null,
    action.patientId,
    action.caregiverId,
    action.type,
    action.payloadJson ?? null,
    action.createdAt,
  );
}

export function getActionsForAlert(alertId: string): CaregiverAction[] {
  const db = getDatabase();
  return db.getAllSync<CaregiverAction>(
    `SELECT action_id AS actionId, alert_id AS alertId, patient_id AS patientId,
            caregiver_id AS caregiverId, type, payload_json AS payloadJson, created_at AS createdAt
     FROM caregiver_actions
     WHERE alert_id = ?
     ORDER BY created_at DESC;`,
    alertId,
  );
}

export function resolveAllAlerts(patientId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `UPDATE alerts SET status = 'resolved', resolved_at = ?
     WHERE patient_id = ? AND status != 'resolved';`,
    now,
    patientId,
  );
}
