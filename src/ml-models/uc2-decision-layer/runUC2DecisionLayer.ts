import {
    AnomalyFamily,
    AppleWatchVitalsInput,
    AuditEvent,
    CaregiverFinalAction,
    CaregiverHitlInput,
    CaregiverObservationCode,
    DecisionLayerResult,
    EmergencyRuleResult,
    ExternalMeasurements,
    FeatureQualityTag,
    FinalDecisionResult,
    FinalNotificationLevel,
    FinalNotificationType,
    FinalSlmPayload,
    HistoricalAnomalyEvent,
    InitialMcpPayload,
    PatientProfile,
    PatientProfileDefaults,
    PipelinePath,
    PostHitlAnomalyType,
    PreviousObservationInput,
    RawObservationInput,
    ScalerParams,
    SensorAnomalyType,
    SensorClassificationResult,
    Severity,
    UC2ContextualType,
    UC2Scaler,
} from "./uc2Types";

import { globalAlertHysteresisManager } from "./anomalyHistoryStore";
import {
    computeAutoencoderScore,
    getTopReconstructionContributions,
    reconstructionError,
} from "./anomalyScoring";
import { evaluateCaregiverHitl, normalizeCaregiverCodes, shouldShowCaregiverPrompt } from "./caregiverHitl";
import {
    classifyInitialContextualType,
    classifySensorAnomaly,
    fusePostHITLContext,
} from "./contextualRouting";
import { runEmergencyRuleEngine } from "./emergencyRuleEngine";
import { buildCompletedFeatureVector, buildUC2FeatureVector } from "./featureEngineering";
import { globalVitalsTTLCache } from "./featureImputation";
import { finalDecision, makeFinalDecision } from "./finalDecision";
import {
    buildAuditEvent,
    buildFinalSLMPayload,
    buildFinalSlmPayload,
    buildInitialMCPPayload,
    buildInitialMcpPayload,
} from "./payloadBuilders";
import { evaluatePersonalizedThresholds, getAdjustedAEThreshold } from "./personalizedThresholds";
import { evaluateRecurrenceRisk } from "./recurrenceRisk";
import { scaleFeatures, scaleVector } from "./scaler";
import { validateSignalPhysiologicBounds, validateWatchWristContact } from "./signalValidation";
import { evaluateSustainedDuration } from "./sustainedDuration";
import { runTinyAutoencoderTflite, TfliteInterpreterLike } from "./tfliteModelAdapter";
import { UC2_FEATURE_ORDER } from "./uc2Constants";

// --- Old types for compat ---
export type TFLiteAutoencoderRunner = (
    scaledInput: number[]
) => Promise<number[]>;

export type UC2DecisionResult = {
    // â”€â”€ OLD-COMPATIBLE FIELDS (preserved for existing callers) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    emergencyResult: ReturnType<typeof runEmergencyRuleEngine>;
    rawFeatures: number[];
    scaledFeatures: number[] | null;
    /** @alias ae_score_mse */ aeScore: number | null;
    threshold: number;
    /** @alias ml_anomaly_flag */ isAnomaly: boolean;
    promptShown: boolean;
    /** @alias sensor_anomaly_type */ initialAnomalyType: UC2ContextualType | SensorAnomalyType;
    /** @alias post_hitl_anomaly_type */ postHitlAnomalyType: UC2ContextualType | PostHitlAnomalyType;
    /** @alias top_reconstruction_contributors */ topFeatureEvidence: ReturnType<typeof getTopReconstructionContributions>;
    featureQuality: Record<string, import("./uc2Types").FeatureQuality>;
    finalDecision: ReturnType<typeof finalDecision>;
    initialMCPPayload: ReturnType<typeof buildInitialMCPPayload> | InitialMcpPayload | null;
    finalSLMPayload: ReturnType<typeof buildFinalSLMPayload> | FinalSlmPayload | null;

    // â”€â”€ NEW EXPLICIT V2 FIELDS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // (These mirror the new DecisionLayerResult shape so both call sites work)
    ae_score_mse?: number | null;                           // alias: aeScore
    ml_anomaly_flag?: boolean;                              // alias: isAnomaly
    pre_hitl_severity?: Severity;
    post_hitl_severity?: Severity;
    sensor_anomaly_type?: SensorAnomalyType;                // richer label than initialAnomalyType
    post_hitl_anomaly_type?: PostHitlAnomalyType;           // richer label than postHitlAnomalyType
    anomaly_family?: AnomalyFamily | undefined;
    caregiver_selected_codes?: CaregiverObservationCode[];
    max_matrix_delta?: 0 | 1 | 2 | 3;
    critical_route_triggered?: boolean;
    personalized_threshold_severity_floor?: Severity;
    recurrence_severity_floor?: Severity;
    final_notification_type?: FinalNotificationType;
    final_notification_level?: FinalNotificationLevel;
    quality_tags?: FeatureQualityTag[];                     // empty [] on legacy path (no quality tagging)
    quality_warnings?: string[];
    emergency_rule_result?: ReturnType<typeof runEmergencyRuleEngine>;  // alias: emergencyResult
    slm_payload?: FinalSlmPayload | null;                   // alias: finalSLMPayload (new shape)
    provider_payload?: FinalSlmPayload | null;              // alias: slm_payload
    mcp_payload?: InitialMcpPayload | null;                 // alias: initialMCPPayload (new shape)
    audit_event?: AuditEvent;
};

