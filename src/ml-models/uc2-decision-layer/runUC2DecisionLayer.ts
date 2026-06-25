import {
    AnomalyFamily,
    AuditEvent,
    AppleWatchVitalsInput,
    CaregiverFinalAction,
    CaregiverObservationCode,
    DecisionLayerResult,
    FeatureQualityTag,
    FinalNotificationLevel,
    FinalNotificationType,
    FinalSlmPayload,
    HistoricalAnomalyEvent,
    InitialMcpPayload,
    PatientProfile,
    PatientProfileDefaults,
    PostHitlAnomalyType,
    RawObservationInput,
    ScalerParams,
    SensorAnomalyType,
    Severity,
    UC2ContextualType,
    UC2Scaler,
    CaregiverHitlInput,
} from "./uc2Types";

import { UC2_FEATURE_ORDER } from "./uc2Constants";
import { buildUC2FeatureVector, buildCompletedFeatureVector } from "./featureEngineering";
import { scaleFeatures, scaleVector } from "./scaler";
import { runEmergencyRuleEngine } from "./emergencyRuleEngine";
import {
    reconstructionError,
    getTopReconstructionContributions,
    computeAutoencoderScore,
} from "./anomalyScoring";
import {
    classifyInitialContextualType,
    fusePostHITLContext,
    classifySensorAnomaly,
} from "./contextualRouting";
import { shouldShowCaregiverPrompt, evaluateCaregiverHitl, normalizeCaregiverCodes } from "./caregiverHitl";
import { finalDecision, makeFinalDecision } from "./finalDecision";
import {
    buildInitialMCPPayload,
    buildFinalSLMPayload,
    buildInitialMcpPayload,
    buildFinalSlmPayload,
    buildAuditEvent,
} from "./payloadBuilders";
import { runTinyAutoencoderTflite, TfliteInterpreterLike } from "./tfliteModelAdapter";
import { evaluatePersonalizedThresholds } from "./personalizedThresholds";
import { evaluateRecurrenceRisk } from "./recurrenceRisk";

// --- Old types for compat ---
export type TFLiteAutoencoderRunner = (
    scaledInput: number[]
) => Promise<number[]>;

export type UC2DecisionResult = {
    // ── OLD-COMPATIBLE FIELDS (preserved for existing callers) ─────────────────
    emergencyResult: ReturnType<typeof runEmergencyRuleEngine>;
    rawFeatures: number[];
    scaledFeatures: number[] | null;
    /** @alias ae_score_mse */ aeScore: number | null;
    threshold: number;
    /** @alias ml_anomaly_flag */ isAnomaly: boolean;
    promptShown: boolean;
    /** @alias sensor_anomaly_type (mapped to old UC2ContextualType) */ initialAnomalyType: UC2ContextualType;
    /** @alias post_hitl_anomaly_type (mapped to old UC2ContextualType) */ postHitlAnomalyType: UC2ContextualType;
    /** @alias top_reconstruction_contributors */ topFeatureEvidence: ReturnType<typeof getTopReconstructionContributions>;
    featureQuality: Record<string, import("./uc2Types").FeatureQuality>;
    finalDecision: ReturnType<typeof finalDecision>;
    initialMCPPayload: ReturnType<typeof buildInitialMCPPayload> | null;
    finalSLMPayload: ReturnType<typeof buildFinalSLMPayload> | null;

    // ── NEW EXPLICIT V2 FIELDS ─────────────────────────────────────────────────
    // (These mirror the new DecisionLayerResult shape so both call sites work)
    ae_score_mse: number | null;                            // alias: aeScore
    ml_anomaly_flag: boolean;                               // alias: isAnomaly
    pre_hitl_severity: Severity;
    post_hitl_severity: Severity;
    sensor_anomaly_type: SensorAnomalyType;                 // richer label than initialAnomalyType
    post_hitl_anomaly_type: PostHitlAnomalyType;            // richer label than postHitlAnomalyType
    anomaly_family: AnomalyFamily | undefined;
    caregiver_selected_codes: CaregiverObservationCode[];
    max_matrix_delta: 0 | 1 | 2 | 3;
    critical_route_triggered: boolean;
    personalized_threshold_severity_floor: Severity;
    recurrence_severity_floor: Severity;
    final_notification_type: FinalNotificationType;
    final_notification_level: FinalNotificationLevel;
    quality_tags: FeatureQualityTag[];                      // empty [] on legacy path (no quality tagging)
    quality_warnings: string[];
    emergency_rule_result: ReturnType<typeof runEmergencyRuleEngine>;  // alias: emergencyResult
    slm_payload: FinalSlmPayload | null;                    // alias: finalSLMPayload (new shape)
    provider_payload: FinalSlmPayload | null;               // alias: slm_payload
    mcp_payload: InitialMcpPayload | null;                  // alias: initialMCPPayload (new shape)
    audit_event: AuditEvent;
};

