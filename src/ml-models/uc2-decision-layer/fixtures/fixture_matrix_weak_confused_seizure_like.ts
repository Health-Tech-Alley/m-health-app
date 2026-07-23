import type {
    CaregiverHitlInput,
    PatientProfile,
    RawObservationInput,
} from "../";

export const fixtureMatrixWeakConfusedSeizureRaw: RawObservationInput = {
    patient_id: "patient_matrix_neuro_001",
    timestamp_iso: "2026-01-10T22:15:00.000Z",
    heart_rate: 122,
    blood_oxygen: 94,
    respiratory_rate: 22,
    activity_level: 0.0,
    sleep_quality: 0.2,
    hrv_sdnn: 18,
    steps_count: 100,
    calories_burned: 1200,
};

export const fixtureMatrixWeakConfusedSeizureProfile: PatientProfile = {
    patient_id: "patient_matrix_neuro_001",
    display_name: "Matrix Weak Confused Seizure-Like Fixture",
    conditions: ["Neurological history"],
    baseline: {
        resting_heart_rate: 72,
        blood_oxygen: 98,
        respiratory_rate: 16,
        systolic_bp: 118,
        diastolic_bp: 76,
        glucose_level: 96,
        body_temperature: 98.6,
        hrv_sdnn: 46,
    },
};

export const fixtureMatrixWeakConfusedSeizureCaregiver: CaregiverHitlInput = {
    selected_codes: ["WEAK_CONFUSED_NOT_BASELINE"],
    free_text_note: "Not acting like baseline after unusual movement episode.",
};
