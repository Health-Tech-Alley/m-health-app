import type {
    CaregiverHitlInput,
    PatientProfile,
    RawObservationInput,
} from "../../";

export const fixtureEhrBaselineRaw: RawObservationInput = {
    patient_id: "patient_ehr_001",
    timestamp_iso: "2026-01-10T13:00:00.000Z",
    heart_rate: 104,
    blood_oxygen: 93,
    respiratory_rate: 23,
    activity_level: 0.05,
    sleep_quality: 0.6,
    hrv_sdnn: 30,
    steps_count: 500,
    calories_burned: 1400,
};

export const fixtureEhrBaselineProfile: PatientProfile = {
    patient_id: "patient_ehr_001",
    display_name: "EHR Baseline Fixture",
    baseline: {
        resting_heart_rate: 68,
        blood_oxygen: 99,
        respiratory_rate: 15,
        systolic_bp: 116,
        diastolic_bp: 74,
        glucose_level: 95,
        body_temperature: 98.6,
        hrv_sdnn: 50,
    },
    care_plan_thresholds: [
        {
            feature: "blood_oxygen",
            operator: "lte",
            value: 94,
            severity_floor: 2,
            reason: "Care plan requests provider follow-up when SpO2 is 94 or lower.",
        },
    ],
};

export const fixtureEhrBaselineCaregiver: CaregiverHitlInput = {
    selected_codes: ["NOTHING_UNUSUAL_NOTICED"],
};