// @compat Old function preserved
export async function runUC2DecisionLayer(params: {
    eventId: string;
    input: AppleWatchVitalsInput;
    patientProfile?: PatientProfileDefaults;
    scaler: UC2Scaler;
    threshold: number;
    runTFLiteAutoencoder: TFLiteAutoencoderRunner;

    // These come after UI HITL. For pre-HITL mode, pass defaults
    caregiverFinalAction?: CaregiverFinalAction;
    caregiverSelectedCodes?: string[];
}): Promise<UC2DecisionResult> {
    const {
        eventId,
        input,
        patientProfile,
        scaler,
        threshold,
        runTFLiteAutoencoder,
    } = params;

    const caregiverFinalAction =
        params.caregiverFinalAction ?? "no_prompt_shown";

    const caregiverSelectedCodes = params.caregiverSelectedCodes ?? [];

    const featureVector = buildUC2FeatureVector(input, patientProfile);

    // Call the updated emergency rule engine using featureMap
    const emergencyResult = runEmergencyRuleEngine(featureVector.featureMap);

    if (emergencyResult.emergency) {
        const initialAnomalyType = "CRITICAL_EMERGENCY_ALERT" as const;
        const postHitlAnomalyType = "CRITICAL_EMERGENCY_ALERT" as const;

        const decision = finalDecision({
            emergency: true,
            promptShown: false,
            caregiverFinalAction: "no_prompt_shown",
            postHitlAnomalyType,
        });

        const audit = buildAuditEvent({
            event_id: eventId,
            patient_id: input.patient_id,
            timestamp_iso: input.timestamp,
            emergency: emergencyResult,
            ae_score: null,
            pre_hitl_severity: 3,
            post_hitl_severity: 3,
            final_notification_type: "CRITICAL_EMERGENCY_ALERT",
            caregiver_selected_codes: [],
            quality_warnings: [],
        });

        return {
            // ── old-compatible fields ──
            emergencyResult,
            rawFeatures: featureVector.rawFeatures,
            scaledFeatures: null,
            aeScore: null,
            threshold,
            isAnomaly: false,
            promptShown: false,
            initialAnomalyType,
            postHitlAnomalyType,
            topFeatureEvidence: [],
            featureQuality: featureVector.featureQuality,
            finalDecision: decision,
            initialMCPPayload: null,
            finalSLMPayload: null,
            // ── new v2 fields ──
            ae_score_mse: null,
            ml_anomaly_flag: false,
            pre_hitl_severity: 3,
            post_hitl_severity: 3,
            sensor_anomaly_type: "CRITICAL_VITAL_THRESHOLD" as SensorAnomalyType,
            post_hitl_anomaly_type: "CRITICAL_EMERGENCY_ALERT" as PostHitlAnomalyType,
            anomaly_family: "CRITICAL_VITAL" as AnomalyFamily,
            caregiver_selected_codes: [],
            max_matrix_delta: 0,
            critical_route_triggered: false,
            personalized_threshold_severity_floor: 0,
            recurrence_severity_floor: 0,
            final_notification_type: "CRITICAL_EMERGENCY_ALERT",
            final_notification_level: "critical",
            quality_tags: [],
            quality_warnings: [],
            emergency_rule_result: emergencyResult,
            slm_payload: null,
            provider_payload: null,
            mcp_payload: null,
            audit_event: audit,
        };
    }

    const scaledFeatures = scaleFeatures(featureVector.rawFeatures, scaler);

    const reconstructed = await runTFLiteAutoencoder(scaledFeatures);

    const aeScore = reconstructionError(scaledFeatures, reconstructed);

    const isAnomaly = aeScore >= threshold;

    const topFeatureEvidence = getTopReconstructionContributions(
        scaledFeatures,
        reconstructed,
        UC2_FEATURE_ORDER,
        5
    );

    const initialAnomalyType = classifyInitialContextualType({
        emergency: false,
        isAnomaly,
        topFeatureEvidence,
    });

    const promptShown = shouldShowCaregiverPrompt({
        emergency: false,
        isAnomaly,
    });

    const initialMCPPayload = promptShown
        ? buildInitialMCPPayload({
            eventId,
            input,
            pipelinePath: emergencyResult.pipelinePath,
            aeScore,
            threshold,
            isAnomaly,
            initialAnomalyType,
            topFeatureEvidence,
            featureQuality: featureVector.featureQuality as any, // Cast because it might be FeatureQuality
        })
        : null;

    const postHitlAnomalyType = fusePostHITLContext({
        initialType: initialAnomalyType,
        caregiverSelectedCodes,
    });

    const caregiverConfirmed = caregiverFinalAction === "confirm_concern";

    const decision = finalDecision({
        emergency: false,
        promptShown,
        caregiverFinalAction,
        postHitlAnomalyType,
    });

    const shouldBuildFinalSLMPayload =
        decision.final_notification_type === "SLM_SUMMARY_AND_PROVIDER_NOTE" ||
        decision.final_notification_type === "MONITORING_ADVICE";

    const finalSLMPayload = shouldBuildFinalSLMPayload
        ? buildFinalSLMPayload({
            eventId,
            input,
            emergencyResult,
            aeScore,
            threshold,
            isAnomaly,
            initialAnomalyType,
            postHitlAnomalyType,
            topFeatureEvidence,
            featureQuality: featureVector.featureQuality as any,
            caregiverFinalAction,
            caregiverConfirmed,
            caregiverSelectedCodes,
            finalDecision: decision,
        })
        : null;

    // ── Derive v2 field values from legacy-path outputs ───────────────────────
    const legacySensorType = legacyContextualToSensorType(initialAnomalyType);
    const legacyPostHitlType = legacyContextualToPostHitlType(postHitlAnomalyType);
    const legacyPreHitlSeverity: Severity = isAnomaly ? 1 : 0;
    const legacyPostHitlSeverity: Severity = decision.final_severity as Severity;
    const legacySelectedCodes = normalizeCaregiverCodes(caregiverSelectedCodes);

    const audit = buildAuditEvent({
        event_id: eventId,
        patient_id: input.patient_id,
        timestamp_iso: input.timestamp,
        emergency: emergencyResult,
        ae_score: aeScore,
        pre_hitl_severity: legacyPreHitlSeverity,
        post_hitl_severity: legacyPostHitlSeverity,
        final_notification_type: decision.final_notification_type,
        caregiver_selected_codes: legacySelectedCodes,
        quality_warnings: [],
    });

    return {
        // ── old-compatible fields ──
        emergencyResult,
        rawFeatures: featureVector.rawFeatures,
        scaledFeatures,
        aeScore,
        threshold,
        isAnomaly,
        promptShown,
        initialAnomalyType,
        postHitlAnomalyType,
        topFeatureEvidence,
        featureQuality: featureVector.featureQuality,
        finalDecision: decision,
        initialMCPPayload,
        finalSLMPayload,
        // ── new v2 fields ──
        ae_score_mse: aeScore,
        ml_anomaly_flag: isAnomaly,
        pre_hitl_severity: legacyPreHitlSeverity,
        post_hitl_severity: legacyPostHitlSeverity,
        sensor_anomaly_type: legacySensorType,
        post_hitl_anomaly_type: legacyPostHitlType,
        anomaly_family: undefined,
        caregiver_selected_codes: legacySelectedCodes,
        max_matrix_delta: 0,           // legacy path doesn't run matrix
        critical_route_triggered: false,
        personalized_threshold_severity_floor: 0,  // legacy path doesn't run EHR thresholds
        recurrence_severity_floor: 0,              // legacy path doesn't run recurrence
        final_notification_type: decision.final_notification_type,
        final_notification_level: decision.final_notification_level,
        quality_tags: [],              // legacy path doesn't produce quality tags
        quality_warnings: [],
        emergency_rule_result: emergencyResult,
        slm_payload: null,             // legacy payload shape differs; use finalSLMPayload for old shape
        provider_payload: null,
        mcp_payload: null,             // legacy payload shape differs; use initialMCPPayload for old shape
        audit_event: audit,
    };
}

