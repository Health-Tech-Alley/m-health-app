import type {
    CaregiverHitlInput,
    PatientProfile,
    RawObservationInput,
} from "../../";

export const fixtureSensorIssueRaw: RawObservationInput = {
    patient_id: "patient_sensor_001",
    timestamp_iso: "2026-01-10T16:45:00.000Z",
    heart_rate: 105,
    blood_oxygen: 96,
    respiratory_rate: 18,
    activity_level: 0.8,
    sleep_quality: 0.7,
    hrv_sdnn: 32,
    steps_count: 9800,
    calories_burned: 2400,
};

export const fixtureSensorIssueProfile: PatientProfile = {
    patient_id: "patient_sensor_001",
    display_name: "Sensor Issue Fixture",
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

export const fixtureSensorIssueCaregiver: CaregiverHitlInput = {
    selected_codes: ["SENSOR_OR_WATCH_ISSUE", "NOTHING_UNUSUAL_NOTICED"],
    free_text_note: "Watch was loose during activity.",
};
