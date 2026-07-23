import type {
    CaregiverHitlInput,
    PatientProfile,
    RawObservationInput,
} from "../";

export const fixtureSlowPathGiRaw: RawObservationInput = {
    patient_id: "patient_gi_001",
    timestamp_iso: "2026-01-10T20:30:00.000Z",
    heart_rate: 112,
    blood_oxygen: 95,
    respiratory_rate: 21,
    activity_level: 0.05,
    sleep_quality: 0.35,
    hrv_sdnn: 22,
    steps_count: 450,
    calories_burned: 1350,
};

export const fixtureSlowPathGiProfile: PatientProfile = {
    patient_id: "patient_gi_001",
    display_name: "GI Slow Path Fixture",
    conditions: ["Spina Bifida"],
    medications: ["Example medication"],
    care_plan_goals: ["Monitor hydration and energy changes."],
    baseline: {
        resting_heart_rate: 78,
        blood_oxygen: 98,
        respiratory_rate: 16,
        systolic_bp: 114,
        diastolic_bp: 74,
        glucose_level: 98,
        body_temperature: 98.6,
        hrv_sdnn: 44,
    },
};

export const fixtureSlowPathGiCaregiver: CaregiverHitlInput = {
    selected_codes: [
        "VOMITING_OR_DIARRHEA",
        "REDUCED_INTAKE",
        "WEAK_CONFUSED_NOT_BASELINE",
    ],
    free_text_note: "Vomiting since yesterday and not eating today.",
};