// Maps old UC2ContextualType → new SensorAnomalyType (best-effort for legacy path)
function legacyContextualToSensorType(ctx: UC2ContextualType): SensorAnomalyType {
    switch (ctx) {
        case "RESPIRATORY_CONCERN":        return "CARDIO_RESPIRATORY_SIGNAL_CHANGE";
        case "GI_AUTONOMIC_RISK":           return "UNEXPLAINED_PHYSIOLOGIC_STRESS";
        case "SLEEP_STRESS_RECOVERY":       return "SLEEP_RECOVERY_DEVIATION";
        case "EXERTION_LIKE_PATTERN":       return "EXERTION_OR_ACTIVITY_PATTERN";
        case "CRITICAL_EMERGENCY_ALERT":    return "CRITICAL_VITAL_THRESHOLD";
        case "GENERAL_MULTIVARIATE_ANOMALY": return "UNEXPLAINED_PHYSIOLOGIC_STRESS";
        case "NORMAL_PATTERN":              return "NORMAL_PATTERN";
        default:                            return "NORMAL_PATTERN";
    }
}

// Maps old UC2ContextualType → new PostHitlAnomalyType (best-effort for legacy path)
function legacyContextualToPostHitlType(ctx: UC2ContextualType): PostHitlAnomalyType {
    switch (ctx) {
        case "RESPIRATORY_CONCERN":         return "RESPIRATORY_CONCERN";
        case "GI_AUTONOMIC_RISK":            return "GI_AUTONOMIC_RISK";
        case "SLEEP_STRESS_RECOVERY":        return "SLEEP_STRESS_RECOVERY";
        case "EXERTION_LIKE_PATTERN":        return "EXERTION_LIKE_PATTERN";
        case "CRITICAL_EMERGENCY_ALERT":     return "CRITICAL_EMERGENCY_ALERT";
        case "GENERAL_MULTIVARIATE_ANOMALY": return "PROVIDER_REVIEW_RECOMMENDED";
        case "NORMAL_PATTERN":               return "NORMAL_PATTERN";
        default:                             return "NORMAL_PATTERN";
    }
}

