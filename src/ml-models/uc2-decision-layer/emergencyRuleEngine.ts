import { EmergencyRuleResult } from "./uc2Types";

export function runEmergencyRuleEngine(
    featureMap: Record<string, number>
): EmergencyRuleResult {
    const tempF = featureMap.body_temperature;
    const spo2 = featureMap.blood_oxygen;
    const hr = featureMap.heart_rate;
    const rr = featureMap.respiratory_rate;

    if (spo2 !== undefined && spo2 <= 88) {
        return {
            emergency: true,
            severity: 3,
            reason: "LOW_BLOOD_OXYGEN",
            pipelinePath: "RULE_ENGINE_EMERGENCY_FAST_PATH",
        };
    }

    // Fahrenheit
    if (tempF !== undefined && tempF >= 104.0) {
        return {
            emergency: true,
            severity: 3,
            reason: "HIGH_FEVER_F",
            pipelinePath: "RULE_ENGINE_EMERGENCY_FAST_PATH",
        };
    }

    if (hr !== undefined && hr >= 140) {
        return {
            emergency: true,
            severity: 3,
            reason: "EXTREME_HEART_RATE",
            pipelinePath: "RULE_ENGINE_EMERGENCY_FAST_PATH",
        };
    }

    if (rr !== undefined && rr >= 30) {
        return {
            emergency: true,
            severity: 3,
            reason: "HIGH_RESPIRATORY_RATE",
            pipelinePath: "RULE_ENGINE_EMERGENCY_FAST_PATH",
        };
    }

    return {
        emergency: false,
        severity: 0,
        reason: null,
        pipelinePath: "UC2_SLOW_PATH",
    };
}
