/**
 * Repository for the `ml_events` table.
 *
 * Stores the full structured output from the Alert ML model (Jay's sample
 * JSON shape): top_features, rule_engine, caregiver block, raw_vitals,
 * training_label_proxy, queue_type, event_type. Preserved verbatim so the
 * ML → SLM bridge (Phase 4) can read them back without re-running the model.
 */

import { getDatabase } from '../db';
import type {
  MlEvent,
  MlTopFeature,
  MlRuleEngine,
  MlCaregiverBlock,
  MlRawVitalsPayload,
} from '../types';

export function insertMlEvent(event: MlEvent): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO ml_events
      (event_id, patient_id, device_id, alert_id, queue_type, event_type,
       timestamp, model_version, threshold, personalized_threshold,
       reconstruction_error, anomaly_detected, input_hash, top_features_json,
       rule_engine_json, caregiver_json, raw_vitals_json,
       training_label_proxy_json, created_at,
       feature_quality_json, initial_anomaly_type, post_hitl_anomaly_type,
       score_ratio, slm_task_json, threshold_recommendation_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    event.eventId,
    event.patientId,
    event.deviceId ?? null,
    event.alertId ?? null,
    event.queueType ?? null,
    event.eventType ?? null,
    event.timestamp,
    event.modelVersion ?? null,
    event.threshold ?? null,
    event.personalizedThreshold ?? null,
    event.reconstructionError ?? null,
    event.anomalyDetected ? 1 : 0,
    event.inputHash ?? null,
    event.topFeaturesJson ?? null,
    event.ruleEngineJson ?? null,
    event.caregiverJson ?? null,
    event.rawVitalsJson ?? null,
    event.trainingLabelProxyJson ?? null,
    event.createdAt,
    event.featureQualityJson ?? null,
    event.initialAnomalyType ?? null,
    event.postHitlAnomalyType ?? null,
    event.scoreRatio ?? null,
    event.slmTaskJson ?? null,
    event.thresholdRecommendationJson ?? null,
  );
}

const ML_EVENT_SELECT_COLUMNS = `
  event_id AS eventId, patient_id AS patientId, device_id AS deviceId,
  alert_id AS alertId, queue_type AS queueType, event_type AS eventType,
  timestamp, model_version AS modelVersion, threshold,
  personalized_threshold AS personalizedThreshold,
  reconstruction_error AS reconstructionError,
  anomaly_detected AS anomalyDetected, input_hash AS inputHash,
  top_features_json AS topFeaturesJson, rule_engine_json AS ruleEngineJson,
  caregiver_json AS caregiverJson, raw_vitals_json AS rawVitalsJson,
  training_label_proxy_json AS trainingLabelProxyJson,
  created_at AS createdAt,
  feature_quality_json AS featureQualityJson,
  initial_anomaly_type AS initialAnomalyType,
  post_hitl_anomaly_type AS postHitlAnomalyType,
  score_ratio AS scoreRatio, slm_task_json AS slmTaskJson,
  threshold_recommendation_json AS thresholdRecommendationJson
`;

export function getMlEvent(eventId: string): MlEvent | null {
  const db = getDatabase();
  return (
    db.getFirstSync<MlEvent>(
      `SELECT ${ML_EVENT_SELECT_COLUMNS}
       FROM ml_events WHERE event_id = ?;`,
      eventId,
    ) ?? null
  );
}

export function getMlEventForAlert(alertId: string): MlEvent | null {
  const db = getDatabase();
  return (
    db.getFirstSync<MlEvent>(
      `SELECT ${ML_EVENT_SELECT_COLUMNS}
       FROM ml_events WHERE alert_id = ?
       ORDER BY created_at DESC LIMIT 1;`,
      alertId,
    ) ?? null
  );
}

export function getRecentMlEvents(patientId: string, limit = 20): MlEvent[] {
  const db = getDatabase();
  return db.getAllSync<MlEvent>(
    `SELECT ${ML_EVENT_SELECT_COLUMNS}
     FROM ml_events
     WHERE patient_id = ?
     ORDER BY timestamp DESC
     LIMIT ?;`,
    patientId,
    limit,
  );
}

// ---------------------------------------------------------------------------
// Parsed accessors — deserialize the JSON columns into typed shapes for the
// ML → SLM bridge (Phase 4).
// ---------------------------------------------------------------------------

export function parseTopFeatures(event: MlEvent): MlTopFeature[] {
  if (!event.topFeaturesJson) return [];
  try {
    const parsed = JSON.parse(event.topFeaturesJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is MlTopFeature =>
        Array.isArray(f) && f.length === 2 && typeof f[0] === 'string' && typeof f[1] === 'number',
    );
  } catch {
    return [];
  }
}

export function parseRuleEngine(event: MlEvent): MlRuleEngine | null {
  if (!event.ruleEngineJson) return null;
  try {
    return JSON.parse(event.ruleEngineJson) as MlRuleEngine;
  } catch {
    return null;
  }
}

export function parseCaregiverBlock(event: MlEvent): MlCaregiverBlock | null {
  if (!event.caregiverJson) return null;
  try {
    return JSON.parse(event.caregiverJson) as MlCaregiverBlock;
  } catch {
    return null;
  }
}

/** Persist post-HITL caregiver observations + classification onto an ml_event. */
export function updateMlEventPostHitl(
  eventId: string,
  fields: {
    caregiverJson?: string;
    postHitlAnomalyType?: string;
    reconstructionError?: number;
    scoreRatio?: number;
  },
): void {
  const db = getDatabase();
  const existing = getMlEvent(eventId);
  if (!existing) return;
  db.runSync(
    `UPDATE ml_events SET
       caregiver_json = ?,
       post_hitl_anomaly_type = ?,
       reconstruction_error = ?,
       score_ratio = ?
     WHERE event_id = ?;`,
    fields.caregiverJson ?? existing.caregiverJson ?? null,
    fields.postHitlAnomalyType ?? existing.postHitlAnomalyType ?? null,
    fields.reconstructionError ?? existing.reconstructionError ?? null,
    fields.scoreRatio ?? existing.scoreRatio ?? null,
    eventId,
  );
}

export function parseRawVitals(event: MlEvent): MlRawVitalsPayload | null {
  if (!event.rawVitalsJson) return null;
  try {
    return JSON.parse(event.rawVitalsJson) as MlRawVitalsPayload;
  } catch {
    return null;
  }
}

/**
 * Reconstruction-error / threshold ratio. > 1 means anomalous; the higher
 * the ratio, the more confident the anomaly. Used by the upgraded confidence
 * router (Phase 4) to gate SLM invocation.
 */
export function getAnomalyConfidenceRatio(event: MlEvent): number | null {
  if (
    typeof event.reconstructionError !== 'number' ||
    typeof event.threshold !== 'number' ||
    event.threshold === 0
  ) {
    return null;
  }
  return event.reconstructionError / event.threshold;
}
