/**
 * Recurrence risk evaluator.
 *
 * New in EHR handoff v2. Scores the severity of repeated anomaly patterns
 * and produces a recurrence_severity_floor for the final post-HITL max().
 *
 * Recurrence score formula (from UC2 spec):
 *   score = same_class_count * 2
 *         + related_class_count * 1
 *         + caregiver_confirmed_count * 2
 *         + prior_severity2_count * 2
 *         + prior_severity3_count * 4
 *
 * Score → floor mapping:
 *   0–2  → no change (floor 0)
 *   3–5  → floor 1
 *   6–9  → floor 2
 *   ≥10  → floor 2 (capped at 2 for non-emergency events)
 *
 * Safety: recurrence floor caps at 2 unless emergency was already detected.
 * Emergency routing (floor 3) can only come from the rule engine.
 */

import type {
    HistoricalAnomalyEvent,
    PostHitlAnomalyType,
    RecurrenceRiskResult,
    Severity,
} from "./uc2Types";
import { areRelatedAnomalyTypes, filterRecentHistory } from "./anomalyHistory";

export function evaluateRecurrenceRisk(params: {
    patient_id: string;
    timestamp_iso: string;
    current_post_hitl_type: PostHitlAnomalyType;
    history?: HistoricalAnomalyEvent[];
    emergencyAlreadyDetected?: boolean;
}): RecurrenceRiskResult {
    const history = params.history ?? [];

    const recent = filterRecentHistory(
        history,
        params.patient_id,
        params.timestamp_iso,
        params.current_post_hitl_type
    );

    const same = recent.filter(
        (e) => e.post_hitl_anomaly_type === params.current_post_hitl_type
    );

    const related = recent.filter(
        (e) =>
            e.post_hitl_anomaly_type !== params.current_post_hitl_type &&
            areRelatedAnomalyTypes(
                e.post_hitl_anomaly_type,
                params.current_post_hitl_type
            )
    );

    const caregiverConfirmed = recent.filter((e) => e.caregiver_confirmed);
    const priorSeverity2 = recent.filter((e) => e.final_severity === 2);
    const priorSeverity3 = recent.filter((e) => e.final_severity === 3);

    const score =
        same.length * 2 +
        related.length * 1 +
        caregiverConfirmed.length * 2 +
        priorSeverity2.length * 2 +
        priorSeverity3.length * 4;

    let floor: Severity = 0;

    if (score >= 6) floor = 2;
    else if (score >= 3) floor = 1;

    // Recurrence alone cannot trigger severity 3 — only the rule engine can.
    if (!params.emergencyAlreadyDetected && floor > 2) {
        floor = 2;
    }

    const reasons: string[] = [];

    if (same.length > 0) reasons.push(`${same.length} similar recent anomaly event(s) of the same type.`);
    if (related.length > 0) reasons.push(`${related.length} related recent anomaly event(s) in the same clinical group.`);
    if (caregiverConfirmed.length > 0)
        reasons.push(`${caregiverConfirmed.length} caregiver-confirmed recent event(s).`);
    if (priorSeverity2.length > 0)
        reasons.push(`${priorSeverity2.length} prior Severity 2 event(s).`);
    if (priorSeverity3.length > 0)
        reasons.push(`${priorSeverity3.length} prior Severity 3 event(s).`);

    return {
        recurrence_risk_score: score,
        recurrence_severity_floor: floor,
        recurrence_reasons: reasons,
        same_class_count: same.length,
        related_class_count: related.length,
        caregiver_confirmed_count: caregiverConfirmed.length,
        prior_severity2_count: priorSeverity2.length,
        prior_severity3_count: priorSeverity3.length,
    };
}
