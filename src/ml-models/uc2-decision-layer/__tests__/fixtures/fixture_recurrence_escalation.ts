import type {
    CaregiverHitlInput,
    HistoricalAnomalyEvent,
    PatientProfile,
    RawObservationInput,
} from "../../";

export const fixtureRecurrenceRaw: RawObservationInput = {
    patient_id: "patient_recur_001",
    timestamp_iso: "2026-01-10T18:00:00.000Z",
    heart_rate: 104,
    blood_oxygen: 94,
    respiratory_rate: 22,
    activity_level: 0.1,
    sleep_quality: 0.4,
    hrv_sdnn: 25,
    steps_count: 800,
    calories_burned: 1450,
};

export const fixtureRecurrenceProfile: PatientProfile = {
    patient_id: "patient_recur_001",
    display_name: "Recurrence Fixture",
    baseline: {
        resting_heart_rate: 74,
        blood_oxygen: 98,
        respiratory_rate: 16,
        systolic_bp: 118,
        diastolic_bp: 76,
        glucose_level: 98,
        body_temperature: 98.6,
        hrv_sdnn: 46,
    },
};

export const fixtureRecurrenceCaregiver: CaregiverHitlInput = {
    selected_codes: ["NOT_SURE"],
};

export const fixtureRecurrenceHistory: HistoricalAnomalyEvent[] = [
    {
        patient_id: "patient_recur_001",
        timestamp_iso: "2026-01-09T20:00:00.000Z",
        post_hitl_anomaly_type: "RESPIRATORY_CONCERN",
        final_severity: 2,
        caregiver_confirmed: true,
    },
    {
        patient_id: "patient_recur_001",
        timestamp_iso: "2026-01-10T08:00:00.000Z",
        post_hitl_anomaly_type: "RESPIRATORY_CONCERN",
        final_severity: 1,
        caregiver_confirmed: true,
    },
];
