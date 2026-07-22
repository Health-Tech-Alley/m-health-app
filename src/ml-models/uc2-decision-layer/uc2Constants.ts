import type { CaregiverObservationCode, Legacy18FeatureName, WatchFeatureName } from "./uc2Types";

export const UC2_EVENT_NAME = "TRIGGER_WORKFLOW_ANOMALY_TYPE_04";

// ── Legacy model names (kept for parity.ts and compat audits) ─────────────────
/** @deprecated Watch12 runtime uses MODEL_NAME / MODEL_VERSION. */
export const UC2_MODEL_NAME = "tiny_uc2_autoencoder";
/** @deprecated Watch12 runtime uses MODEL_NAME / MODEL_VERSION. */
export const UC2_MODEL_VERSION = "tiny_ae_uc2_v0.1.0";

// ── Watch12 model names (production) ─────────────────────────────────────────
export const MODEL_NAME = "tiny_uc2_autoencoder12";
export const MODEL_VERSION = "tiny_ae_uc2_watch12_v0.1.0";

// ── AE tensor dimensions ──────────────────────────────────────────────────────
export const AE_INPUT_DIM = 12;
export const AE_OUTPUT_DIM = 12;

// ── AE threshold (Watch12, validated at 97.5th percentile of normal MSE) ──────
export const AE_DEFAULT_THRESHOLD = 1.1447161;

// ── Watch12 canonical 12-feature AE order ─────────────────────────────────────
/**
 * Canonical order for the Watch12 12D AE tensor.
 * Must match Python training dataframe columns, StandardScaler mean/scale,
 * TFLite input/output, top_contributors, and scaler feature_cols exactly.
 */
export const FEATURE_ORDER: readonly WatchFeatureName[] = [
    "heart_rate",
    "blood_oxygen",
    "respiratory_rate",
    "hrv_sdnn",
    "body_temperature",
    "activity_level",
    "steps_count",
    "calories_burned",
    "sleep_quality",
    "hour_sin",
    "hour_cos",
    "is_sleep_window",
] as const;

// ── Legacy 18D feature order (for parity.ts / compat helpers ONLY) ────────────
/**
 * @deprecated Watch12 production code uses FEATURE_ORDER (12D).
 * Used only by buildUC2FeatureVector and parity.ts.
 */
export const UC2_FEATURE_ORDER: readonly Legacy18FeatureName[] = [
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

// ── Watch12 default values for 12D AE features ───────────────────────────────
/**
 * Fallback imputation values for the 12 Watch AE features.
 * BP, glucose, pulse_pressure, MAP, and stress are NOT included here;
 * they are external measurements handled by personalizedThresholds.ts.
 */
export const DEFAULT_FEATURE_VALUES: Record<WatchFeatureName, number> = {
    heart_rate: 75,
    blood_oxygen: 97,
    body_temperature: 98.6,
    respiratory_rate: 16,
    activity_level: 0.3,
    sleep_quality: 0.7,
    hrv_sdnn: 45,
    steps_count: 2500,
    calories_burned: 1800,
    hour_sin: 0,
    hour_cos: 1,
    is_sleep_window: 0,
};

// ── Legacy default patient profile (for compat / parity path only) ────────────
/** @deprecated Use PatientProfile.baseline for production code. */
export const DEFAULT_PATIENT_PROFILE = {
    blood_pressure_systolic: 120,
    blood_pressure_diastolic: 80,
    glucose_level: 100,
    body_temperature: 98.6,
    stress_level: 3,
    activity_level: 1,
};

// ── Hard emergency thresholds (unchanged) ─────────────────────────────────────
export const HARD_EMERGENCY_THRESHOLDS = {
    blood_oxygen_lte: 88,
    heart_rate_gte: 140,
    respiratory_rate_gte: 30,
    body_temperature_f_gte: 104.0,
} as const;

// ── Personalized threshold rules ──────────────────────────────────────────────
export const PERSONALIZED_THRESHOLD_RULES = {
    spo2_drop_floor1: 4,
    spo2_drop_floor2: 6,
    resting_hr_delta_floor1: 25,
    resting_hr_delta_floor2: 40,
    rr_delta_floor1: 6,
    rr_delta_floor2: 10,
} as const;

// ── Signal artifact detection rules ──────────────────────────────────────────
export const SIGNAL_ARTIFACT_RULES = {
    heart_rate_jump_bpm: 30,
    heart_rate_jump_seconds: 5,
    spo2_drop_points: 10,
    spo2_drop_seconds: 3,
} as const;

// ── Sustained anomaly duration escalation rules ───────────────────────────────
export const SUSTAINED_ANOMALY_RULES = {
    sustained_minutes_for_severity2: 10,
    eligible_types: [
        "CARDIO_RESPIRATORY_SIGNAL_CHANGE",
        "UNEXPLAINED_PHYSIOLOGIC_STRESS",
    ],
} as const;

// ── External measurement threshold rules (BP, outside AE) ────────────────────
export const EXTERNAL_MEASUREMENT_RULES = {
    systolic_bp_gte_severity2: 170,
    diastolic_bp_gte_severity2: 110,
} as const;

// ── Caregiver observation codes ───────────────────────────────────────────────
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
