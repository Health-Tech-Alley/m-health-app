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
import { FEATURE_ORDER, UC2_FEATURE_ORDER } from "./uc2Constants";
import { imputeUnavailableFeatures, fillMissingFeatures } from "./featureImputation";

/**
 * Build the Watch12 12-dimensional completed feature vector from raw observation input.
 *
 * Watch-native AE features only:
 *   heart_rate, blood_oxygen, respiratory_rate, hrv_sdnn, body_temperature,
 *   activity_level, steps_count, calories_burned, sleep_quality,
 *   hour_sin, hour_cos, is_sleep_window
 *
 * BP, glucose, pulse_pressure, mean_arterial_pressure, and stress_level
 * are explicitly EXCLUDED from the AE feature vector. They are available
 * on RawObservationInput for external-measurement rules only.
 */
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

    // Watch-native directly observed fields (AE features only — no BP/glucose/stress)
    const observedFields: FeatureName[] = [
        "heart_rate",
        "blood_oxygen",
        "body_temperature",
        "respiratory_rate",
        "activity_level",
        "sleep_quality",
        "hrv_sdnn",
        "steps_count",
        "calories_burned",
    ];

    for (const f of observedFields) {
        let value = (raw as Record<string, unknown>)[f];
        if (typeof value !== "number") continue;

        // HealthKit SpO2 normalization:
        // HealthKit may return fractional SpO2 (e.g., 0.98 instead of 98).
        // If blood_oxygen is in (0, 1], multiply by 100 to get percentage.
        if (f === "blood_oxygen" && value > 0 && value <= 1) {
            value = value * 100;
        }

        partial[f] = value;
        sourceMap[f] = {
            feature: f,
            value,
            source: inferObservedSource(f),
        };
    }

    // Derive time features from timestamp
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

    // Fill any remaining Watch12 AE features via imputation
    // (EHR profile baselines for HR/SpO2/RR/temp/HRV only — not BP/glucose)
    const filled = fillMissingFeatures(partial, sourceMap, profile);

    if (filled.feature_vector.length !== 12) {
        throw new Error(
            `[Watch12] buildCompletedFeatureVector produced ${filled.feature_vector.length} features, expected 12. This is a programming error.`
        );
    }

    return {
        features: filled.features,
        feature_vector: filled.feature_vector,
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

// ── @compat Legacy 18D path (DO NOT USE in production AE scoring) ─────────────

/**
 * @deprecated Legacy 18-feature vector builder for the v1 compat path.
 * MUST NOT be used for Watch12 AE scoring, scaler, or tfliteModelAdapter.
 * Used only by: runUC2DecisionLayer (v1), parity.ts.
 * BP/glucose/stress/pulse_pressure/MAP are included in this path.
 */
export function buildUC2FeatureVector(
    input: AppleWatchVitalsInput,
    patientProfile?: PatientProfileDefaults
): UC2FeatureVectorResult {
    // Under the hood we use the old logic exactly to ensure parity.ts tests don't break,
    // though the new Watch12 system relies on buildCompletedFeatureVector instead.
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
