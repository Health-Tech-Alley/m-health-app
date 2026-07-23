import type {
    AppleWatchVitalsInput,
    CompletedFeatureVector,
    FeatureName,
    FeatureQualityTag,
    PatientProfile,
    PatientProfileDefaults,
    RawObservationInput,
    UC2FeatureVectorResult,
} from "./uc2Types";
import { FEATURE_ORDER } from "./uc2Constants";
import { imputeUnavailableFeatures, fillMissingFeatures } from "./featureImputation";

export function buildCompletedFeatureVector(
    raw: RawObservationInput,
    profile?: PatientProfile
): {
    features: CompletedFeatureVector;
    feature_vector: number[];
    feature_quality_tags: FeatureQualityTag[];
} {
    const partial: Partial<CompletedFeatureVector> = {};
    const sourceMap: Partial<Record<FeatureName, FeatureQualityTag>> = {};

    const observedFields: FeatureName[] = [
        "heart_rate",
        "blood_oxygen",
        "blood_pressure_systolic",
        "blood_pressure_diastolic",
        "glucose_level",
        "body_temperature",
        "respiratory_rate",
        "activity_level",
        "sleep_quality",
        "stress_level",
        "hrv_sdnn",
        "steps_count",
        "calories_burned",
    ];

    for (const f of observedFields) {
        const value = raw[f];
        if (typeof value === "number") {
            partial[f] = value;
            sourceMap[f] = {
                feature: f,
                value,
                source: inferObservedSource(f),
            };
        }
    }

    if (
        typeof partial.blood_pressure_systolic === "number" &&
        typeof partial.blood_pressure_diastolic === "number"
    ) {
        partial.pulse_pressure =
            partial.blood_pressure_systolic - partial.blood_pressure_diastolic;

        partial.mean_arterial_pressure =
            partial.blood_pressure_diastolic +
            partial.pulse_pressure / 3;

        sourceMap.pulse_pressure = {
            feature: "pulse_pressure",
            value: partial.pulse_pressure,
            source: "derived",
        };

        sourceMap.mean_arterial_pressure = {
            feature: "mean_arterial_pressure",
            value: partial.mean_arterial_pressure,
            source: "derived",
        };
    }

    const hour = new Date(raw.timestamp_iso).getHours();
    partial.hour_sin = Math.sin((2 * Math.PI * hour) / 24);
    partial.hour_cos = Math.cos((2 * Math.PI * hour) / 24);
    partial.is_sleep_window = hour >= 22 || hour <= 6 ? 1 : 0;

    sourceMap.hour_sin = {
        feature: "hour_sin",
        value: partial.hour_sin,
        source: "derived",
    };

    sourceMap.hour_cos = {
        feature: "hour_cos",
        value: partial.hour_cos,
        source: "derived",
    };

    sourceMap.is_sleep_window = {
        feature: "is_sleep_window",
        value: partial.is_sleep_window,
        source: "derived",
    };

    const filled = fillMissingFeatures(partial, sourceMap, profile);

    return {
        features: filled.features,
        feature_vector: FEATURE_ORDER.map((f) => filled.features[f]),
        feature_quality_tags: filled.feature_quality_tags,
    };
}

function inferObservedSource(feature: FeatureName): FeatureQualityTag["source"] {
    if (
        [
            "heart_rate",
            "blood_oxygen",
            "respiratory_rate",
            "activity_level",
            "sleep_quality",
            "hrv_sdnn",
            "steps_count",
            "calories_burned",
        ].includes(feature)
    ) {
        return "observed_watch";
    }

    return "observed_manual";
}

// @compat Old function preserved
export function buildUC2FeatureVector(
    input: AppleWatchVitalsInput,
    patientProfile?: PatientProfileDefaults
): UC2FeatureVectorResult {
    // Under the hood we use the old logic exactly to ensure parity.ts tests don't break,
    // though the new system will rely on buildCompletedFeatureVector instead.
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

    const rawFeatures = FEATURE_ORDER.map((feature) => featureMap[feature]);

    return {
        rawFeatures,
        featureQuality,
        featureMap,
    };
}
