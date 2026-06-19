import {
    AppleWatchVitalsInput,
    PatientProfileDefaults,
    UC2FeatureVectorResult,
} from "./uc2Types";

import { UC2_FEATURE_ORDER } from "./uc2Constants";
import { imputeUnavailableFeatures } from "./featureImputation";

export function buildUC2FeatureVector(
    input: AppleWatchVitalsInput,
    patientProfile?: PatientProfileDefaults
): UC2FeatureVectorResult {
    const { vitals, featureQuality } = imputeUnavailableFeatures(
        input,
        patientProfile
    );

    const timestamp = new Date(input.timestamp);
    const hour = timestamp.getHours();

    const pulse_pressure =
        vitals.blood_pressure_systolic - vitals.blood_pressure_diastolic;

    const mean_arterial_pressure =
        vitals.blood_pressure_diastolic + pulse_pressure / 3;

    const hour_sin = Math.sin((2 * Math.PI * hour) / 24);
    const hour_cos = Math.cos((2 * Math.PI * hour) / 24);
    const is_sleep_window = hour >= 22 || hour <= 6 ? 1 : 0;

    featureQuality["pulse_pressure"] = "derived";
    featureQuality["mean_arterial_pressure"] = "derived";
    featureQuality["hour_sin"] = "derived";
    featureQuality["hour_cos"] = "derived";
    featureQuality["is_sleep_window"] = "derived";

    const featureMap: Record<string, number> = {
        heart_rate: vitals.heart_rate,
        blood_oxygen: vitals.blood_oxygen,
        blood_pressure_systolic: vitals.blood_pressure_systolic,
        blood_pressure_diastolic: vitals.blood_pressure_diastolic,
        glucose_level: vitals.glucose_level,
        body_temperature: vitals.body_temperature,
        respiratory_rate: vitals.respiratory_rate,
        activity_level: vitals.activity_level,
        sleep_quality: vitals.sleep_quality,
        stress_level: vitals.stress_level,
        hrv_sdnn: vitals.hrv_sdnn,
        steps_count: vitals.steps_count,
        calories_burned: vitals.calories_burned,
        pulse_pressure,
        mean_arterial_pressure,
        hour_sin,
        hour_cos,
        is_sleep_window,
    };

    const rawFeatures = UC2_FEATURE_ORDER.map((feature) => featureMap[feature]);

    return {
        rawFeatures,
        featureQuality,
        featureMap,
    };
}