/**
 * @deprecated Legacy 18D compat function. MUST NOT drive production AE scoring.
 * This function:
 *   - Uses buildUC2FeatureVector (18D) + scaleFeatures (no 12D enforcement)
 *   - Uses the old UC2_FEATURE_ORDER (18 features including BP/glucose)
 *   - Cannot use scaleVector (which enforces 12D)
 *   - Does NOT call signalValidation, sustainedDuration, or personalizedThresholds
 *
 * Production runtime uses runUC2DecisionLayerV2.
 * This function is retained only for parity.ts and the demo controller
 * side-by-side comparison view. Its runTFLiteAutoencoder callback MUST
 * use the legacy 18D model if called with a real model.
 */
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
            // â”€â”€ old-compatible fields â”€â”€
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
            // â”€â”€ new v2 fields â”€â”€
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

    // â”€â”€ Derive v2 field values from legacy-path outputs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        // â”€â”€ old-compatible fields â”€â”€
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
        // â”€â”€ new v2 fields â”€â”€
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

// Maps old UC2ContextualType â†’ new SensorAnomalyType (best-effort for legacy path)
function legacyContextualToSensorType(ctx: UC2ContextualType): SensorAnomalyType {
    switch (ctx) {
        case "RESPIRATORY_CONCERN": return "CARDIO_RESPIRATORY_SIGNAL_CHANGE";
        case "GI_AUTONOMIC_RISK": return "UNEXPLAINED_PHYSIOLOGIC_STRESS";
        case "SLEEP_STRESS_RECOVERY": return "SLEEP_RECOVERY_DEVIATION";
        case "EXERTION_LIKE_PATTERN": return "EXERTION_OR_ACTIVITY_PATTERN";
        case "CRITICAL_EMERGENCY_ALERT": return "CRITICAL_VITAL_THRESHOLD";
        case "GENERAL_MULTIVARIATE_ANOMALY": return "UNEXPLAINED_PHYSIOLOGIC_STRESS";
        case "NORMAL_PATTERN": return "NORMAL_PATTERN";
        default: return "NORMAL_PATTERN";
    }
}

// Maps old UC2ContextualType â†’ new PostHitlAnomalyType (best-effort for legacy path)
function legacyContextualToPostHitlType(ctx: UC2ContextualType): PostHitlAnomalyType {
    switch (ctx) {
        case "RESPIRATORY_CONCERN": return "RESPIRATORY_CONCERN";
        case "GI_AUTONOMIC_RISK": return "GI_AUTONOMIC_RISK";
        case "SLEEP_STRESS_RECOVERY": return "SLEEP_STRESS_RECOVERY";
        case "EXERTION_LIKE_PATTERN": return "EXERTION_LIKE_PATTERN";
        case "CRITICAL_EMERGENCY_ALERT": return "CRITICAL_EMERGENCY_ALERT";
        case "GENERAL_MULTIVARIATE_ANOMALY": return "PROVIDER_REVIEW_RECOMMENDED";
        case "NORMAL_PATTERN": return "NORMAL_PATTERN";
        default: return "NORMAL_PATTERN";
    }
}

