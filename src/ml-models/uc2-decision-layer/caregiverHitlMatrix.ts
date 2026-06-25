/**
 * Caregiver HITL observation matrix.
 *
 * New in EHR handoff v2: replaces the old flat severity-floor lookup with a
 * 13-observation × 7-anomaly-family matrix. Each cell defines:
 *   - severity_delta: how much to raise the severity floor (0–3)
 *   - critical_route: whether this cell should trigger emergency routing
 *   - reason: human-readable rationale for audit trail
 *
 * Safety rules (enforced by evaluateCaregiverObservationMatrix):
 *   - SENSOR_OR_WATCH_ISSUE: never downgrades severity; adds quality warning only.
 *   - NOTHING_UNUSUAL_NOTICED: no downgrade; only affects audit/context.
 *   - EXERCISE_OR_ACTIVITY: explains exertion patterns; avoids unnecessary escalation.
 *   - Hard emergency thresholds cannot be suppressed by any matrix cell.
 *
 * Key matrix expectations (per UC2 spec):
 *   - BREATHING_DIFFERENT + CARDIO_RESPIRATORY → max_matrix_delta = 3
 *   - VOMITING_OR_DIARRHEA + GI_AUTONOMIC → max_matrix_delta = 3
 *   - WEAK_CONFUSED_NOT_BASELINE + SEIZURE_LIKE → max_matrix_delta = 3
 */

import type {
    AnomalyFamily,
    CaregiverMatrixCell,
    CaregiverMatrixEvaluation,
    CaregiverObservationCode,
    PostHitlAnomalyType,
    SensorAnomalyType,
} from "./uc2Types";

// ── Sensor type → anomaly family mapping ─────────────────────────────────────

export function mapSensorTypeToAnomalyFamily(
    sensorType: SensorAnomalyType
): AnomalyFamily {
    switch (sensorType) {
        case "CARDIO_RESPIRATORY_SIGNAL_CHANGE":
            return "CARDIO_RESPIRATORY";

        case "UNEXPLAINED_PHYSIOLOGIC_STRESS":
            return "GI_AUTONOMIC";

        case "SLEEP_RECOVERY_DEVIATION":
            return "SLEEP_RECOVERY";

        case "EXERTION_OR_ACTIVITY_PATTERN":
            return "EXERTION_ACTIVITY";

        case "POSSIBLE_SEIZURE_LIKE_MOTION":
            return "SEIZURE_LIKE";

        case "CRITICAL_VITAL_THRESHOLD":
            return "CRITICAL_VITAL";

        case "NORMAL_PATTERN":
        case "POSSIBLE_SENSOR_ARTIFACT":
        case "INSUFFICIENT_DATA":
        default:
            return "NORMAL_OR_UNKNOWN";
    }
}

export function mapPostHitlTypeToAnomalyFamily(
    postHitlType: PostHitlAnomalyType
): AnomalyFamily {
    switch (postHitlType) {
        case "RESPIRATORY_CONCERN":
            return "CARDIO_RESPIRATORY";

        case "GI_AUTONOMIC_RISK":
        case "MEDICATION_ADHERENCE_CONCERN":
            return "GI_AUTONOMIC";

        case "SLEEP_STRESS_RECOVERY":
            return "SLEEP_RECOVERY";

        case "EXERTION_LIKE_PATTERN":
            return "EXERTION_ACTIVITY";

        case "POSTICTAL_RECOVERY_CONCERN":
        case "SEIZURE_LIKE_EVENT_CONFIRMED":
            return "SEIZURE_LIKE";

        case "CRITICAL_EMERGENCY_ALERT":
            return "CRITICAL_VITAL";

        default:
            return "NORMAL_OR_UNKNOWN";
    }
}

// ── 13 × 7 caregiver observation matrix ──────────────────────────────────────

/**
 * severity_delta meaning:
 *   +0 = no severity increase from this observation
 *   +1 = mild contextual concern
 *   +2 = meaningful concern / likely follow-up
 *   +3 = high concern; may route critical depending on family
 *
 * critical_route:
 *   none = do not route critical from this cell
 *   route_critical = observation is urgent in this anomaly family
 *   route_critical_if_severe_dehydration_or_altered_state =
 *       route critical only when paired with altered state or severe dehydration
 */
