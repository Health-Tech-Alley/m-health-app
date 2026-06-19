import {
    AppleWatchVitalsInput,
    CaregiverFinalAction,
    EmergencyRuleResult,
    FinalDecisionResult,
    TopFeatureEvidence,
    UC2ContextualType,
} from "./uc2Types";

import {
    UC2_EVENT_NAME,
    UC2_MODEL_NAME,
    UC2_MODEL_VERSION,
} from "./uc2Constants";

export function buildInitialMCPPayload(params: {
    eventId: string;
    input: AppleWatchVitalsInput;
    pipelinePath: string;
    aeScore: number | null;
    threshold: number | null;
    isAnomaly: boolean;
    initialAnomalyType: UC2ContextualType;
    topFeatureEvidence: TopFeatureEvidence[];
    featureQuality: Record<string, string>;
}) {
    return {
        event_id: params.eventId,
        event_name: UC2_EVENT_NAME,
        patient_id: params.input.patient_id,
        caregiver_id: params.input.caregiver_id ?? null,
        device_id: params.input.device_id ?? null,
        timestamp: params.input.timestamp,

        pipeline_path: params.pipelinePath,

        model: {
            name: UC2_MODEL_NAME,
            version: UC2_MODEL_VERSION,
            ae_score: params.aeScore,
            threshold: params.threshold,
            is_anomaly: params.isAnomaly,
        },

        anomaly_context: {
            initial_anomaly_type: params.initialAnomalyType,
            top_feature_evidence: params.topFeatureEvidence,
            feature_quality: params.featureQuality,
        },

        instruction:
            "Hold anomaly context pending caregiver HITL response. Do not generate diagnosis.",
    };
}

export function buildFinalSLMPayload(params: {
    eventId: string;
    input: AppleWatchVitalsInput;
    emergencyResult: EmergencyRuleResult;
    aeScore: number | null;
    threshold: number | null;
    isAnomaly: boolean;
    initialAnomalyType: UC2ContextualType;
    postHitlAnomalyType: UC2ContextualType;
    topFeatureEvidence: TopFeatureEvidence[];
    featureQuality: Record<string, string>;
    caregiverFinalAction: CaregiverFinalAction;
    caregiverConfirmed: boolean;
    caregiverSelectedCodes: string[];
    finalDecision: FinalDecisionResult;
}) {
    return {
        event_id: params.eventId,
        event_name: UC2_EVENT_NAME,
        patient_id: params.input.patient_id,
        caregiver_id: params.input.caregiver_id ?? null,
        device_id: params.input.device_id ?? null,
        timestamp: params.input.timestamp,

        pipeline_path: params.emergencyResult.pipelinePath,

        model: {
            name: UC2_MODEL_NAME,
            version: UC2_MODEL_VERSION,
            ae_score: params.aeScore,
            threshold: params.threshold,
            is_anomaly: params.isAnomaly,
        },

        anomaly_context: {
            initial_anomaly_type: params.initialAnomalyType,
            post_hitl_anomaly_type: params.postHitlAnomalyType,
            top_feature_evidence: params.topFeatureEvidence,
            feature_quality: params.featureQuality,
        },

        caregiver_response: {
            caregiver_final_action: params.caregiverFinalAction,
            caregiver_confirmed: params.caregiverConfirmed,
            caregiver_selected_codes: params.caregiverSelectedCodes,
        },

        final_routing: {
            final_notification_type:
                params.finalDecision.final_notification_type,
            final_notification_level:
                params.finalDecision.final_notification_level,
            final_severity: params.finalDecision.final_severity,
            final_notification_title:
                params.finalDecision.final_notification_title,
            final_notification_body:
                params.finalDecision.final_notification_body,
            slm_refinement_queued:
                params.finalDecision.slm_refinement_queued,
            refinement_reason: params.finalDecision.refinement_reason,
        },

        instruction_to_slm:
            "Generate a caregiver/provider-facing summary using only the structured ML evidence and caregiver HITL context. Do not diagnose. Do not override the rule engine or anomaly model.",
    };
}
