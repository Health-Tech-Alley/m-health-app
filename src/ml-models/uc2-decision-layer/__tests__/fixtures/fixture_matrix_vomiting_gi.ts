import type {
    CaregiverHitlInput,
    PatientProfile,
    RawObservationInput,
} from "../../";

export const fixtureMatrixVomitingGiRaw: RawObservationInput = {
    patient_id: "patient_matrix_gi_001",
    timestamp_iso: "2026-01-10T19:00:00.000Z",
    heart_rate: 76,
    blood_oxygen: 98,
    respiratory_rate: 16,
    glucose_level: 200,
    blood_pressure_systolic: 180,
    blood_pressure_diastolic: 120,
    body_temperature: 103,
    activity_level: 0.05,
    sleep_quality: 0.4,
    hrv_sdnn: 22,
    steps_count: 5,
    calories_burned: 15,
};

export const fixtureMatrixVomitingGiProfile: PatientProfile = {
    patient_id: "patient_matrix_gi_001",
    display_name: "Matrix Vomiting GI Fixture",
    conditions: ["Spina Bifida"],
    baseline: {
        resting_heart_rate: 76,
        blood_oxygen: 98,
        respiratory_rate: 16,
        systolic_bp: 116,
        diastolic_bp: 74,
        glucose_level: 98,
        body_temperature: 98.6,
        hrv_sdnn: 45,
    },
};

export const fixtureMatrixVomitingGiCaregiver: CaregiverHitlInput = {
    selected_codes: ["VOMITING_OR_DIARRHEA", "REDUCED_INTAKE"],
    free_text_note: "Vomiting and drinking less than usual.",
};
