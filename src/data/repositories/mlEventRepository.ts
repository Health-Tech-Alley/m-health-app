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
  MlRawVitals,
} from '../types';

export function insertMlEvent(event: MlEvent): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO ml_events
      (event_id, patient_id, device_id, alert_id, queue_type, event_type,
       timestamp, model_version, threshold, personalized_threshold,
       reconstruction_error, anomaly_detected, input_hash, top_features_json,
       rule_engine_json, caregiver_json, raw_vitals_json,
       training_label_proxy_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
  );
}

export function getMlEvent(eventId: string): MlEvent | null {
  const db = getDatabase();
  return (
    db.getFirstSync<MlEvent>(
      `SELECT event_id AS eventId, patient_id AS patientId, device_id AS deviceId,
              alert_id AS alertId, queue_type AS queueType, event_type AS eventType,
              timestamp, model_version AS modelVersion, threshold,
              personalized_threshold AS personalizedThreshold,
              reconstruction_error AS reconstructionError,
              anomaly_detected AS anomalyDetected, input_hash AS inputHash,
              top_features_json AS topFeaturesJson, rule_engine_json AS ruleEngineJson,
              caregiver_json AS caregiverJson, raw_vitals_json AS rawVitalsJson,
              training_label_proxy_json AS trainingLabelProxyJson,
              created_at AS createdAt
       FROM ml_events WHERE event_id = ?;`,
      eventId,
    ) ?? null
  );
}

export function getMlEventForAlert(alertId: string): MlEvent | null {
  const db = getDatabase();
  return (
    db.getFirstSync<MlEvent>(
      `SELECT event_id AS eventId, patient_id AS patientId, device_id AS deviceId,
              alert_id AS alertId, queue_type AS queueType, event_type AS eventType,
              timestamp, model_version AS modelVersion, threshold,
              personalized_threshold AS personalizedThreshold,
              reconstruction_error AS reconstructionError,
              anomaly_detected AS anomalyDetected, input_hash AS inputHash,
              top_features_json AS topFeaturesJson, rule_engine_json AS ruleEngineJson,
              caregiver_json AS caregiverJson, raw_vitals_json AS rawVitalsJson,
              training_label_proxy_json AS trainingLabelProxyJson,
              created_at AS createdAt
       FROM ml_events WHERE alert_id = ?
       ORDER BY created_at DESC LIMIT 1;`,
      alertId,
    ) ?? null
  );
}

export function getRecentMlEvents(patientId: string, limit = 20): MlEvent[] {
  const db = getDatabase();
  return db.getAllSync<MlEvent>(
    `SELECT event_id AS eventId, patient_id AS patientId, device_id AS deviceId,
            alert_id AS alertId, queue_type AS queueType, event_type AS eventType,
            timestamp, model_version AS modelVersion, threshold,
            personalized_threshold AS personalizedThreshold,
            reconstruction_error AS reconstructionError,
            anomaly_detected AS anomalyDetected, input_hash AS inputHash,
            top_features_json AS topFeaturesJson, rule_engine_json AS ruleEngineJson,
            caregiver_json AS caregiverJson, raw_vitals_json AS rawVitalsJson,
            training_label_proxy_json AS trainingLabelProxyJson,
            created_at AS createdAt
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

export function parseRawVitals(event: MlEvent): MlRawVitals | null {
  if (!event.rawVitalsJson) return null;
  try {
    return JSON.parse(event.rawVitalsJson) as MlRawVitals;
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
