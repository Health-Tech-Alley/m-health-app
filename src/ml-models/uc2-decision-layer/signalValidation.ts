/**
 * Signal physiologic rate-of-change validation (Watch12).
 *
 * Detects sensor artifacts caused by impossible vital rate-of-change —
 * e.g. HR jumping 30+ bpm in under 5 seconds, or SpO2 dropping 10+
 * percentage points in under 3 seconds.
 *
 * These are physiologically impossible and indicate watch/sensor noise,
 * not true clinical events. Artifact detection must run BEFORE the
 * emergency rule engine so impossible HR spikes are not incorrectly
 * routed as CRITICAL_EMERGENCY_ALERT.
 *
 * Artifact source tag: "signal_artifact" (FeatureSource)
 * Artifact routing: sensor_anomaly_type = "INSUFFICIENT_DATA"
 */

import { SIGNAL_ARTIFACT_RULES } from "./uc2Constants";
import type {
    FeatureName,
    FeatureQualityTag,
    PreviousObservationInput,
    RawObservationInput,
    SignalValidationResult,
} from "./uc2Types";

/**
 * Validate physiologic rate-of-change between the current and previous observation.
 *
 * Artifact rules:
 *   - HR jump > 30 bpm in < 5 seconds → artifact (heart_rate)
 *   - SpO2 drop > 10 percentage points in < 3 seconds → artifact (blood_oxygen)
 *
 * SpO2 normalization: if a value is in (0, 1] it is treated as a fraction
 * and multiplied by 100 before comparison (handles HealthKit decimal SpO2).
 *
 * If artifact is detected:
 *   - isArtifact: true
 *   - sensor_anomaly_type: "INSUFFICIENT_DATA"
 *   - reasons: contains "Unrealistic vital rate of change detected"
 *   - artifact_features: list of affected feature names
 *   - feature_quality_tags: tagged with source "signal_artifact"
 */
export function validateSignalPhysiologicBounds(params: {
    current: RawObservationInput;
    previous?: PreviousObservationInput;
}): SignalValidationResult {
    const { current, previous } = params;

    const reasons: string[] = [];
    const artifact_features: FeatureName[] = [];
    const feature_quality_tags: FeatureQualityTag[] = [];

    if (!previous) {
        // No previous observation — cannot assess rate-of-change
        return {
            isArtifact: false,
            reasons: [],
            artifact_features: [],
            feature_quality_tags: [],
        };
    }

    const currentTimestamp = Date.parse(current.timestamp_iso);
    const previousTimestamp = Date.parse(previous.timestamp_iso);
    const elapsedSeconds = (currentTimestamp - previousTimestamp) / 1000;

    // ── Heart rate jump check ──────────────────────────────────────────────────
    if (
        typeof current.heart_rate === "number" &&
        typeof previous.heart_rate === "number" &&
        elapsedSeconds > 0 &&
        elapsedSeconds < SIGNAL_ARTIFACT_RULES.heart_rate_jump_seconds
    ) {
        const hrDelta = Math.abs(current.heart_rate - previous.heart_rate);
        if (hrDelta > SIGNAL_ARTIFACT_RULES.heart_rate_jump_bpm) {
            reasons.push(
                `Unrealistic vital rate of change detected: HR changed ${hrDelta.toFixed(0)} bpm ` +
                `in ${elapsedSeconds.toFixed(1)}s (limit: ${SIGNAL_ARTIFACT_RULES.heart_rate_jump_bpm} bpm ` +
                `in ${SIGNAL_ARTIFACT_RULES.heart_rate_jump_seconds}s).`
            );
            artifact_features.push("heart_rate");
            feature_quality_tags.push({
                feature: "heart_rate",
                source: "signal_artifact",
                value: current.heart_rate,
                warning: `HR artifact: ${hrDelta.toFixed(0)} bpm jump in ${elapsedSeconds.toFixed(1)}s.`,
            });
        }
    }

    // ── SpO2 drop check ───────────────────────────────────────────────────────
    if (
        typeof current.blood_oxygen === "number" &&
        typeof previous.blood_oxygen === "number" &&
        elapsedSeconds > 0 &&
        elapsedSeconds < SIGNAL_ARTIFACT_RULES.spo2_drop_seconds
    ) {
        // Normalize HealthKit fractional SpO2 to percentage
        const currentSpo2 = normalizeSpo2(current.blood_oxygen);
        const previousSpo2 = normalizeSpo2(previous.blood_oxygen);
        const spo2Drop = previousSpo2 - currentSpo2; // positive = drop

        if (spo2Drop > SIGNAL_ARTIFACT_RULES.spo2_drop_points) {
            reasons.push(
                `Unrealistic vital rate of change detected: SpO2 dropped ${spo2Drop.toFixed(0)}% ` +
                `in ${elapsedSeconds.toFixed(1)}s (limit: ${SIGNAL_ARTIFACT_RULES.spo2_drop_points}% ` +
                `in ${SIGNAL_ARTIFACT_RULES.spo2_drop_seconds}s).`
            );
            artifact_features.push("blood_oxygen");
            feature_quality_tags.push({
                feature: "blood_oxygen",
                source: "signal_artifact",
                value: currentSpo2,
                warning: `SpO2 artifact: ${spo2Drop.toFixed(0)}% drop in ${elapsedSeconds.toFixed(1)}s.`,
            });
        }
    }

    const isArtifact = artifact_features.length > 0;

    return {
        isArtifact,
        ...(isArtifact ? { sensor_anomaly_type: "INSUFFICIENT_DATA" as const } : {}),
        reasons,
        artifact_features,
        feature_quality_tags,
    };
}

/**
 * Normalize SpO2 to percentage.
 * HealthKit may return fractional values (e.g. 0.98 = 98%).
 */
function normalizeSpo2(value: number): number {
    if (value > 0 && value <= 1) {
        return value * 100;
    }
    return value;
}

/**
 * Optical watch off-wrist contact detection.
 * Inspects `isNearWrist` (boolean) or `wrist_state` ("on" | "off").
 */
export function validateWatchWristContact(input: RawObservationInput): {
    isOffWrist: boolean;
    reasons: string[];
    feature_quality_tags: FeatureQualityTag[];
} {
    const isOffWrist =
        input.isNearWrist === false ||
        input.wrist_state === "off" ||
        input.wrist_state === "OFF";

    if (isOffWrist) {
        return {
            isOffWrist: true,
            reasons: ["Watch off wrist contact detected; vitals flagged as uncontacted sensor."],
            feature_quality_tags: [
                {
                    feature: "heart_rate",
                    source: "WATCH_OFF_WRIST",
                    value: input.heart_rate ?? 0,
                    warning: "Optical sensor not in contact with wrist.",
                },
                {
                    feature: "blood_oxygen",
                    source: "WATCH_OFF_WRIST",
                    value: input.blood_oxygen ?? 0,
                    warning: "Optical sensor not in contact with wrist.",
                },
            ],
        };
    }

    return {
        isOffWrist: false,
        reasons: [],
        feature_quality_tags: [],
    };
}

