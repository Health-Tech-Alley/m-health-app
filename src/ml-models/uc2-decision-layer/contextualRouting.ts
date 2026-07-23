import {
    TopFeatureEvidence,
    UC2ContextualType,
    AutoencoderResult,
    CompletedFeatureVector,
    SensorClassificationResult,
    Severity,
} from "./uc2Types";

// @compat Preserved
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
        ["glucose_level", "body_temperature", "activity_level"].includes(f)
    );

    const hasSleepStress = features.some((f) =>
        ["sleep_quality", "stress_level", "hrv_sdnn", "heart_rate"].includes(f)
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

// @compat Preserved
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

// New in v2
export function classifySensorAnomaly(
    features: CompletedFeatureVector,
    ae: AutoencoderResult
): SensorClassificationResult {
    if (!ae.is_anomaly) {
        return {
            sensor_anomaly_type: "NORMAL_PATTERN",
            pre_hitl_severity: 0,
            reasons: ["AE score below threshold."],
        };
    }

    const top = ae.top_contributors.map((x) => x.feature);

    if (
        top.includes("blood_oxygen") ||
        top.includes("respiratory_rate") ||
        top.includes("heart_rate")
    ) {
        return {
            sensor_anomaly_type: "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
            pre_hitl_severity: inferPreHitlSeverity(ae.ae_score, ae.ae_threshold),
            reasons: ["Cardio-respiratory features contributed to anomaly."],
        };
    }

    if (
        top.includes("sleep_quality") ||
        top.includes("hrv_sdnn") ||
        top.includes("is_sleep_window")
    ) {
        return {
            sensor_anomaly_type: "SLEEP_RECOVERY_DEVIATION",
            pre_hitl_severity: 1,
            reasons: ["Sleep/recovery features contributed to anomaly."],
        };
    }

    if (
        top.includes("steps_count") ||
        top.includes("calories_burned") ||
        top.includes("activity_level")
    ) {
        return {
            sensor_anomaly_type: "EXERTION_OR_ACTIVITY_PATTERN",
            pre_hitl_severity: 1,
            reasons: ["Activity/exertion features contributed to anomaly."],
        };
    }

    return {
        sensor_anomaly_type: "UNEXPLAINED_PHYSIOLOGIC_STRESS",
        pre_hitl_severity: inferPreHitlSeverity(ae.ae_score, ae.ae_threshold),
        reasons: ["Anomaly detected without a watch-only explanation."],
    };
}

function inferPreHitlSeverity(score: number, threshold: number): Severity {
    if (score >= threshold * 2) return 2;
    return 1;
}
