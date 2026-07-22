/**
 * Sustained-duration anomaly escalation (Watch12).
 *
 * Evaluates whether an eligible anomaly type has been continuously present
 * in the recent history for longer than the sustained-duration threshold.
 * This is separate from recurrence risk — recurrence counts re-occurrences
 * over a rolling window, while sustained duration requires CONTINUOUS
 * presence without breaks.
 *
 * Eligible anomaly types (from SUSTAINED_ANOMALY_RULES):
 *   - CARDIO_RESPIRATORY_SIGNAL_CHANGE
 *   - UNEXPLAINED_PHYSIOLOGIC_STRESS
 *
 * Rule:
 *   If an eligible anomaly type has been present continuously for > 10 minutes,
 *   elevate severity floor to 2.
 *
 * Continuous: events are "continuous" if each consecutive pair has no gap
 * larger than the allowed gap (2x the sustained_minutes_for_severity2 to
 * allow for missed polling cycles). Only the same or related eligible type
 * counts toward the continuous run.
 *
 * History matching strategy:
 *   - Checks sensor_anomaly_type on HistoricalAnomalyEvent (added in Watch12).
 *   - Falls back to post_hitl_anomaly_type → sensor type mapping for older records.
 *   - INSUFFICIENT_DATA events break the continuous run.
 */

import type {
    HistoricalAnomalyEvent,
    SensorAnomalyType,
    Severity,
    SustainedDurationResult,
} from "./uc2Types";
import { SUSTAINED_ANOMALY_RULES } from "./uc2Constants";

/** Maximum gap in minutes between consecutive events to consider them continuous. */
const MAX_GAP_MINUTES = SUSTAINED_ANOMALY_RULES.sustained_minutes_for_severity2 * 2;

export function evaluateSustainedDuration(params: {
    patient_id: string;
    timestamp_iso: string;
    current_sensor_anomaly_type: SensorAnomalyType;
    current_pre_hitl_severity: Severity;
    history?: HistoricalAnomalyEvent[];
}): SustainedDurationResult {
    const {
        patient_id,
        timestamp_iso,
        current_sensor_anomaly_type,
        history = [],
    } = params;

    // Only assess eligible anomaly types
    const eligibleTypes = SUSTAINED_ANOMALY_RULES.eligible_types as readonly string[];
    if (!eligibleTypes.includes(current_sensor_anomaly_type)) {
        return {
            sustained_minutes: 0,
            sustained_severity_floor: 0,
            sustained_reasons: [],
        };
    }

    const currentTime = Date.parse(timestamp_iso);

    // Filter to this patient's history only, sorted newest→oldest
    const patientHistory = history
        .filter((e) => e.patient_id === patient_id)
        .sort((a, b) => Date.parse(b.timestamp_iso) - Date.parse(a.timestamp_iso));

    if (patientHistory.length === 0) {
        return {
            sustained_minutes: 0,
            sustained_severity_floor: 0,
            sustained_reasons: [],
        };
    }

    // Walk backwards in time from current event, accumulating a continuous run
    // of the same eligible type. Stop when:
    //   1. An event's type does not match the eligible type, OR
    //   2. The gap between consecutive events exceeds MAX_GAP_MINUTES, OR
    //   3. The event is older than we care about (no practical limit, but
    //      gaps break the chain naturally).

    let earliestContinuousTimestamp = currentTime;
    let prevTimestamp = currentTime;

    for (const event of patientHistory) {
        const eventTime = Date.parse(event.timestamp_iso);
        if (eventTime >= currentTime) continue; // skip events at or after current

        const gapMinutes = (prevTimestamp - eventTime) / (1000 * 60);

        // Gap too large — the continuous run is broken
        if (gapMinutes > MAX_GAP_MINUTES) break;

        // Resolve the sensor type from the event
        const eventSensorType = resolveEventSensorType(event);

        // Type must match current eligible type to count
        if (!eligibleTypes.includes(eventSensorType)) break;

        // INSUFFICIENT_DATA breaks the run
        if (eventSensorType === "INSUFFICIENT_DATA") break;

        // Extend the continuous run back to this event
        earliestContinuousTimestamp = eventTime;
        prevTimestamp = eventTime;
    }

    const sustainedMinutes = (currentTime - earliestContinuousTimestamp) / (1000 * 60);

    let sustained_severity_floor: Severity = 0;
    const sustained_reasons: string[] = [];

    if (sustainedMinutes > SUSTAINED_ANOMALY_RULES.sustained_minutes_for_severity2) {
        sustained_severity_floor = 2;
        sustained_reasons.push(
            `Anomaly pattern sustained for ${sustainedMinutes.toFixed(0)} minutes ` +
            `(${current_sensor_anomaly_type}). Threshold: ` +
            `${SUSTAINED_ANOMALY_RULES.sustained_minutes_for_severity2} minutes.`
        );
    }

    return {
        sustained_minutes: Math.round(sustainedMinutes),
        sustained_severity_floor,
        sustained_reasons,
    };
}

/**
 * Resolve the effective sensor anomaly type for a history event.
 * Prefers the explicit sensor_anomaly_type field (Watch12+).
 * Falls back to a best-effort mapping from post_hitl_anomaly_type for older records.
 */
function resolveEventSensorType(event: HistoricalAnomalyEvent): SensorAnomalyType {
    if (event.sensor_anomaly_type) {
        return event.sensor_anomaly_type;
    }

    // Best-effort fallback from post_hitl_anomaly_type for pre-Watch12 records
    switch (event.post_hitl_anomaly_type) {
        case "RESPIRATORY_CONCERN":          return "CARDIO_RESPIRATORY_SIGNAL_CHANGE";
        case "SLEEP_STRESS_RECOVERY":        return "SLEEP_RECOVERY_DEVIATION";
        case "EXERTION_LIKE_PATTERN":        return "EXERTION_OR_ACTIVITY_PATTERN";
        case "PROVIDER_REVIEW_RECOMMENDED":  return "UNEXPLAINED_PHYSIOLOGIC_STRESS";
        case "GI_AUTONOMIC_RISK":            return "UNEXPLAINED_PHYSIOLOGIC_STRESS";
        case "NORMAL_PATTERN":               return "NORMAL_PATTERN";
        case "NO_CONCERN_CONFIRMED":         return "NORMAL_PATTERN";
        case "INSUFFICIENT_DATA":            return "INSUFFICIENT_DATA";
        case "CRITICAL_EMERGENCY_ALERT":     return "CRITICAL_VITAL_THRESHOLD";
        default:                             return "NORMAL_PATTERN";
    }
}
