import { TopFeatureEvidence, UC2ContextualType } from "./uc2Types";

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