export const CAREGIVER_OBSERVATION_MATRIX: Record<
    CaregiverObservationCode,
    Record<AnomalyFamily, CaregiverMatrixCell>
> = {
    EXERCISE_OR_ACTIVITY: {
        CARDIO_RESPIRATORY: { severity_delta: 0, critical_route: "none", reason: "Activity may explain some cardio-respiratory change; no escalation applied." },
        GI_AUTONOMIC: { severity_delta: 0, critical_route: "none", reason: "Activity context does not increase GI/autonomic concern." },
        SLEEP_RECOVERY: { severity_delta: 0, critical_route: "none", reason: "Activity context does not increase sleep/recovery concern." },
        EXERTION_ACTIVITY: { severity_delta: 0, critical_route: "none", reason: "Observation matches exertion/activity pattern; no additional escalation." },
        SEIZURE_LIKE: { severity_delta: 0, critical_route: "none", reason: "Activity alone does not increase seizure-like concern." },
        CRITICAL_VITAL: { severity_delta: 0, critical_route: "none", reason: "Activity does not suppress critical vital thresholds." },
        NORMAL_OR_UNKNOWN: { severity_delta: 0, critical_route: "none", reason: "Activity context logged." },
    },

    POOR_SLEEP: {
        CARDIO_RESPIRATORY: { severity_delta: 1, critical_route: "none", reason: "Poor sleep may contribute to physiologic stress with cardio-respiratory change." },
        GI_AUTONOMIC: { severity_delta: 1, critical_route: "none", reason: "Poor sleep adds mild concern to unexplained physiologic stress." },
        SLEEP_RECOVERY: { severity_delta: 2, critical_route: "none", reason: "Poor sleep directly supports sleep/recovery deviation." },
        EXERTION_ACTIVITY: { severity_delta: 0, critical_route: "none", reason: "Poor sleep does not increase exertion/activity pattern severity." },
        SEIZURE_LIKE: { severity_delta: 1, critical_route: "none", reason: "Poor sleep may increase caution around seizure-like motion context." },
        CRITICAL_VITAL: { severity_delta: 0, critical_route: "none", reason: "Poor sleep does not alter critical vital routing." },
        NORMAL_OR_UNKNOWN: { severity_delta: 0, critical_route: "none", reason: "Poor sleep logged without active anomaly family." },
    },

    STRESS_OR_EMOTIONAL_UPSET: {
        CARDIO_RESPIRATORY: { severity_delta: 1, critical_route: "none", reason: "Stress may contribute to cardio-respiratory signal change." },
        GI_AUTONOMIC: { severity_delta: 1, critical_route: "none", reason: "Stress may contribute to unexplained physiologic stress." },
        SLEEP_RECOVERY: { severity_delta: 1, critical_route: "none", reason: "Stress may contribute to sleep/recovery deviation." },
        EXERTION_ACTIVITY: { severity_delta: 0, critical_route: "none", reason: "Stress does not increase exertion/activity pattern severity." },
        SEIZURE_LIKE: { severity_delta: 1, critical_route: "none", reason: "Stress context increases caution for seizure-like motion." },
        CRITICAL_VITAL: { severity_delta: 0, critical_route: "none", reason: "Stress does not alter critical vital routing." },
        NORMAL_OR_UNKNOWN: { severity_delta: 0, critical_route: "none", reason: "Stress context logged." },
    },

    REDUCED_INTAKE: {
        CARDIO_RESPIRATORY: { severity_delta: 1, critical_route: "none", reason: "Reduced intake adds mild concern with cardio-respiratory change." },
        GI_AUTONOMIC: { severity_delta: 2, critical_route: "none", reason: "Reduced intake supports GI/autonomic risk." },
        SLEEP_RECOVERY: { severity_delta: 1, critical_route: "none", reason: "Reduced intake may worsen recovery pattern." },
        EXERTION_ACTIVITY: { severity_delta: 0, critical_route: "none", reason: "Reduced intake does not increase exertion/activity pattern alone." },
        SEIZURE_LIKE: { severity_delta: 1, critical_route: "none", reason: "Reduced intake adds caution for seizure-like context." },
        CRITICAL_VITAL: { severity_delta: 0, critical_route: "none", reason: "Reduced intake does not alter critical vital routing." },
        NORMAL_OR_UNKNOWN: { severity_delta: 1, critical_route: "none", reason: "Reduced intake is clinically relevant caregiver context." },
    },

    MEDICATION_CHANGE_OR_MISSED: {
        CARDIO_RESPIRATORY: { severity_delta: 2, critical_route: "none", reason: "Medication change/missed dose is significant with cardio-respiratory change." },
        GI_AUTONOMIC: { severity_delta: 2, critical_route: "none", reason: "Medication change/missed dose supports GI/autonomic or systemic concern." },
        SLEEP_RECOVERY: { severity_delta: 1, critical_route: "none", reason: "Medication change/missed dose may affect sleep/recovery." },
        EXERTION_ACTIVITY: { severity_delta: 0, critical_route: "none", reason: "Medication change does not increase exertion/activity pattern alone." },
        SEIZURE_LIKE: { severity_delta: 2, critical_route: "none", reason: "Medication change/missed dose is significant in seizure-like context." },
        CRITICAL_VITAL: { severity_delta: 0, critical_route: "none", reason: "Medication context does not suppress critical vital routing." },
        NORMAL_OR_UNKNOWN: { severity_delta: 1, critical_route: "none", reason: "Medication change/missed dose logged as relevant context." },
    },

    BATHROOM_CHANGES: {
        CARDIO_RESPIRATORY: { severity_delta: 1, critical_route: "none", reason: "Bathroom changes add mild concern with cardio-respiratory change." },
        GI_AUTONOMIC: { severity_delta: 2, critical_route: "none", reason: "Bathroom changes support GI/autonomic risk." },
        SLEEP_RECOVERY: { severity_delta: 0, critical_route: "none", reason: "Bathroom changes do not directly increase sleep/recovery severity." },
        EXERTION_ACTIVITY: { severity_delta: 0, critical_route: "none", reason: "Bathroom changes do not increase exertion/activity pattern severity." },
        SEIZURE_LIKE: { severity_delta: 1, critical_route: "none", reason: "Bathroom changes add mild concern in seizure-like context." },
        CRITICAL_VITAL: { severity_delta: 0, critical_route: "none", reason: "Bathroom changes do not alter critical vital routing." },
        NORMAL_OR_UNKNOWN: { severity_delta: 1, critical_route: "none", reason: "Bathroom changes logged as relevant context." },
    },

    VOMITING_OR_DIARRHEA: {
        CARDIO_RESPIRATORY: { severity_delta: 1, critical_route: "none", reason: "Vomiting/diarrhea adds concern with cardio-respiratory change." },
        GI_AUTONOMIC: { severity_delta: 3, critical_route: "none", reason: "Vomiting/diarrhea strongly supports GI/autonomic risk." },
        SLEEP_RECOVERY: { severity_delta: 1, critical_route: "none", reason: "Vomiting/diarrhea may worsen recovery pattern." },
        EXERTION_ACTIVITY: { severity_delta: 0, critical_route: "none", reason: "Vomiting/diarrhea does not increase exertion/activity pattern alone." },
        SEIZURE_LIKE: { severity_delta: 2, critical_route: "none", reason: "Vomiting/diarrhea is concerning in seizure-like context." },
        CRITICAL_VITAL: { severity_delta: 0, critical_route: "route_critical_if_severe_dehydration_or_altered_state", reason: "Vomiting/diarrhea with critical vital threshold may require urgent action if severe dehydration or altered state is present." },
        NORMAL_OR_UNKNOWN: { severity_delta: 1, critical_route: "none", reason: "Vomiting/diarrhea logged as relevant symptom context." },
    },

    WEAK_CONFUSED_NOT_BASELINE: {
        CARDIO_RESPIRATORY: { severity_delta: 2, critical_route: "none", reason: "Weak/confused/not baseline is significant with cardio-respiratory change." },
        GI_AUTONOMIC: { severity_delta: 2, critical_route: "none", reason: "Weak/confused/not baseline is significant with GI/autonomic risk." },
        SLEEP_RECOVERY: { severity_delta: 2, critical_route: "none", reason: "Weak/confused/not baseline increases sleep/recovery concern." },
        EXERTION_ACTIVITY: { severity_delta: 1, critical_route: "none", reason: "Weak/confused/not baseline adds concern even if pattern appears exertional." },
        SEIZURE_LIKE: { severity_delta: 3, critical_route: "none", reason: "Weak/confused/not baseline strongly increases seizure-like event concern." },
        CRITICAL_VITAL: { severity_delta: 0, critical_route: "route_critical", reason: "Altered state with critical vital threshold should route critical." },
        NORMAL_OR_UNKNOWN: { severity_delta: 2, critical_route: "none", reason: "Weak/confused/not baseline is significant caregiver concern." },
    },

    PAIN_OR_DISCOMFORT: {
        CARDIO_RESPIRATORY: { severity_delta: 1, critical_route: "none", reason: "Pain/discomfort adds mild concern with cardio-respiratory change." },
        GI_AUTONOMIC: { severity_delta: 2, critical_route: "none", reason: "Pain/discomfort supports GI/autonomic or systemic concern." },
        SLEEP_RECOVERY: { severity_delta: 1, critical_route: "none", reason: "Pain/discomfort may affect sleep/recovery." },
        EXERTION_ACTIVITY: { severity_delta: 0, critical_route: "none", reason: "Pain/discomfort does not increase exertion/activity pattern alone." },
        SEIZURE_LIKE: { severity_delta: 1, critical_route: "none", reason: "Pain/discomfort adds mild concern in seizure-like context." },
        CRITICAL_VITAL: { severity_delta: 0, critical_route: "none", reason: "Pain/discomfort does not alter critical vital routing." },
        NORMAL_OR_UNKNOWN: { severity_delta: 1, critical_route: "none", reason: "Pain/discomfort logged as relevant context." },
    },

    BREATHING_DIFFERENT: {
        CARDIO_RESPIRATORY: { severity_delta: 3, critical_route: "none", reason: "Breathing different strongly supports respiratory concern." },
        GI_AUTONOMIC: { severity_delta: 2, critical_route: "none", reason: "Breathing different increases concern with GI/autonomic risk." },
        SLEEP_RECOVERY: { severity_delta: 1, critical_route: "none", reason: "Breathing different adds concern to sleep/recovery deviation." },
        EXERTION_ACTIVITY: { severity_delta: 1, critical_route: "none", reason: "Breathing different adds concern even when pattern appears exertional." },
        SEIZURE_LIKE: { severity_delta: 3, critical_route: "none", reason: "Breathing different strongly increases seizure-like event concern." },
        CRITICAL_VITAL: { severity_delta: 0, critical_route: "route_critical", reason: "Breathing different with critical vital threshold should route critical." },
        NORMAL_OR_UNKNOWN: { severity_delta: 2, critical_route: "none", reason: "Breathing different is significant caregiver concern." },
    },

    SENSOR_OR_WATCH_ISSUE: {
        // All deltas are 0 — sensor issue never raises OR lowers severity.
        // It adds a data_quality_warning flag and recheck recommendation instead.
        CARDIO_RESPIRATORY: { severity_delta: 0, critical_route: "none", reason: "Sensor issue reported; recommend recheck but do not downgrade automatically." },
        GI_AUTONOMIC: { severity_delta: 0, critical_route: "none", reason: "Sensor issue reported; maintain audit and recheck behavior." },
        SLEEP_RECOVERY: { severity_delta: 0, critical_route: "none", reason: "Sensor issue reported; sleep/recovery interpretation may have lower confidence." },
        EXERTION_ACTIVITY: { severity_delta: 0, critical_route: "none", reason: "Sensor issue reported during activity context." },
        SEIZURE_LIKE: { severity_delta: 0, critical_route: "none", reason: "Sensor issue reported; do not suppress seizure-like concern automatically." },
        CRITICAL_VITAL: { severity_delta: 0, critical_route: "none", reason: "Sensor issue cannot suppress critical vital threshold." },
        NORMAL_OR_UNKNOWN: { severity_delta: 0, critical_route: "none", reason: "Sensor issue logged." },
    },

    NOTHING_UNUSUAL_NOTICED: {
        // All deltas are 0 — 'nothing unusual' does not downgrade AE anomaly.
        // Only affects audit/context notes.
        CARDIO_RESPIRATORY: { severity_delta: 0, critical_route: "none", reason: "Nothing unusual noticed; no downgrade applied to ML anomaly." },
        GI_AUTONOMIC: { severity_delta: 0, critical_route: "none", reason: "Nothing unusual noticed; no downgrade applied." },
        SLEEP_RECOVERY: { severity_delta: 0, critical_route: "none", reason: "Nothing unusual noticed; no downgrade applied." },
        EXERTION_ACTIVITY: { severity_delta: 0, critical_route: "none", reason: "Nothing unusual noticed; no downgrade applied." },
        SEIZURE_LIKE: { severity_delta: 0, critical_route: "none", reason: "Nothing unusual noticed; no downgrade applied." },
        CRITICAL_VITAL: { severity_delta: 0, critical_route: "none", reason: "Nothing unusual noticed cannot suppress critical vital threshold." },
        NORMAL_OR_UNKNOWN: { severity_delta: 0, critical_route: "none", reason: "No observed caregiver concern." },
    },

    NOT_SURE: {
        CARDIO_RESPIRATORY: { severity_delta: 1, critical_route: "none", reason: "Caregiver unsure; maintain caution with cardio-respiratory signal change." },
        GI_AUTONOMIC: { severity_delta: 1, critical_route: "none", reason: "Caregiver unsure; maintain caution with unexplained physiologic stress." },
        SLEEP_RECOVERY: { severity_delta: 0, critical_route: "none", reason: "Caregiver unsure; no added severity for isolated sleep/recovery deviation." },
        EXERTION_ACTIVITY: { severity_delta: 0, critical_route: "none", reason: "Caregiver unsure; no added severity for exertion/activity pattern." },
        SEIZURE_LIKE: { severity_delta: 1, critical_route: "none", reason: "Caregiver unsure; maintain caution for seizure-like context." },
        CRITICAL_VITAL: { severity_delta: 0, critical_route: "none", reason: "Uncertainty does not alter critical vital routing." },
        NORMAL_OR_UNKNOWN: { severity_delta: 0, critical_route: "none", reason: "Caregiver unsure without active anomaly family." },
    },
};

