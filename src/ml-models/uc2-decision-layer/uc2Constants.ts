import type { CaregiverObservationCode, FeatureName } from "./uc2Types";

export const UC2_EVENT_NAME = "TRIGGER_WORKFLOW_ANOMALY_TYPE_04";

// @compat Old names
export const UC2_MODEL_NAME = "tiny_uc2_autoencoder";
export const UC2_MODEL_VERSION = "tiny_ae_uc2_v0.1.0";

// New names
export const MODEL_NAME = UC2_MODEL_NAME;
export const MODEL_VERSION = UC2_MODEL_VERSION;

export const AE_DEFAULT_THRESHOLD = 1.129848;

export const FEATURE_ORDER: readonly FeatureName[] = [
    "heart_rate",
    "blood_oxygen",
    "blood_pressure_systolic",
    "blood_pressure_diastolic",
    "glucose_level",
    "body_temperature",
    "respiratory_rate",
    "activity_level",
    "sleep_quality",
    "stress_level",
    "hrv_sdnn",
    "steps_count",
    "calories_burned",
    "pulse_pressure",
    "mean_arterial_pressure",
    "hour_sin",
    "hour_cos",
    "is_sleep_window",
] as const;

// @compat Old name
export const UC2_FEATURE_ORDER = FEATURE_ORDER;

// @compat Old default profile
export const DEFAULT_PATIENT_PROFILE = {
    blood_pressure_systolic: 120,
    blood_pressure_diastolic: 80,
    glucose_level: 100,
    body_temperature: 98.6,
    stress_level: 3,
    activity_level: 1,
};

export const HARD_EMERGENCY_THRESHOLDS = {
    blood_oxygen_lte: 88,
    heart_rate_gte: 140,
    respiratory_rate_gte: 30,
    body_temperature_f_gte: 104.0,
} as const;

export const DEFAULT_FEATURE_VALUES: Record<FeatureName, number> = {
    heart_rate: 75,
    blood_oxygen: 97,
    blood_pressure_systolic: 120,
    blood_pressure_diastolic: 80,
    glucose_level: 100,
    body_temperature: 98.6,
    respiratory_rate: 16,
    activity_level: 0.3,
    sleep_quality: 0.7,
    stress_level: 0.3,
    hrv_sdnn: 45,
    steps_count: 2500,
    calories_burned: 1800,
    pulse_pressure: 40,
    mean_arterial_pressure: 93.33,
    hour_sin: 0,
    hour_cos: 1,
    is_sleep_window: 0,
};

export const PERSONALIZED_THRESHOLD_RULES = {
    spo2_drop_floor1: 4,
    spo2_drop_floor2: 6,
    resting_hr_delta_floor1: 25,
    resting_hr_delta_floor2: 40,
    rr_delta_floor1: 6,
    rr_delta_floor2: 10,
} as const;

export const CAREGIVER_OBSERVATION_CODES: readonly CaregiverObservationCode[] = [
    "EXERCISE_OR_ACTIVITY",
    "POOR_SLEEP",
    "STRESS_OR_EMOTIONAL_UPSET",
    "REDUCED_INTAKE",
    "MEDICATION_CHANGE_OR_MISSED",
    "BATHROOM_CHANGES",
    "VOMITING_OR_DIARRHEA",
    "WEAK_CONFUSED_NOT_BASELINE",
    "PAIN_OR_DISCOMFORT",
    "BREATHING_DIFFERENT",
    "SENSOR_OR_WATCH_ISSUE",
    "NOTHING_UNUSUAL_NOTICED",
    "NOT_SURE",
] as const;

// @compat Old codes aliases to new canonical ones
export const CAREGIVER_CODE_ALIASES: Record<string, CaregiverObservationCode> = {
    EXERCISE_ACTIVITY: "EXERCISE_OR_ACTIVITY",
    STRESS: "STRESS_OR_EMOTIONAL_UPSET",
    LOW_INTAKE: "REDUCED_INTAKE",
    MED_CHANGE: "MEDICATION_CHANGE_OR_MISSED",
    BATHROOM_CHANGE: "BATHROOM_CHANGES",
    VOMITING_DIARRHEA: "VOMITING_OR_DIARRHEA",
    WEAK_CONFUSED: "WEAK_CONFUSED_NOT_BASELINE",
    PAIN: "PAIN_OR_DISCOMFORT",
    BREATHING_CHANGE: "BREATHING_DIFFERENT",
    SENSOR_ISSUE: "SENSOR_OR_WATCH_ISSUE",
    NOTHING_UNUSUAL: "NOTHING_UNUSUAL_NOTICED",
};
