import type {
    CaregiverHitlInput,
    PatientProfile,
    RawObservationInput,
} from "../";

export const fixtureRespiratoryRaw: RawObservationInput = {
    patient_id: "patient_resp_001",
    timestamp_iso: "2026-01-10T11:00:00.000Z",
    heart_rate: 118,
    blood_oxygen: 92,
    respiratory_rate: 25,
    activity_level: 0.1,
    sleep_quality: 0.5,
    hrv_sdnn: 26,
    steps_count: 900,
    calories_burned: 1500,
};

export const fixtureRespiratoryProfile: PatientProfile = {
    patient_id: "patient_resp_001",
    display_name: "Respiratory Follow-Up Fixture",
    baseline: {
        resting_heart_rate: 76,
        blood_oxygen: 98,
        respiratory_rate: 16,
        systolic_bp: 120,
        diastolic_bp: 78,
        glucose_level: 100,
        body_temperature: 98.6,
        hrv_sdnn: 42,
    },
};

export const fixtureRespiratoryCaregiver: CaregiverHitlInput = {
    selected_codes: ["BREATHING_DIFFERENT", "WEAK_CONFUSED_NOT_BASELINE"],
    free_text_note: "Breathing seems different and patient is very tired.",
};
