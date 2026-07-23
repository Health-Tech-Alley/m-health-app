import {
    MODEL_NAME,
    MODEL_VERSION,
    UC2_EVENT_NAME,
} from "./uc2Constants";
import type {
    AnomalyFamily,
    AuditEvent,
    AutoencoderResult,
    CaregiverHitlInput,
    CaregiverHitlResult,
    CaregiverObservationCode,
    EmergencyRuleResult,
    FeatureQualityTag,
    FinalDecisionResult,
    FinalNotificationType,
    FinalSlmPayload,
    InitialMcpPayload,
    PatientProfile,
    PersonalizedThresholdResult,
    RecurrenceRiskResult,
    SensorClassificationResult,
    Severity,
} from "./uc2Types";

export function buildInitialMcpPayload(params: {
    patient_id: string;
    timestamp_iso: string;
    sensor: SensorClassificationResult;
    ae: AutoencoderResult;
    feature_quality_tags: FeatureQualityTag[];
}): InitialMcpPayload {
    return {
        event_name: UC2_EVENT_NAME,
        patient_id: params.patient_id,
        timestamp_iso: params.timestamp_iso,
        sensor_anomaly_type: params.sensor.sensor_anomaly_type,
        pre_hitl_severity: params.sensor.pre_hitl_severity,
        ae_score: params.ae.ae_score,
        ae_threshold: params.ae.ae_threshold,
        top_contributors: params.ae.top_contributors,
        feature_quality_tags: params.feature_quality_tags,
        suggested_caregiver_prompt:
            "We noticed a change in recent health signals. Can you check what you are seeing right now?",
    };
}

export function buildFinalSlmPayload(params: {
    patient_id: string;
    timestamp_iso: string;
    profile?: PatientProfile;
    ae: AutoencoderResult | null;
    sensor: SensorClassificationResult;
    caregiver: CaregiverHitlResult;
    caregiverInput?: CaregiverHitlInput;
    personalized: PersonalizedThresholdResult;
    recurrence: RecurrenceRiskResult;
    final: FinalDecisionResult;
    feature_quality_tags: FeatureQualityTag[];
    anomaly_family?: AnomalyFamily;
    max_matrix_delta?: 0 | 1 | 2 | 3;
    critical_route_triggered?: boolean;
    critical_route_reasons?: string[];

}): FinalSlmPayload {
    return {
        event_name: UC2_EVENT_NAME,
        patient_id: params.patient_id,
        timestamp_iso: params.timestamp_iso,
        model_name: MODEL_NAME,
        model_version: MODEL_VERSION,

        ae_score: params.ae?.ae_score ?? null,
        ae_threshold: params.ae?.ae_threshold ?? null,
        top_contributors: params.ae?.top_contributors ?? [],

        sensor_anomaly_type: params.sensor.sensor_anomaly_type,
        post_hitl_anomaly_type: params.final.post_hitl_anomaly_type ?? "NORMAL_PATTERN",

        pre_hitl_severity: params.sensor.pre_hitl_severity,
        observation_severity_floor: params.caregiver.observation_severity_floor,
        personalized_threshold_severity_floor:
            params.personalized.personalized_threshold_severity_floor,
        recurrence_severity_floor: params.recurrence.recurrence_severity_floor,
        post_hitl_severity: params.final.post_hitl_severity ?? 0,

        final_notification_type: params.final.final_notification_type,
        final_notification_level: params.final.final_notification_level,

        caregiver_selected_codes: params.caregiver.caregiver_selected_codes,
        caregiver_note: params.caregiverInput?.free_text_note,

        personalized_threshold_reasons:
            params.personalized.personalized_threshold_reasons,
        baseline_deviation_score: params.personalized.baseline_deviation_score,

        recurrence_risk_score: params.recurrence.recurrence_risk_score,
        recurrence_reasons: params.recurrence.recurrence_reasons,
        same_class_count: params.recurrence.same_class_count,
        related_class_count: params.recurrence.related_class_count,

        feature_quality_tags: params.feature_quality_tags,

        patient_context: {
            conditions: params.profile?.conditions,
            medications: params.profile?.medications,
            care_plan_goals: params.profile?.care_plan_goals,
            clinician_recipient: params.profile?.clinician_recipient,
        },

        slm_safety_boundary:
            "The SLM may summarize structured evidence and ask follow-up questions. It must not diagnose, override emergency rules, or decide whether the anomaly exists.",
    };
}

// @compat Old function preserved
export function buildInitialMCPPayload(params: {
    eventId: string;
    input: import("./uc2Types").AppleWatchVitalsInput;
    pipelinePath: string;
    aeScore: number | null;
    threshold: number | null;
    isAnomaly: boolean;
    initialAnomalyType: import("./uc2Types").UC2ContextualType;
    topFeatureEvidence: import("./uc2Types").TopFeatureEvidence[];
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
            name: MODEL_NAME,
            version: MODEL_VERSION,
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

// @compat Old function preserved
export function buildFinalSLMPayload(params: {
    eventId: string;
    input: import("./uc2Types").AppleWatchVitalsInput;
    emergencyResult: import("./uc2Types").EmergencyRuleResult;
    aeScore: number | null;
    threshold: number | null;
    isAnomaly: boolean;
    initialAnomalyType: import("./uc2Types").UC2ContextualType;
    postHitlAnomalyType: import("./uc2Types").UC2ContextualType;
    topFeatureEvidence: import("./uc2Types").TopFeatureEvidence[];
    featureQuality: Record<string, string>;
    caregiverFinalAction: import("./uc2Types").CaregiverFinalAction;
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
            name: MODEL_NAME,
            version: MODEL_VERSION,
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

// New in v2
export function buildAuditEvent(params: {
    event_id: string;
    patient_id: string;
    timestamp_iso: string;
    emergency: EmergencyRuleResult;
    ae_score: number | null;
    pre_hitl_severity: Severity;
    post_hitl_severity: Severity;
    final_notification_type: FinalNotificationType;
    caregiver_selected_codes: CaregiverObservationCode[];
    quality_warnings: string[];
}): AuditEvent {
    return {
        event_id: params.event_id,
        patient_id: params.patient_id,
        timestamp_iso: params.timestamp_iso,
        pipeline_path: params.emergency.pipelinePath,
        emergency_triggered: params.emergency.emergency,
        ae_score: params.ae_score,
        pre_hitl_severity: params.pre_hitl_severity,
        post_hitl_severity: params.post_hitl_severity,
        final_notification_type: params.final_notification_type,
        caregiver_selected_codes: params.caregiver_selected_codes,
        quality_warnings: params.quality_warnings,
        model_name: MODEL_NAME,
        model_version: MODEL_VERSION,
    };
}