// New in v2
export async function runUC2DecisionLayerV2(params: {
    raw: RawObservationInput;
    profile?: PatientProfile;
    caregiverInput?: CaregiverHitlInput;
    history?: HistoricalAnomalyEvent[];
    scaler: ScalerParams;
    interpreter?: TfliteInterpreterLike;
    aeThreshold?: number;
}): Promise<DecisionLayerResult> {
    const built = buildCompletedFeatureVector(params.raw, params.profile);

    const emergency = runEmergencyRuleEngine(built.features);

    if (emergency.is_emergency) {
        const final_decision = makeFinalDecision({
            emergency,
            sensor: null,
            caregiver: null,
            personalized: null,
            recurrence: null,
        });

        return {
            emergency,
            features: built.features,
            feature_vector: built.feature_vector,
            feature_quality_tags: built.feature_quality_tags,
            ae: null,
            sensor_classification: null,
            caregiver_hitl: null,
            personalized_thresholds: null,
            recurrence: null,
            final_decision,
            initial_mcp_payload: null,
            final_slm_payload: null,
        };
    }

    const personalized = evaluatePersonalizedThresholds(
        built.features,
        params.profile
    );

    const scaled = scaleVector(built.feature_vector, params.scaler);
    const reconstructed = await runTinyAutoencoderTflite(
        scaled,
        params.interpreter
    );

    const ae = computeAutoencoderScore(
        scaled,
        reconstructed,
        built.features,
        params.aeThreshold
    );

    const sensor = classifySensorAnomaly(built.features, ae);

    const caregiver = evaluateCaregiverHitl(
        params.caregiverInput,
        sensor.sensor_anomaly_type,
        sensor.pre_hitl_severity
    );

    const provisionalFinal = makeFinalDecision({
        emergency,
        sensor,
        caregiver,
        personalized,
        recurrence: null,
    });

    const recurrence = evaluateRecurrenceRisk({
        patient_id: params.raw.patient_id,
        timestamp_iso: params.raw.timestamp_iso,
        current_post_hitl_type: provisionalFinal.post_hitl_anomaly_type ?? "NORMAL_PATTERN",
        history: params.history,
        emergencyAlreadyDetected: false,
    });

    const final_decision = makeFinalDecision({
        emergency,
        sensor,
        caregiver,
        personalized,
        recurrence,
    });

    const initial_mcp_payload =
        final_decision.should_build_initial_mcp_payload && ae.is_anomaly
            ? buildInitialMcpPayload({
                patient_id: params.raw.patient_id,
                timestamp_iso: params.raw.timestamp_iso,
                sensor,
                ae,
                feature_quality_tags: built.feature_quality_tags,
            })
            : null;

    const final_slm_payload =
        final_decision.should_build_final_slm_payload
            ? buildFinalSlmPayload({
                patient_id: params.raw.patient_id,
                timestamp_iso: params.raw.timestamp_iso,
                profile: params.profile,
                ae,
                sensor,
                caregiver,
                caregiverInput: params.caregiverInput,
                personalized,
                recurrence,
                final: final_decision,
                feature_quality_tags: built.feature_quality_tags,
            })
            : null;

    const audit_event = buildAuditEvent({
        event_id: `uc2v2-${params.raw.patient_id}-${Date.now()}`,
        patient_id: params.raw.patient_id,
        timestamp_iso: params.raw.timestamp_iso,
        emergency,
        ae_score: ae.ae_score,
        pre_hitl_severity: sensor.pre_hitl_severity,
        post_hitl_severity: final_decision.post_hitl_severity ?? 0,
        final_notification_type: final_decision.final_notification_type,
        caregiver_selected_codes: caregiver?.caregiver_selected_codes ?? [],
        quality_warnings: (built.feature_quality_tags ?? [])
            .filter((t) => t.warning)
            .map((t) => t.warning!),
    });

    return {
        emergency,
        features: built.features,
        feature_vector: built.feature_vector,
        feature_quality_tags: built.feature_quality_tags,
        ae,
        sensor_classification: sensor,
        caregiver_hitl: caregiver,
        personalized_thresholds: personalized,
        recurrence,
        final_decision,
        initial_mcp_payload,
        final_slm_payload,
        audit_event,
    };
}