// ── Matrix evaluator ──────────────────────────────────────────────────────────

export function evaluateCaregiverObservationMatrix(params: {
    selected_codes: CaregiverObservationCode[];
    sensor_anomaly_type: SensorAnomalyType;
}): CaregiverMatrixEvaluation {
    const anomalyFamily = mapSensorTypeToAnomalyFamily(params.sensor_anomaly_type);

    let maxDelta: 0 | 1 | 2 | 3 = 0;
    const matrixReasons: string[] = [];
    const criticalRouteReasons: string[] = [];
    let criticalRouteTriggered = false;

    const selected = params.selected_codes;

    for (const code of selected) {
        const cell = CAREGIVER_OBSERVATION_MATRIX[code][anomalyFamily];

        if (cell.severity_delta > maxDelta) {
            maxDelta = cell.severity_delta;
        }

        matrixReasons.push(`${code}: ${cell.reason}`);

        if (cell.critical_route === "route_critical") {
            criticalRouteTriggered = true;
            criticalRouteReasons.push(`${code}: ${cell.reason}`);
        }

        if (
            cell.critical_route ===
            "route_critical_if_severe_dehydration_or_altered_state"
        ) {
            const hasAlteredState = selected.includes("WEAK_CONFUSED_NOT_BASELINE");
            const hasReducedIntake = selected.includes("REDUCED_INTAKE");

            if (hasAlteredState || hasReducedIntake) {
                criticalRouteTriggered = true;
                criticalRouteReasons.push(
                    `${code}: conditional critical route triggered because severe dehydration/altered-state context is present.`
                );
            }
        }
    }

    return {
        anomaly_family: anomalyFamily,
        max_matrix_delta: maxDelta,
        matrix_reasons: matrixReasons,
        critical_route_triggered: criticalRouteTriggered,
        critical_route_reasons: criticalRouteReasons,
    };
}
