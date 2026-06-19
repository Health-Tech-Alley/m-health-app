import {
    CaregiverFinalAction,
    FinalDecisionResult,
    UC2ContextualType,
} from "./uc2Types";

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
    };
}
