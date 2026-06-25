import type { PatientProfile, RawObservationInput } from "../../";

export const fixtureEmergencyRaw: RawObservationInput = {
    patient_id: "patient_emergency_001",
    timestamp_iso: "2026-01-10T09:15:00.000Z",
    heart_rate: 145,
    blood_oxygen: 86,
    respiratory_rate: 32,
    body_temperature: 98.9,
    activity_level: 0.0,
    sleep_quality: 0.3,
    hrv_sdnn: 18,
    steps_count: 50,
    calories_burned: 1200,
};

export const fixtureEmergencyProfile: PatientProfile = {
    patient_id: "patient_emergency_001",
    display_name: "Emergency Fixture",
    baseline: {
        resting_heart_rate: 70,
        blood_oxygen: 98,
        respiratory_rate: 15,
        systolic_bp: 118,
        diastolic_bp: 76,
        glucose_level: 100,
        body_temperature: 98.6,
        hrv_sdnn: 45,
    },
};
