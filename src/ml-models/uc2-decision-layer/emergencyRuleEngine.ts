import { HARD_EMERGENCY_THRESHOLDS } from "./uc2Constants";
import type {
    CompletedFeatureVector,
    EmergencyRuleResult,
    PipelinePath,
} from "./uc2Types";

export function runEmergencyRuleEngine(
    features: CompletedFeatureVector | Record<string, number>
): EmergencyRuleResult {
    const reasons: string[] = [];
    
    const spo2 = features.blood_oxygen;
    if (spo2 !== undefined && spo2 <= HARD_EMERGENCY_THRESHOLDS.blood_oxygen_lte) {
        reasons.push(`SpO2 ${spo2} <= ${HARD_EMERGENCY_THRESHOLDS.blood_oxygen_lte}`);
    }

    const hr = features.heart_rate;
    if (hr !== undefined && hr >= HARD_EMERGENCY_THRESHOLDS.heart_rate_gte) {
        reasons.push(`Heart rate ${hr} >= ${HARD_EMERGENCY_THRESHOLDS.heart_rate_gte}`);
    }

    const rr = features.respiratory_rate;
    if (rr !== undefined && rr >= HARD_EMERGENCY_THRESHOLDS.respiratory_rate_gte) {
        reasons.push(`Respiratory rate ${rr} >= ${HARD_EMERGENCY_THRESHOLDS.respiratory_rate_gte}`);
    }

    const tempF = features.body_temperature;
    if (tempF !== undefined && tempF >= HARD_EMERGENCY_THRESHOLDS.body_temperature_f_gte) {
        reasons.push(`Body temperature ${tempF}°F >= ${HARD_EMERGENCY_THRESHOLDS.body_temperature_f_gte}°F`);
    }

    const is_emergency = reasons.length > 0;

    return {
        is_emergency,
        severity: is_emergency ? 3 : 0,
        reasons,
        
        // @compat fields for old callers
        emergency: is_emergency,
        reason: is_emergency ? reasons[0] : null,
        pipelinePath: (is_emergency ? "RULE_ENGINE_EMERGENCY_FAST_PATH" : "UC2_SLOW_PATH") as PipelinePath,
    };
}
