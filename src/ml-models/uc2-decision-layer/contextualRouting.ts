import {
    TopFeatureEvidence,
    UC2ContextualType,
    AutoencoderResult,
    CompletedFeatureVector,
    SensorClassificationResult,
    Severity,
    SensorAnomalyType,
    SignalValidationResult,
} from "./uc2Types";

// ── @compat Legacy routing (v1 path) ─────────────────────────────────────────

/** @compat Old function preserved for v1 runUC2DecisionLayer path. */
export function classifyInitialContextualType(params: {
    emergency: boolean;
    isAnomaly: boolean;
    topFeatureEvidence: TopFeatureEvidence[];
}): UC2ContextualType {
    const { emergency, isAnomaly, topFeatureEvidence } = params;

    if (emergency) return "CRITICAL_EMERGENCY_ALERT";
    if (!isAnomaly) return "NORMAL_PATTERN";

    const features = topFeatureEvidence.map((x) => x.feature);

    const hasRespiratory = features.some((f) =>
        ["blood_oxygen", "respiratory_rate"].includes(f)
    );

    const hasGIOrAutonomic = features.some((f) =>
        ["body_temperature", "activity_level"].includes(f)
    );

    const hasSleepStress = features.some((f) =>
        ["sleep_quality", "hrv_sdnn", "heart_rate"].includes(f)
    );

    const hasExertion = features.some((f) =>
        ["steps_count", "calories_burned", "activity_level"].includes(f)
    );

    if (hasRespiratory) return "RESPIRATORY_CONCERN";
    if (hasGIOrAutonomic) return "GI_AUTONOMIC_RISK";
    if (hasSleepStress) return "SLEEP_STRESS_RECOVERY";
    if (hasExertion) return "EXERTION_LIKE_PATTERN";

    return "GENERAL_MULTIVARIATE_ANOMALY";
}

/** @compat Old function preserved for v1 runUC2DecisionLayer path. */
export function fusePostHITLContext(params: {
    initialType: UC2ContextualType;
    caregiverSelectedCodes: string[];
}): UC2ContextualType {
    const { initialType, caregiverSelectedCodes } = params;

    if (initialType === "CRITICAL_EMERGENCY_ALERT") {
        return "CRITICAL_EMERGENCY_ALERT";
    }

    if (
        caregiverSelectedCodes.includes("BREATHING_CHANGE") ||
        caregiverSelectedCodes.includes("WEAK_CONFUSED")
    ) {
        return "RESPIRATORY_CONCERN";
    }

    if (
        caregiverSelectedCodes.includes("VOMITING_DIARRHEA") ||
        caregiverSelectedCodes.includes("LOW_INTAKE") ||
        caregiverSelectedCodes.includes("BATHROOM_CHANGE")
    ) {
        return "GI_AUTONOMIC_RISK";
    }

    if (
        caregiverSelectedCodes.includes("POOR_SLEEP") ||
        caregiverSelectedCodes.includes("STRESS")
    ) {
        return "SLEEP_STRESS_RECOVERY";
    }

    if (caregiverSelectedCodes.includes("EXERCISE_ACTIVITY")) {
        return "EXERTION_LIKE_PATTERN";
    }

    return initialType;
}

// ── Watch12 sensor anomaly classification (v2 production path) ────────────────

/**
 * Classify the sensor anomaly type from the 12D AE result.
 *
 * Watch12 routing groups (per spec):
 *   respiratory     = blood_oxygen, respiratory_rate
 *   sleep/stress    = sleep_quality, hrv_sdnn, heart_rate
 *   exertion        = steps_count, calories_burned, activity_level
 *   autonomic stress = body_temperature, hrv_sdnn, heart_rate  → UNEXPLAINED_PHYSIOLOGIC_STRESS
 *
 * Routing priority:
 *   1. CARDIO_RESPIRATORY_SIGNAL_CHANGE (respiratory contributors)
 *   2. SLEEP_RECOVERY_DEVIATION (sleep/HRV/HR contributors)
 *   3. EXERTION_OR_ACTIVITY_PATTERN (activity contributors)
 *   4. UNEXPLAINED_PHYSIOLOGIC_STRESS (temp/HRV/HR autonomic contributors)
 *   5. UNEXPLAINED_PHYSIOLOGIC_STRESS (fallback for unclassified anomaly)
 *   6. NORMAL_PATTERN (no anomaly)
 *
 * Note: heart_rate appears in both sleep/stress and autonomic groups per spec.
 * respiratory takes priority since it is clinically highest concern.
 */
