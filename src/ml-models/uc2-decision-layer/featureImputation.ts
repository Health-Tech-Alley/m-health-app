import {
    AppleWatchVitalsInput,
    PatientProfileDefaults,
    FeatureQuality,
} from "./uc2Types";

import { DEFAULT_PATIENT_PROFILE } from "./uc2Constants";

type ImputedVitals = Required<
    Pick<
        AppleWatchVitalsInput,
        | "heart_rate"
        | "blood_oxygen"
        | "blood_pressure_systolic"
        | "blood_pressure_diastolic"
        | "glucose_level"
        | "body_temperature"
        | "respiratory_rate"
        | "activity_level"
        | "sleep_quality"
        | "stress_level"
        | "hrv_sdnn"
        | "steps_count"
        | "calories_burned"
    >
>;

export function imputeUnavailableFeatures(
    input: AppleWatchVitalsInput,
    patientProfile: PatientProfileDefaults = DEFAULT_PATIENT_PROFILE
): {
    vitals: ImputedVitals;
    featureQuality: Record<string, FeatureQuality>;
} {
    const featureQuality: Record<string, FeatureQuality> = {};

    function observedOrImputed(
        key: keyof ImputedVitals,
        value: number | undefined,
        fallback: number
    ): number {
        if (value !== undefined && value !== null && Number.isFinite(value)) {
            featureQuality[key] = "observed";
            return value;
        }

        featureQuality[key] = "imputed";
        return fallback;
    }

    const vitals: ImputedVitals = {
        heart_rate: observedOrImputed("heart_rate", input.heart_rate, 75),
        blood_oxygen: observedOrImputed("blood_oxygen", input.blood_oxygen, 97),

        blood_pressure_systolic: observedOrImputed(
            "blood_pressure_systolic",
            input.blood_pressure_systolic,
            patientProfile.blood_pressure_systolic ?? DEFAULT_PATIENT_PROFILE.blood_pressure_systolic
        ),

        blood_pressure_diastolic: observedOrImputed(
            "blood_pressure_diastolic",
            input.blood_pressure_diastolic,
            patientProfile.blood_pressure_diastolic ?? DEFAULT_PATIENT_PROFILE.blood_pressure_diastolic
        ),

        glucose_level: observedOrImputed(
            "glucose_level",
            input.glucose_level,
            patientProfile.glucose_level ?? DEFAULT_PATIENT_PROFILE.glucose_level
        ),

        body_temperature: observedOrImputed(
            "body_temperature",
            input.body_temperature,
            patientProfile.body_temperature ?? DEFAULT_PATIENT_PROFILE.body_temperature
        ),

        respiratory_rate: observedOrImputed(
            "respiratory_rate",
            input.respiratory_rate,
            16
        ),

        activity_level: observedOrImputed(
            "activity_level",
            input.activity_level,
            patientProfile.activity_level ?? DEFAULT_PATIENT_PROFILE.activity_level
        ),

        sleep_quality: observedOrImputed("sleep_quality", input.sleep_quality, 70),

        stress_level: observedOrImputed(
            "stress_level",
            input.stress_level,
            patientProfile.stress_level ?? DEFAULT_PATIENT_PROFILE.stress_level
        ),

        hrv_sdnn: observedOrImputed("hrv_sdnn", input.hrv_sdnn, 45),
        steps_count: observedOrImputed("steps_count", input.steps_count, 0),
        calories_burned: observedOrImputed(
            "calories_burned",
            input.calories_burned,
            0
        ),
    };

    return {
        vitals,
        featureQuality,
    };
}
