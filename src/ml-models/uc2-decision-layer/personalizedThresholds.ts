/**
 * Personalized threshold evaluator.
 *
 * New in EHR handoff v2. Uses patient baseline data from PatientProfile to
 * compute a severity floor based on deviations from the patient's OWN baselines,
 * not just population-level hard thresholds.
 *
 * Safety rules:
 *   - This floor is ADDED to post_hitl_severity via max(), not subtracted.
 *   - It cannot suppress hard emergency alerts (those bypass this module).
 *   - EHR context does NOT add new model features — model stays 18-input.
 *   - EHR context does NOT change ae_score.
 *
 * Examples from spec:
 *   - SpO2 drop from baseline >= 4 → severity floor 1
 *   - SpO2 drop from baseline >= 6 → severity floor 2
 *   - Resting HR +25 over baseline → severity floor 1
 *   - Resting HR +40 over baseline → severity floor 2
 *   - RR +6 over baseline → severity floor 1
 *   - RR +10 over baseline → severity floor 2
 *   - care_plan_thresholds: custom per-patient threshold rules
 */

import { PERSONALIZED_THRESHOLD_RULES } from "./uc2Constants";
import type {
    CompletedFeatureVector,
    PatientProfile,
    PersonalizedThresholdResult,
    Severity,
} from "./uc2Types";

export function evaluatePersonalizedThresholds(
    features: CompletedFeatureVector,
    profile?: PatientProfile
): PersonalizedThresholdResult {
    let floor: Severity = 0;
    const reasons: string[] = [];
    let baselineDeviationScore = 0;

    const b = profile?.baseline;

    // SpO2 drop from baseline
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

    // Resting HR elevation above baseline
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

    // Respiratory rate elevation above baseline
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

    // Care-plan custom thresholds (from EHR/profile)
    for (const threshold of profile?.care_plan_thresholds ?? []) {
        const observed = features[threshold.feature];

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
