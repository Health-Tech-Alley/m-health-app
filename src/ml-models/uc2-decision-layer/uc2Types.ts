export type PipelinePath =
    | "UC2_SLOW_PATH"
    | "RULE_ENGINE_EMERGENCY_FAST_PATH";

export type UC2ContextualType =
    | "NORMAL_PATTERN"
    | "RESPIRATORY_CONCERN"
    | "GI_AUTONOMIC_RISK"
    | "SLEEP_STRESS_RECOVERY"
    | "EXERTION_LIKE_PATTERN"
    | "CRITICAL_EMERGENCY_ALERT"
    | "GENERAL_MULTIVARIATE_ANOMALY";

export type CaregiverFinalAction =
    | "confirm_concern"
    | "continue_monitoring"
    | "dismiss"
    | "no_prompt_shown";

export type FinalNotificationType =
    | "NO_ALERT"
    | "SLM_SUMMARY_AND_PROVIDER_NOTE"
    | "MONITORING_ADVICE"
    | "CRITICAL_EMERGENCY_ALERT"
    | "DISMISSED_WITH_AUDIT";

export type FinalNotificationLevel =
    | "critical"
    | "follow_up"
    | "monitor"
    | "logged_only"
    | null;

export type FeatureQuality = "observed" | "imputed" | "derived";

export type AppleWatchVitalsInput = {
    patient_id: string;
    caregiver_id?: string;
    device_id?: string;
    timestamp: string;

    heart_rate?: number;
    blood_oxygen?: number;
    respiratory_rate?: number;
    hrv_sdnn?: number;
    steps_count?: number;
    calories_burned?: number;
    sleep_quality?: number;

    blood_pressure_systolic?: number;
    blood_pressure_diastolic?: number;
    glucose_level?: number;
    body_temperature?: number;
    stress_level?: number;
    activity_level?: number;
};

export type PatientProfileDefaults = {
    blood_pressure_systolic?: number;
    blood_pressure_diastolic?: number;
    glucose_level?: number;
    body_temperature?: number;
    stress_level?: number;
    activity_level?: number;
};

export type UC2FeatureVectorResult = {
    rawFeatures: number[];
    featureQuality: Record<string, FeatureQuality>;
    featureMap: Record<string, number>;
};

export type TopFeatureEvidence = {
    feature: string;
    importance: number;
    score: number;
    abs_z: number;
    direction: "unknown";
    source: "ae_reconstruction_contribution";
};

export type EmergencyRuleResult = {
    emergency: boolean;
    severity: 0 | 1 | 2 | 3;
    reason: string | null;
    pipelinePath: PipelinePath;
};

export type FinalDecisionResult = {
    final_notification_type: FinalNotificationType;
    final_notification_level: FinalNotificationLevel;
    final_severity: 0 | 1 | 2 | 3;
    final_notification_title: string;
    final_notification_body: string;
    slm_refinement_queued: boolean;
    refinement_reason: string | null;
};