/**
 * Watch12 production decision layer (v2).
 *
 * Pipeline ordering:
 *   1. Build 12D Watch-native feature vector
 *   2. Signal artifact validation (BEFORE emergency rules)
 *   3. If artifact â†’ route to INSUFFICIENT_DATA, return early
 *   4. Run emergency rules (hard safety thresholds)
 *   5. Emergency short-circuits at severity 3
 *   6. Evaluate personalized thresholds (AE features + external measurements)
 *   7. Scale 12D vector with strict validation
 *   8. Run 12D TFLite AE
 *   9. Compute 12D AE score + top_contributors
 *  10. Classify sensor anomaly (Watch12 routing groups)
 *  11. Evaluate caregiver HITL
 *  12. Provisional final decision (for recurrence risk input)
 *  13. Evaluate recurrence risk
 *  14. Evaluate sustained duration
 *  15. Make final decision (all floors including sustained)
 *  16. Build payloads when appropriate
 *
 * Enforces 12D through the entire pipeline.
 * BP/glucose resolved from externalMeasurements â€” never from AE features.
 */
export async function runUC2DecisionLayerV2(params: {
    raw: RawObservationInput;
    profile?: PatientProfile;
    caregiverInput?: CaregiverHitlInput;
    history?: HistoricalAnomalyEvent[];
    scaler: ScalerParams;
    interpreter?: TfliteInterpreterLike;
    aeThreshold?: number;
    /**
     * Previous observation for signal rate-of-change validation.
     * When provided, enables HR/SpO2 artifact detection.
     */
    previous?: PreviousObservationInput;
    /**
     * External measurements (BP, glucose) for personalized threshold rules.
     * These are NOT fed into the AE feature vector.
     * If not supplied, values are sourced from raw.blood_pressure_systolic etc.
     */
    externalMeasurements?: ExternalMeasurements;
    /**
     * Optional custom AlertHysteresisManager (defaults to globalAlertHysteresisManager).
     */
    hysteresisManager?: import("./anomalyHistoryStore").AlertHysteresisManager;
}): Promise<DecisionLayerResult> {
    const hysteresisMgr = params.hysteresisManager ?? globalAlertHysteresisManager;

    // â”€â”€ Step 1: Build 12D Watch-native feature vector â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const built = buildCompletedFeatureVector(params.raw, params.profile);

    // Collect external measurements: prefer explicit param, fall back to raw fields
    const external: ExternalMeasurements = params.externalMeasurements ?? {
        blood_pressure_systolic: params.raw.blood_pressure_systolic,
        blood_pressure_diastolic: params.raw.blood_pressure_diastolic,
        glucose_level: params.raw.glucose_level,
    };

    // â”€â”€ Step 2: Update TTL stream cache with current heart_rate reading â”€â”€â”€â”€â”€â”€â”€
    if (typeof built.features.heart_rate === "number") {
        globalVitalsTTLCache.updateSample(
            params.raw.patient_id,
            "heart_rate",
            built.features.heart_rate,
            params.raw.timestamp_iso
        );
    }

    // â”€â”€ Step 3: Signal artifact validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const signal_validation = validateSignalPhysiologicBounds({
        current: params.raw,
        previous: params.previous,
    });

    // Only flag HR stream as expired when there is no cached reading within TTL.
    // A first-ever observation is NOT an expiry â€” only a previously-seen HR that
    // has gone stale (> 10 min with no update AND no current reading) is expired.
    const HR_TTL_MS = 10 * 60 * 1000;
    const priorHrEntry = globalVitalsTTLCache.getCachedSample(
        params.raw.patient_id,
        "heart_rate",
        params.raw.timestamp_iso,
        HR_TTL_MS
    );
    const hrStreamExpired =
        typeof built.features.heart_rate !== "number" &&
        priorHrEntry === undefined;

    // Artifact / stale-HR early exit â€” does NOT fire emergency
    if (signal_validation.isArtifact || hrStreamExpired) {
        const artifactReasons = [
            ...signal_validation.reasons,
            ...(hrStreamExpired ? ["Heart rate stream TTL expired (> 10 min). Passive monitoring only."] : []),
        ];
        const mergedTags = [
            ...built.feature_quality_tags,
            ...signal_validation.feature_quality_tags,
        ];

        const artifactEmergency = runEmergencyRuleEngine(built.features);
        // Override â€” artifact/TTL-expired signals MUST NOT fire emergency
        const safeEmergency = { ...artifactEmergency, is_emergency: false, emergency: false };

        const artifact_final_decision = makeFinalDecision({
            emergency: safeEmergency,
            sensor: {
                sensor_anomaly_type: "INSUFFICIENT_DATA",
                pre_hitl_severity: 1,
                reasons: artifactReasons,
            },
            caregiver: null,
            personalized: null,
            recurrence: null,
            sustained: null,
        });

        return {
            emergency: safeEmergency,
            features: built.features,
            feature_vector: built.feature_vector,
            feature_quality_tags: mergedTags,
            ae: null,
            sensor_classification: {
                sensor_anomaly_type: "INSUFFICIENT_DATA",
                pre_hitl_severity: 1,
                reasons: artifactReasons,
            },
            caregiver_hitl: null,
            personalized_thresholds: null,
            recurrence: null,
            sustained_duration: null,
            signal_validation,
            final_decision: artifact_final_decision,
            initial_mcp_payload: null,
            final_slm_payload: null,
        };
    }

    // â”€â”€ Step 4: Off-wrist contact detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const wristCheck = validateWatchWristContact(params.raw);
    if (wristCheck.isOffWrist) {
        const mergedOffWristTags = [
            ...built.feature_quality_tags,
            ...wristCheck.feature_quality_tags,
        ];
        const offWristEmergency = {
            is_emergency: false, emergency: false, reasons: wristCheck.reasons,
            severity: 0 as Severity, reason: null, pipelinePath: "UC2_SLOW_PATH" as PipelinePath,
        } satisfies EmergencyRuleResult;
        const offWristFinal = makeFinalDecision({
            emergency: offWristEmergency,
            sensor: {
                sensor_anomaly_type: "WATCH_OFF_WRIST",
                pre_hitl_severity: 0,
                reasons: wristCheck.reasons,
            },
            caregiver: null,
            personalized: null,
            recurrence: null,
            sustained: null,
        });
        return {
            emergency: offWristEmergency,
            features: built.features,
            feature_vector: built.feature_vector,
            feature_quality_tags: mergedOffWristTags,
            ae: null,
            sensor_classification: {
                sensor_anomaly_type: "WATCH_OFF_WRIST",
                pre_hitl_severity: 0,
                reasons: wristCheck.reasons,
            },
            caregiver_hitl: null,
            personalized_thresholds: null,
            recurrence: null,
            sustained_duration: null,
            signal_validation: null,
            final_decision: offWristFinal,
            initial_mcp_payload: null,
            final_slm_payload: null,
        };
    }

    // â”€â”€ Step 5: Emergency engine â€” hard safety thresholds â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Fires AFTER signal validation and off-wrist check so vitals are clean.
    const emergency = runEmergencyRuleEngine(built.features);

    if (emergency.is_emergency) {
        const hysteresisEval = hysteresisMgr.evaluateAndStep({
            patient_id: params.raw.patient_id,
            timestamp_iso: params.raw.timestamp_iso,
            is_anomaly: true,
            post_hitl_anomaly_type: "CRITICAL_EMERGENCY_ALERT",
            final_severity: 3,
            is_emergency: true,
        });

        const final_decision = makeFinalDecision({
            emergency,
            sensor: null,
            caregiver: null,
            personalized: null,
            recurrence: null,
            sustained: null,
            suppression: hysteresisEval.suppressionStatus,
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
            sustained_duration: null,
            signal_validation: null,
            alert_hysteresis: hysteresisEval.hysteresisState,
            suppression_status: hysteresisEval.suppressionStatus,
            final_decision,
            initial_mcp_payload: null,
            final_slm_payload: null,
        };
    }

    // â”€â”€ Step 6: Personalized thresholds (AE features + external measurements) â”€
    const personalized = evaluatePersonalizedThresholds(
        built.features,
        params.profile,
        external
    );

    // â”€â”€ Step 7: Adaptive AE threshold from patient risk tier / GMFCS â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const adjustedAeThreshold = getAdjustedAEThreshold(params.aeThreshold ?? 0.5, params.profile);

    // â”€â”€ Step 8: Scale 12D vector with adaptive patient baseline shift â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const scaled = scaleVector(built.feature_vector, params.scaler, params.profile);

    // â”€â”€ Step 9: Run 12D TFLite AE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const reconstructed = await runTinyAutoencoderTflite(
        scaled,
        params.interpreter
    );

    // â”€â”€ Step 10: Compute 12D AE score with adaptive threshold â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const ae = computeAutoencoderScore(
        scaled,
        reconstructed,
        built.features,
        adjustedAeThreshold
    );

    // â”€â”€ Step 11: Classify sensor anomaly (Watch12 routing groups) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const sensor = classifySensorAnomaly(built.features, ae, null);

    // â”€â”€ Step 12: Evaluate caregiver HITL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const caregiver = evaluateCaregiverHitl(
        params.caregiverInput,
        sensor.sensor_anomaly_type,
        sensor.pre_hitl_severity
    );

    // â”€â”€ Step 13: Provisional final decision (feeds recurrence) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const provisionalFinal = makeFinalDecision({
        emergency,
        sensor,
        caregiver,
        personalized,
        recurrence: null,
        sustained: null,
    });

    // â”€â”€ Step 14: Recurrence risk â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const recurrence = evaluateRecurrenceRisk({
        patient_id: params.raw.patient_id,
        timestamp_iso: params.raw.timestamp_iso,
        current_post_hitl_type: provisionalFinal.post_hitl_anomaly_type ?? "NORMAL_PATTERN",
        history: params.history,
        emergencyAlreadyDetected: false,
    });

    // â”€â”€ Step 15: Sustained duration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const sustained = evaluateSustainedDuration({
        patient_id: params.raw.patient_id,
        timestamp_iso: params.raw.timestamp_iso,
        current_sensor_anomaly_type: sensor.sensor_anomaly_type,
        current_pre_hitl_severity: sensor.pre_hitl_severity,
        history: params.history,
    });

    // â”€â”€ Step 16: Alert Hysteresis & Suppression Engine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const hysteresisEval = hysteresisMgr.evaluateAndStep({
        patient_id: params.raw.patient_id,
        timestamp_iso: params.raw.timestamp_iso,
        is_anomaly: ae.is_anomaly || provisionalFinal.final_severity > 0,
        sensor_anomaly_type: sensor.sensor_anomaly_type,
        post_hitl_anomaly_type: provisionalFinal.post_hitl_anomaly_type,
        pre_hitl_severity: sensor.pre_hitl_severity,
        final_severity: provisionalFinal.final_severity,
        is_emergency: false,
    });

    // â”€â”€ Step 17: Final decision (all floors, including hysteresis suppression) â”€
    const final_decision = makeFinalDecision({
        emergency,
        sensor,
        caregiver,
        personalized,
        recurrence,
        sustained,
        suppression: hysteresisEval.suppressionStatus,
    });

    // â”€â”€ Step 18: Build payloads â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const initial_mcp_payload =
        final_decision.should_build_initial_mcp_payload && ae.is_anomaly
            ? buildInitialMcpPayload({
                patient_id: params.raw.patient_id,
                timestamp_iso: params.raw.timestamp_iso,
                sensor,
                ae,
                feature_quality_tags: built.feature_quality_tags,
                signal_validation,
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
                sustained,
                signal_validation,
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
        sustained_duration: sustained,
        signal_validation: signal_validation.isArtifact ? signal_validation : null,
        alert_hysteresis: hysteresisEval.hysteresisState,
        suppression_status: hysteresisEval.suppressionStatus,
        final_decision,
        initial_mcp_payload,
        final_slm_payload,
        audit_event,
    };
}
