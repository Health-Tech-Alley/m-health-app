import {
    AlertSuppressionStatus,
    CaregiverFinalAction,
    CaregiverHitlResult,
    EmergencyRuleResult,
    FinalDecisionResult,
    PersonalizedThresholdResult,
    PostHitlAnomalyType,
    RecurrenceRiskResult,
    SensorClassificationResult,
    Severity,
    SustainedDurationResult,
    UC2ContextualType,
} from "./uc2Types";

// @compat Old function preserved
export function finalDecision(params: {
    emergency: boolean;
    promptShown: boolean;
    caregiverFinalAction: CaregiverFinalAction;
    postHitlAnomalyType: UC2ContextualType;
}): FinalDecisionResult {
    const {
        emergency,
        promptShown,
        caregiverFinalAction,
    } = params;

    if (emergency) {
        return {
            final_notification_type: "CRITICAL_EMERGENCY_ALERT",
            final_notification_level: "critical",
            final_severity: 3,
            final_notification_title: "Critical health alert",
            final_notification_body:
                "A safety threshold was crossed. The caregiver should check immediately and follow the emergency plan.",
            slm_refinement_queued: false,
            refinement_reason:
                "Emergency rule triggered; ML/SLM bypassed initially.",

            // @compat Fallback defaults for new v2 fields:
            post_hitl_anomaly_type: "CRITICAL_EMERGENCY_ALERT",
            post_hitl_severity: 3,
            should_build_initial_mcp_payload: false,
            should_build_final_slm_payload: false,
            final_reasons: [],
        };
    }

    if (!promptShown) {
        return {
            final_notification_type: "NO_ALERT",
            final_notification_level: null,
            final_severity: 0,
            final_notification_title: "",
            final_notification_body: "",
            slm_refinement_queued: false,
            refinement_reason: null,
            post_hitl_anomaly_type: "NORMAL_PATTERN",
            post_hitl_severity: 0,
            should_build_initial_mcp_payload: false,
            should_build_final_slm_payload: false,
            final_reasons: ["No prompt shown; baseline monitoring."],
        };
    }

    if (caregiverFinalAction === "confirm_concern") {
        return {
            final_notification_type: "SLM_SUMMARY_AND_PROVIDER_NOTE",
            final_notification_level: "follow_up",
            final_severity: 2,
            final_notification_title: "Follow-up recommended",
            final_notification_body:
                "The caregiver confirmed concern after an unusual health pattern was detected.",
            slm_refinement_queued: true,
            refinement_reason:
                "Caregiver confirmed concern after ML anomaly prompt.",
            post_hitl_anomaly_type: params.postHitlAnomalyType as PostHitlAnomalyType,
            post_hitl_severity: 2,
            should_build_initial_mcp_payload: true,
            should_build_final_slm_payload: true,
            final_reasons: [],
        };
    }

    if (caregiverFinalAction === "continue_monitoring") {
        return {
            final_notification_type: "MONITORING_ADVICE",
            final_notification_level: "monitor",
            final_severity: 1,
            final_notification_title: "Continue monitoring",
            final_notification_body:
                "An unusual pattern was detected, but the caregiver selected continued monitoring.",
            slm_refinement_queued: true,
            refinement_reason:
                "Caregiver requested continued monitoring after anomaly prompt.",
            post_hitl_anomaly_type: params.postHitlAnomalyType as PostHitlAnomalyType,
            post_hitl_severity: 1,
            should_build_initial_mcp_payload: true,
            should_build_final_slm_payload: false,
            final_reasons: [],
        };
    }

    if (caregiverFinalAction === "dismiss") {
        return {
            final_notification_type: "DISMISSED_WITH_AUDIT",
            final_notification_level: "logged_only",
            final_severity: 0,
            final_notification_title: "Logged",
            final_notification_body:
                "The caregiver dismissed the prompt. The event was logged for audit.",
            slm_refinement_queued: false,
            refinement_reason: "Caregiver dismissed prompt; event logged for audit.",
            post_hitl_anomaly_type: params.postHitlAnomalyType as PostHitlAnomalyType,
            post_hitl_severity: 0,
            should_build_initial_mcp_payload: false,
            should_build_final_slm_payload: false,
            final_reasons: [],
        };
    }

    return {
        final_notification_type: "NO_ALERT",
        final_notification_level: null,
        final_severity: 0,
        final_notification_title: "",
        final_notification_body: "",
        slm_refinement_queued: false,
        refinement_reason: null,
        post_hitl_anomaly_type: "NORMAL_PATTERN",
        post_hitl_severity: 0,
        should_build_initial_mcp_payload: false,
        should_build_final_slm_payload: false,
        final_reasons: [],
    };
}

