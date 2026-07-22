/**
 * Personalized threshold evaluator (Watch12).
 *
 * Computes a severity floor based on deviations from the patient's own baselines
 * and external measurements. Works outside the 12D AE tensor.
 *
 * Safety rules:
 *   - This floor is ADDED to post_hitl_severity via max(), not subtracted.
 *   - It cannot suppress hard emergency alerts (those bypass this module).
 *   - EHR context does NOT add AE model features — AE stays 12-input Watch-native.
 *   - EHR context does NOT change ae_score or reconstruction error.
 *   - BP/glucose are resolved from ExternalMeasurements, NOT from CompletedFeatureVector.
 *   - Missing EHR BP must NOT create AE feature-quality warnings.
 *
 * Watch12 AE baseline deviation checks (from CompletedFeatureVector):
 *   - SpO2 drop from baseline >= 4 → severity floor 1
 *   - SpO2 drop from baseline >= 6 → severity floor 2
 *   - Resting HR +25 over baseline → severity floor 1
 *   - Resting HR +40 over baseline → severity floor 2
 *   - RR +6 over baseline → severity floor 1
 *   - RR +10 over baseline → severity floor 2
 *
 * External measurement checks (from ExternalMeasurements, outside AE):
 *   - Systolic BP >= 170 mmHg → severity floor 2
 *   - Diastolic BP >= 110 mmHg → severity floor 2
 *
 * Care-plan thresholds:
 *   - AE feature rules: resolved from CompletedFeatureVector
 *   - External measurement rules: resolved from ExternalMeasurements
 */

import { PERSONALIZED_THRESHOLD_RULES, EXTERNAL_MEASUREMENT_RULES } from "./uc2Constants";
import type {
    CompletedFeatureVector,
    ExternalMeasurements,
    PatientProfile,
    PersonalizedThresholdResult,
    Severity,
    ThresholdFeatureName,
    ExternalMeasurementName,
} from "./uc2Types";

/** Names that are external measurements (outside AE feature vector). */
const EXTERNAL_MEASUREMENT_NAMES: ReadonlySet<string> = new Set<ExternalMeasurementName>([
    "blood_pressure_systolic",
    "blood_pressure_diastolic",
    "glucose_level",
]);

export function evaluatePersonalizedThresholds(
    features: CompletedFeatureVector,
    profile?: PatientProfile,
    external?: ExternalMeasurements
): PersonalizedThresholdResult {
    let floor: Severity = 0;
    const reasons: string[] = [];
    let baselineDeviationScore = 0;

    const b = profile?.baseline;

    // ── SpO2 drop from baseline (AE feature) ─────────────────────────────────
    if (b?.blood_oxygen !== undefined) {
        const drop = b.blood_oxygen - features.blood_oxygen;

        if (drop >= PERSONALIZED_THRESHOLD_RULES.spo2_drop_floor2) {
            floor = maxSeverity(floor, 2);
            reasons.push(`SpO2 dropped ${drop.toFixed(1)} below patient baseline (${b.blood_oxygen}%).`);
        } else if (drop >= PERSONALIZED_THRESHOLD_RULES.spo2_drop_floor1) {
            floor = maxSeverity(floor, 1);
            reasons.push(`Mild SpO2 drop ${drop.toFixed(1)} below patient baseline (${b.blood_oxygen}%).`);
        }

        baselineDeviationScore += Math.max(0, drop);
    }

    // ── Resting HR elevation (AE feature) ────────────────────────────────────
    if (b?.resting_heart_rate !== undefined) {
        const delta = features.heart_rate - b.resting_heart_rate;

        if (delta >= PERSONALIZED_THRESHOLD_RULES.resting_hr_delta_floor2) {
            floor = maxSeverity(floor, 2);
            reasons.push(`Heart rate ${delta.toFixed(1)} bpm above patient resting baseline (${b.resting_heart_rate} bpm).`);
        } else if (delta >= PERSONALIZED_THRESHOLD_RULES.resting_hr_delta_floor1) {
            floor = maxSeverity(floor, 1);
            reasons.push(`Mild HR elevation ${delta.toFixed(1)} bpm above patient baseline (${b.resting_heart_rate} bpm).`);
        }

        baselineDeviationScore += Math.max(0, delta / 10);
    }

    // ── RR elevation above baseline (AE feature) ─────────────────────────────
    if (b?.respiratory_rate !== undefined) {
        const delta = features.respiratory_rate - b.respiratory_rate;

        if (delta >= PERSONALIZED_THRESHOLD_RULES.rr_delta_floor2) {
            floor = maxSeverity(floor, 2);
            reasons.push(`Respiratory rate ${delta.toFixed(1)} above patient baseline (${b.respiratory_rate}/min).`);
        } else if (delta >= PERSONALIZED_THRESHOLD_RULES.rr_delta_floor1) {
            floor = maxSeverity(floor, 1);
            reasons.push(`Mild RR elevation ${delta.toFixed(1)} above patient baseline (${b.respiratory_rate}/min).`);
        }

        baselineDeviationScore += Math.max(0, delta);
    }

    // ── External BP rule (OUTSIDE AE — from ExternalMeasurements) ────────────
    if (external) {
        const sys = external.blood_pressure_systolic;
        const dia = external.blood_pressure_diastolic;

        if (
            (sys !== undefined && sys >= EXTERNAL_MEASUREMENT_RULES.systolic_bp_gte_severity2) ||
            (dia !== undefined && dia >= EXTERNAL_MEASUREMENT_RULES.diastolic_bp_gte_severity2)
        ) {
            floor = maxSeverity(floor, 2);
            const bpStr = [
                sys !== undefined ? `${sys} mmHg systolic` : null,
                dia !== undefined ? `${dia} mmHg diastolic` : null,
            ]
                .filter(Boolean)
                .join(", ");
            reasons.push(
                `External BP measurement elevated (${bpStr}): ` +
                `at or above ${EXTERNAL_MEASUREMENT_RULES.systolic_bp_gte_severity2}/${EXTERNAL_MEASUREMENT_RULES.diastolic_bp_gte_severity2} mmHg threshold.`
            );
        }
    }

    // ── Care-plan custom thresholds ───────────────────────────────────────────
    // AE features: resolved from CompletedFeatureVector
    // External measurement features: resolved from ExternalMeasurements
    for (const threshold of profile?.care_plan_thresholds ?? []) {
        const featureName: ThresholdFeatureName = threshold.feature;
        let observed: number | undefined;

        if (EXTERNAL_MEASUREMENT_NAMES.has(featureName)) {
            // Resolve from external measurements — NOT from AE feature vector
            observed = external?.[featureName as ExternalMeasurementName];
        } else {
            // Resolve from the 12D AE CompletedFeatureVector
            observed = features[featureName as keyof CompletedFeatureVector];
        }

        if (observed === undefined) continue;

        let triggered = false;
        if (threshold.operator === "gte") triggered = observed >= threshold.value;
        if (threshold.operator === "lte") triggered = observed <= threshold.value;
        // delta_gte / delta_lte require baseline values — handled by callers
        // who pre-compute the delta and pass it as a care_plan_threshold value.

        if (triggered) {
            floor = maxSeverity(floor, threshold.severity_floor);
            reasons.push(`Care-plan threshold triggered: ${threshold.reason}`);
        }
    }

    return {
        personalized_threshold_severity_floor: floor,
        personalized_threshold_reasons: reasons,
        baseline_deviation_score: Number(baselineDeviationScore.toFixed(3)),
    };
}

function maxSeverity(a: Severity, b: Severity): Severity {
    return Math.max(a, b) as Severity;
}