export function classifySensorAnomaly(
    features: CompletedFeatureVector,
    ae: AutoencoderResult,
    signalValidation?: SignalValidationResult | null
): SensorClassificationResult {
    // Artifact path: route to INSUFFICIENT_DATA without AE scoring
    if (signalValidation?.isArtifact) {
        return {
            sensor_anomaly_type: "INSUFFICIENT_DATA",
            pre_hitl_severity: 1,
            reasons: [
                "Signal artifact detected; observation may not reflect true clinical status.",
                ...signalValidation.reasons,
            ],
        };
    }

    if (!ae.is_anomaly) {
        return {
            sensor_anomaly_type: "NORMAL_PATTERN",
            pre_hitl_severity: 0,
            reasons: ["AE score below threshold."],
        };
    }

    const top = ae.top_contributors.map((x) => x.feature);

    // 1. Respiratory: blood_oxygen, respiratory_rate
    const hasRespiratory = top.some((f) =>
        (["blood_oxygen", "respiratory_rate"] as const).includes(f as any)
    );
    if (hasRespiratory) {
        return {
            sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
            pre_hitl_severity: inferPreHitlSeverity(ae.ae_score, ae.ae_threshold),
            reasons: ["Cardio-respiratory features (SpO2/RR) contributed to anomaly."],
        };
    }

    // 2. Sleep/stress recovery: sleep_quality, hrv_sdnn, heart_rate
    const hasSleepStress = top.some((f) =>
        (["sleep_quality", "hrv_sdnn", "heart_rate"] as const).includes(f as any)
    );
    if (hasSleepStress) {
        return {
            sensor_anomaly_type: "SLEEP_RECOVERY_DEVIATION",
            pre_hitl_severity: 1,
            reasons: ["Sleep/HRV/HR features contributed to anomaly."],
        };
    }

    // 3. Exertion / activity: steps_count, calories_burned, activity_level
    const hasExertion = top.some((f) =>
        (["steps_count", "calories_burned", "activity_level"] as const).includes(f as any)
    );
    if (hasExertion) {
        return {
            sensor_anomaly_type: "EXERTION_OR_ACTIVITY_PATTERN",
            pre_hitl_severity: 1,
            reasons: ["Activity/exertion features contributed to anomaly."],
        };
    }

    // 4. Autonomic stress: body_temperature, hrv_sdnn, heart_rate
    const hasAutonomicStress = top.some((f) =>
        (["body_temperature", "hrv_sdnn", "heart_rate"] as const).includes(f as any)
    );
    if (hasAutonomicStress) {
        return {
            sensor_anomaly_type: "UNEXPLAINED_PHYSIOLOGIC_STRESS",
            pre_hitl_severity: inferPreHitlSeverity(ae.ae_score, ae.ae_threshold),
            reasons: ["Autonomic stress pattern (temperature/HRV/HR) contributed to anomaly."],
        };
    }

    // 5. Fallback: unclassified anomaly
    return {
        sensor_anomaly_type: "UNEXPLAINED_PHYSIOLOGIC_STRESS",
        pre_hitl_severity: inferPreHitlSeverity(ae.ae_score, ae.ae_threshold),
        reasons: ["Anomaly detected without a dominant Watch12 routing group."],
    };
}

/**
 * Map sensor anomaly type to a legacy UC2ContextualType for compat helpers.
 */
export function sensorTypeToLegacyContextualType(
    sensorType: SensorAnomalyType
): UC2ContextualType {
    switch (sensorType) {
        case "CARDIO_RESPIRATORY_SIGNAL_CHANGE": return "RESPIRATORY_CONCERN";
        case "SLEEP_RECOVERY_DEVIATION":         return "SLEEP_STRESS_RECOVERY";
        case "EXERTION_OR_ACTIVITY_PATTERN":     return "EXERTION_LIKE_PATTERN";
        case "UNEXPLAINED_PHYSIOLOGIC_STRESS":   return "GENERAL_MULTIVARIATE_ANOMALY";
        case "CRITICAL_VITAL_THRESHOLD":         return "CRITICAL_EMERGENCY_ALERT";
        case "INSUFFICIENT_DATA":                return "NORMAL_PATTERN";
        case "NORMAL_PATTERN":                   return "NORMAL_PATTERN";
        default:                                 return "NORMAL_PATTERN";
    }
}

function inferPreHitlSeverity(score: number, threshold: number): Severity {
    if (score >= threshold * 2) return 2;
    return 1;
}