// New in v2
export function makeFinalDecision(params: {
    emergency: EmergencyRuleResult;
    sensor: SensorClassificationResult | null;
    caregiver: CaregiverHitlResult | null;
    personalized: PersonalizedThresholdResult | null;
    recurrence: RecurrenceRiskResult | null;
    /**
     * Watch12: sustained anomaly duration floor.
     * Added in migration from 18D to 12D architecture.
     */
    sustained?: SustainedDurationResult | null;
    /**
     * Watch12: alert hysteresis suppression status.
     */
    suppression?: AlertSuppressionStatus | null;
}): FinalDecisionResult {
    if (params.emergency.is_emergency) {
        const out: FinalDecisionResult = {
            post_hitl_anomaly_type: "CRITICAL_EMERGENCY_ALERT",
            post_hitl_severity: 3,
            final_notification_type: "CRITICAL_EMERGENCY_ALERT",
            final_notification_level: "critical",
            final_severity: 3,
            final_notification_title: "Critical health alert",
            final_notification_body:
                "A safety threshold was crossed. The caregiver should check immediately and follow the emergency plan.",
            slm_refinement_queued: false,
            refinement_reason:
                "Emergency rule triggered; ML/SLM bypassed initially.",
            final_reasons: [
                "Absolute emergency rule triggered before ML/SLM/MCP.",
                ...(params.emergency.reasons ?? []),
            ],
            should_build_initial_mcp_payload: false,
            should_build_final_slm_payload: false,
            suppression_status: params.suppression ?? undefined,
        };

        return out;
    }

    const sensorSeverity = params.sensor?.pre_hitl_severity ?? 0;
    const observationFloor =
        params.caregiver?.observation_severity_floor ?? 0;
    const personalizedFloor =
        params.personalized?.personalized_threshold_severity_floor ?? 0;
    const recurrenceFloor =
        params.recurrence?.recurrence_severity_floor ?? 0;
    const sustainedFloor =
        params.sustained?.sustained_severity_floor ?? 0;

    const postHitlSeverity = Math.max(
        sensorSeverity,
        observationFloor,
        personalizedFloor,
        recurrenceFloor,
        sustainedFloor
    ) as Severity;

    const postType = inferPostHitlType(params);

    // Build a result object for later possible suppression demotion
    let out: FinalDecisionResult;

    if (
        params.caregiver?.data_quality_warning &&
        sensorSeverity <= 1 &&
        postHitlSeverity <= 1
    ) {
        out = {
            post_hitl_anomaly_type: postType,
            post_hitl_severity: 1,
            final_severity: 1,
            final_notification_type: "MONITORING_ADVICE",
            final_notification_level: "monitor",
            final_notification_title: "Continue monitoring",
            final_notification_body:
                "Sensor/watch issue reported; recommend recheck.",
            slm_refinement_queued: true,
            refinement_reason: "Sensor issue reported",
            final_reasons: [
                "Sensor/watch issue reported; recommend recheck rather than downgrade.",
            ],
            should_build_initial_mcp_payload: true,
            should_build_final_slm_payload: false,
            suppression_status: params.suppression ?? undefined,
        };
    } else if (postHitlSeverity === 0) {
        out = {
            post_hitl_anomaly_type: postType,
            post_hitl_severity: 0,
            final_severity: 0,
            final_notification_type: "NO_ALERT",
            final_notification_level: null,
            final_notification_title: "",
            final_notification_body: "",
            slm_refinement_queued: false,
            refinement_reason: null,
            final_reasons: ["No alert after ML/context evaluation."],
            should_build_initial_mcp_payload: false,
            should_build_final_slm_payload: false,
            suppression_status: params.suppression ?? undefined,
        };
    } else if (postHitlSeverity === 1) {
        out = {
            post_hitl_anomaly_type: postType,
            post_hitl_severity: 1,
            final_severity: 1,
            final_notification_type: "MONITORING_ADVICE",
            final_notification_level: "monitor",
            final_notification_title: "Continue monitoring",
            final_notification_body:
                "An unusual pattern was detected. Continue monitoring.",
            slm_refinement_queued: true,
            refinement_reason: "Mild anomaly detected.",
            final_reasons: collectReasons(params),
            should_build_initial_mcp_payload: true,
            should_build_final_slm_payload: false,
            suppression_status: params.suppression ?? undefined,
        };
    } else if (postHitlSeverity >= 3 || params.caregiver?.critical_route_triggered) {
        out = {
            post_hitl_anomaly_type: postType,
            post_hitl_severity: 3,
            final_severity: 3,
            final_notification_type: "CRITICAL_EMERGENCY_ALERT",
            final_notification_level: "critical",
            final_notification_title: "Critical health alert",
            final_notification_body:
                "A caregiver-confirmed critical health concern requires immediate attention.",
            slm_refinement_queued: false,
            refinement_reason: "Caregiver critical route triggered.",
            final_reasons: collectReasons(params),
            should_build_initial_mcp_payload: false,
            should_build_final_slm_payload: true,
            suppression_status: params.suppression ?? undefined,
        };
    } else {
        // Severity 2: significant anomaly or composite floor
        out = {
            post_hitl_anomaly_type: postType,
            post_hitl_severity: 2,
            final_severity: 2,
            final_notification_type: "SLM_SUMMARY_AND_PROVIDER_NOTE",
            final_notification_level: "follow_up",
            final_notification_title: "Follow-up recommended",
            final_notification_body:
                "A concerning health pattern was detected. Follow up may be needed.",
            slm_refinement_queued: true,
            refinement_reason: "Significant anomaly or caregiver concern.",
            final_reasons: collectReasons(params),
            should_build_initial_mcp_payload: true,
            should_build_final_slm_payload: true,
            suppression_status: params.suppression ?? undefined,
        };
    }

    // If the alert is suppressed by hysteresis, demote notifications but keep severity for logging
    if (params.suppression?.is_suppressed) {
        out.final_notification_type = "MONITORING_ADVICE";
        out.final_notification_level = "monitor";
        out.should_build_initial_mcp_payload = false;
    }

    return out;
}

