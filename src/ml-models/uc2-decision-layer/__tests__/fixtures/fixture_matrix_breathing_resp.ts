import type {
    CaregiverHitlInput,
    PatientProfile,
    RawObservationInput,
} from "../../";

export const fixtureMatrixBreathingRespRaw: RawObservationInput = {
    patient_id: "patient_matrix_resp_001",
    timestamp_iso: "2026-01-10T12:00:00.000Z",
    heart_rate: 116,
    blood_oxygen: 92,
    respiratory_rate: 25,
    activity_level: 0.1,
    sleep_quality: 0.5,
    hrv_sdnn: 24,
    steps_count: 700,
    calories_burned: 1450,
};

export const fixtureMatrixBreathingRespProfile: PatientProfile = {
    patient_id: "patient_matrix_resp_001",
    display_name: "Matrix Breathing Respiratory Fixture",
    baseline: {
        resting_heart_rate: 74,
        blood_oxygen: 98,
        respiratory_rate: 16,
        systolic_bp: 118,
        diastolic_bp: 76,
        glucose_level: 98,
        body_temperature: 98.6,
        hrv_sdnn: 44,
    },
};

export const fixtureMatrixBreathingRespCaregiver: CaregiverHitlInput = {
    selected_codes: ["BREATHING_DIFFERENT"],
    free_text_note: "Breathing seems different than usual.",
};
