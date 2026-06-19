export const UC2_EVENT_NAME = "TRIGGER_WORKFLOW_ANOMALY_TYPE_04";

export const UC2_MODEL_NAME = "tiny_uc2_autoencoder";

export const UC2_MODEL_VERSION = "tiny_ae_uc2_v0.1.0";

export const UC2_FEATURE_ORDER = [
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

export const DEFAULT_PATIENT_PROFILE = {
    blood_pressure_systolic: 120,
    blood_pressure_diastolic: 80,
    glucose_level: 100,
    body_temperature: 98.6,
    stress_level: 3,
    activity_level: 1,
};

export const CAREGIVER_OBSERVATION_CODES = [
    "EXERCISE_ACTIVITY",
    "POOR_SLEEP",
    "STRESS",
    "LOW_INTAKE",
    "MED_CHANGE",
    "BATHROOM_CHANGE",
    "VOMITING_DIARRHEA",
    "WEAK_CONFUSED",
    "PAIN",
    "BREATHING_CHANGE",
    "SENSOR_ISSUE",
    "NOTHING_UNUSUAL",
    "NOT_SURE",
] as const;
