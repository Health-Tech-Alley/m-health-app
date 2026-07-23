import {
    AppleWatchVitalsInput,
    PatientProfileDefaults,
    FeatureQuality,
    CompletedFeatureVector,
    FeatureName,
    FeatureQualityTag,
    PatientProfile,
} from "./uc2Types";

import { DEFAULT_PATIENT_PROFILE, DEFAULT_FEATURE_VALUES, FEATURE_ORDER } from "./uc2Constants";

export function fillMissingFeatures(
    partial: Partial<CompletedFeatureVector>,
    sourceMap: Partial<Record<FeatureName, FeatureQualityTag>>,
    profile?: PatientProfile
): {
    features: CompletedFeatureVector;
    feature_quality_tags: FeatureQualityTag[];
} {
    const completed = {} as CompletedFeatureVector;
    const tags: FeatureQualityTag[] = [];

    for (const feature of FEATURE_ORDER) {
        if (typeof partial[feature] === "number") {
            const value = partial[feature]!;
            completed[feature] = value;
            tags.push(
                sourceMap[feature] ?? {
                    feature,
                    value,
                    source: "observed_device",
                }
            );
            continue;
        }

        const baselineValue = baselineForFeature(feature, profile);

        if (typeof baselineValue === "number") {
            completed[feature] = baselineValue;
            tags.push({
                feature,
                value: baselineValue,
                source: "ehr_profile",
                warning: "Filled from EHR/profile baseline; not directly observed at event time.",
            });
            continue;
        }

        const fallback = DEFAULT_FEATURE_VALUES[feature];
        completed[feature] = fallback;
        tags.push({
            feature,
            value: fallback,
            source: "imputed_default",
            warning: "Imputed default used; confidence should be reduced.",
        });
    }

    return {
        features: completed,
        feature_quality_tags: tags,
    };
}

function baselineForFeature(
    feature: FeatureName,
    profile?: PatientProfile
): number | undefined {
    const b = profile?.baseline;
    if (!b) return undefined;

    switch (feature) {
        case "heart_rate":
            return b.resting_heart_rate;
        case "blood_oxygen":
            return b.blood_oxygen;
        case "respiratory_rate":
            return b.respiratory_rate;
        case "body_temperature":
            return b.body_temperature;
        case "blood_pressure_systolic":
            return b.systolic_bp;
        case "blood_pressure_diastolic":
            return b.diastolic_bp;
        case "glucose_level":
            return b.glucose_level;
        case "hrv_sdnn":
            return b.hrv_sdnn;
        default:
            return undefined;
    }
}

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

// @compat Old function preserved
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
            // @compat Uses old "observed"
            featureQuality[key] = "observed" as FeatureQuality;
            return value;
        }

        // @compat Uses old "imputed"
        featureQuality[key] = "imputed" as FeatureQuality;
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
