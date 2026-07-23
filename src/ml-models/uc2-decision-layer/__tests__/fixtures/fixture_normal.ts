import type { RawObservationInput, PatientProfile } from "../../";

export const fixtureNormalRaw: RawObservationInput = {
    patient_id: "patient_normal_001",
    timestamp_iso: "2026-01-10T14:00:00.000Z",
    heart_rate: 76,
    blood_oxygen: 98,
    respiratory_rate: 16,
    activity_level: 0.3,
    sleep_quality: 0.8,
    hrv_sdnn: 48,
    steps_count: 3200,
    calories_burned: 1750,
};

export const fixtureNormalProfile: PatientProfile = {
    patient_id: "patient_normal_001",
    display_name: "Normal Fixture",
    baseline: {
        resting_heart_rate: 72,
        blood_oxygen: 98,
        respiratory_rate: 16,
        systolic_bp: 118,
        diastolic_bp: 76,
        glucose_level: 96,
        body_temperature: 98.6,
        hrv_sdnn: 50,
    },
};