function inferPostHitlType(params: {
    sensor: SensorClassificationResult | null;
    caregiver: CaregiverHitlResult | null;
}): PostHitlAnomalyType {
    const codes = params.caregiver?.caregiver_selected_codes ?? [];
    const sensor = params.sensor?.sensor_anomaly_type;

    if (codes.includes("BREATHING_DIFFERENT")) return "RESPIRATORY_CONCERN";

    if (
        codes.includes("VOMITING_OR_DIARRHEA") ||
        codes.includes("BATHROOM_CHANGES") ||
        codes.includes("REDUCED_INTAKE")
    ) {
        return "GI_AUTONOMIC_RISK";
    }

    if (codes.includes("MEDICATION_CHANGE_OR_MISSED")) {
        return "MEDICATION_ADHERENCE_CONCERN";
    }

    if (
        codes.includes("POOR_SLEEP") ||
        codes.includes("STRESS_OR_EMOTIONAL_UPSET")
    ) {
        return "SLEEP_STRESS_RECOVERY";
    }

    if (codes.includes("EXERCISE_OR_ACTIVITY")) {
        return "EXERTION_LIKE_PATTERN";
    }

    if (codes.includes("NOTHING_UNUSUAL_NOTICED")) {
        return "NO_CONCERN_CONFIRMED";
    }

    if (sensor === "CARDIO_RESPIRATORY_SIGNAL_CHANGE") return "RESPIRATORY_CONCERN";
    if (sensor === "SLEEP_RECOVERY_DEVIATION") return "SLEEP_STRESS_RECOVERY";
    if (sensor === "EXERTION_OR_ACTIVITY_PATTERN") return "EXERTION_LIKE_PATTERN";
    if (sensor === "UNEXPLAINED_PHYSIOLOGIC_STRESS")
        return "PROVIDER_REVIEW_RECOMMENDED";

    return "PROVIDER_REVIEW_RECOMMENDED";
}

function collectReasons(params: {
    sensor: SensorClassificationResult | null;
    caregiver: CaregiverHitlResult | null;
    personalized: PersonalizedThresholdResult | null;
    recurrence: RecurrenceRiskResult | null;
    sustained?: SustainedDurationResult | null;
}): string[] {
    return [
        ...(params.sensor?.reasons ?? []),
        ...(params.caregiver?.observation_reasons ?? []),
        ...(params.personalized?.personalized_threshold_reasons ?? []),
        ...(params.recurrence?.recurrence_reasons ?? []),
        ...(params.sustained?.sustained_reasons ?? []),
    ];
}
