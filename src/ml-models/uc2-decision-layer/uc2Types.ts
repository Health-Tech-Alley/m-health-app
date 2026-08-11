/**
 * UC2 decision-layer type definitions.
 *
 * v3 (Watch12): FeatureName narrowed to 12 Watch-native AE features.
 * Legacy 18-feature helpers use Legacy18FeatureName to avoid polluting the AE type system.
 *
 * v2 (EHR handoff): All new types from the handoff are added here.
 * Old types are PRESERVED for backward compatibility with:
 *   - alert-ml-service.ts
 *   - care-management-controller.ts
 *   - parity.ts
 *
 * Backward-compat aliases are marked with // @compat below.
 */

// ── Watch12 AE Feature type (12D only) ───────────────────────────────────────

/**
 * Canonical 12-feature Watch-native AE feature names.
 * These are the ONLY features that may appear in:
 *   - FEATURE_ORDER
 *   - feature_vector (AE input tensor)
 *   - CompletedFeatureVector
 *   - FeatureQualityTag.feature
 *   - top_contributors
 *   - AE imputation path
 */
export type WatchFeatureName =
    | "heart_rate"
    | "blood_oxygen"
    | "respiratory_rate"
    | "hrv_sdnn"
    | "body_temperature"
    | "activity_level"
    | "steps_count"
    | "calories_burned"
    | "sleep_quality"
    | "hour_sin"
    | "hour_cos"
    | "is_sleep_window";

/**
 * FeatureName is now the 12-feature Watch-native set.
 * Use this everywhere in the AE pipeline.
 */
export type FeatureName = WatchFeatureName;

// ── Legacy 18-feature type (for compat helpers ONLY) ─────────────────────────

/**
 * Legacy 18-feature names for use ONLY in @compat helpers:
 *   - buildUC2FeatureVector (featureEngineering.ts)
 *   - imputeUnavailableFeatures (featureImputation.ts)
 *   - runUC2DecisionLayer v1 (runUC2DecisionLayer.ts)
 *   - parity.ts
 *   - UC2_FEATURE_ORDER constant
 *
 * Must NOT appear in AE scoring, scaler, tfliteModelAdapter, or top_contributors.
 *
 * @deprecated Use FeatureName (WatchFeatureName) for all new code.
 */
export type Legacy18FeatureName =
    | "heart_rate"
    | "blood_oxygen"
    | "blood_pressure_systolic"
    | "blood_pressure_diastolic"
    | "glucose_level"
    | "body_temperature"
    | "respiratory_rate"
    | "activity_level"
    | "sleep_quality"
    | "stress_level"
    | "hrv_sdnn"
    | "steps_count"
    | "calories_burned"
    | "pulse_pressure"
    | "mean_arterial_pressure"
    | "hour_sin"
    | "hour_cos"
    | "is_sleep_window";

// ── External measurement types (BP, glucose — outside AE) ────────────────────

/**
 * Names for external measurements that are NOT in the AE tensor.
 * Used by personalized threshold rules, care plans, and payload context only.
 */
export type ExternalMeasurementName =
    | "blood_pressure_systolic"
    | "blood_pressure_diastolic"
    | "glucose_level";

/**
 * Union of AE features + external measurements, for care-plan threshold rules.
 */
export type ThresholdFeatureName = FeatureName | ExternalMeasurementName;

/**
 * External measurements carried alongside raw observation input but
 * NOT fed into the AE feature vector, scaler, or reconstruction error.
 * Used for BP/CGM personalized threshold rules only.
 */
export interface ExternalMeasurements {
    blood_pressure_systolic?: number;
    blood_pressure_diastolic?: number;
    glucose_level?: number;
}

// ── Feature source / quality ──────────────────────────────────────────────────

export type FeatureSource =
    | "observed_watch"      // directly measured by Apple Watch
    | "observed_manual"     // entered by caregiver/patient
    | "observed_device"     // from another connected device
    | "derived"             // computed from other features (e.g., hour_sin)
    | "ehr_profile"         // filled from EHR/profile baseline
    | "care_plan"           // from care plan threshold
    | "imputed_default"     // fallback population default
    | "unavailable"         // truly missing; inference may be reduced-confidence
    | "signal_artifact"     // rate-of-change artifact detected; value not trusted
    | "WATCH_OFF_WRIST"     // watch optical wrist contact indicates off-wrist
    | "observed"            // @compat
    | "imputed";            // @compat

/**
 * @compat Old FeatureQuality type — now an alias for the richer FeatureSource.
 * Old values "observed" / "imputed" / "derived" remain valid as subsets.
 */
export type FeatureQuality = FeatureSource;

export type Severity = 0 | 1 | 2 | 3;

// ── Notification types ────────────────────────────────────────────────────────

export type FinalNotificationType =
    | "NO_ALERT"
    | "MONITORING_ADVICE"
    | "SLM_SUMMARY_AND_PROVIDER_NOTE"
    | "CRITICAL_EMERGENCY_ALERT"
    | "DISMISSED_WITH_AUDIT";

export type FinalNotificationLevel =
    | "monitor"
    | "follow_up"
    | "critical"
    | "logged_only"
    | null;

// ── Pipeline path (old, kept for compat) ──────────────────────────────────────

export type PipelinePath =
    | "UC2_SLOW_PATH"
    | "RULE_ENGINE_EMERGENCY_FAST_PATH";

// ── Anomaly type labels ───────────────────────────────────────────────────────

/**
 * Pre-HITL sensor anomaly type (new in v2).
 * Replaces the earlier use of UC2ContextualType as the initial classification.
 */
export type SensorAnomalyType =
    | "NORMAL_PATTERN"
    | "CARDIO_RESPIRATORY_SIGNAL_CHANGE"
    | "SLEEP_RECOVERY_DEVIATION"
    | "EXERTION_OR_ACTIVITY_PATTERN"
    | "UNEXPLAINED_PHYSIOLOGIC_STRESS"
    | "POSSIBLE_SEIZURE_LIKE_MOTION"
    | "POSSIBLE_SENSOR_ARTIFACT"
    | "CRITICAL_VITAL_THRESHOLD"
    | "INSUFFICIENT_DATA"
    | "WATCH_OFF_WRIST";

/**
 * Post-HITL / EHR-enriched anomaly type (new in v2).
 */
export type PostHitlAnomalyType =
    | "NORMAL_PATTERN"
    | "RESPIRATORY_CONCERN"
    | "GI_AUTONOMIC_RISK"
    | "SLEEP_STRESS_RECOVERY"
    | "EXERTION_LIKE_PATTERN"
    | "MEDICATION_ADHERENCE_CONCERN"
    | "POSTICTAL_RECOVERY_CONCERN"
    | "SEIZURE_LIKE_EVENT_CONFIRMED"
    | "PROVIDER_REVIEW_RECOMMENDED"
    | "NO_CONCERN_CONFIRMED"
    | "CRITICAL_EMERGENCY_ALERT"
    | "POSSIBLE_SENSOR_ARTIFACT"
    | "INSUFFICIENT_DATA";

/**
 * @compat Old UC2ContextualType — preserved for existing UI components and
 * parity.ts which still reference it. New code should use SensorAnomalyType
 * (pre-HITL) or PostHitlAnomalyType (post-HITL).
 *
 * Mapping to new types:
 *   NORMAL_PATTERN         → SensorAnomalyType.NORMAL_PATTERN
 *   RESPIRATORY_CONCERN    → PostHitlAnomalyType.RESPIRATORY_CONCERN
 *   GI_AUTONOMIC_RISK      → PostHitlAnomalyType.GI_AUTONOMIC_RISK
 *   SLEEP_STRESS_RECOVERY  → PostHitlAnomalyType.SLEEP_STRESS_RECOVERY
 *   EXERTION_LIKE_PATTERN  → PostHitlAnomalyType.EXERTION_LIKE_PATTERN
 *   CRITICAL_EMERGENCY_ALERT → PostHitlAnomalyType.CRITICAL_EMERGENCY_ALERT
 *   GENERAL_MULTIVARIATE_ANOMALY → PostHitlAnomalyType.PROVIDER_REVIEW_RECOMMENDED
 */
export type UC2ContextualType =
    | "NORMAL_PATTERN"
    | "RESPIRATORY_CONCERN"
    | "GI_AUTONOMIC_RISK"
    | "SLEEP_STRESS_RECOVERY"
    | "EXERTION_LIKE_PATTERN"
    | "CRITICAL_EMERGENCY_ALERT"
    | "GENERAL_MULTIVARIATE_ANOMALY";

// ── Anomaly family (used by HITL matrix) ──────────────────────────────────────

export type AnomalyFamily =
    | "CARDIO_RESPIRATORY"
    | "GI_AUTONOMIC"
    | "SLEEP_RECOVERY"
    | "EXERTION_ACTIVITY"
    | "SEIZURE_LIKE"
    | "CRITICAL_VITAL"
    | "NORMAL_OR_UNKNOWN";

// ── Caregiver observation codes ───────────────────────────────────────────────

/**
 * Canonical caregiver observation codes (new in v2).
 * Old codes (e.g., BREATHING_CHANGE, EXERCISE_ACTIVITY) are mapped to these
 * via normalizeCaregiverCodes() in caregiverHitl.ts.
 */
export type CaregiverObservationCode =
    | "EXERCISE_OR_ACTIVITY"
    | "POOR_SLEEP"
    | "STRESS_OR_EMOTIONAL_UPSET"
    | "REDUCED_INTAKE"
    | "MEDICATION_CHANGE_OR_MISSED"
    | "BATHROOM_CHANGES"
    | "VOMITING_OR_DIARRHEA"
    | "WEAK_CONFUSED_NOT_BASELINE"
    | "PAIN_OR_DISCOMFORT"
    | "BREATHING_DIFFERENT"
    | "SENSOR_OR_WATCH_ISSUE"
    | "NOTHING_UNUSUAL_NOTICED"
    | "NOT_SURE";

/**
 * @compat Old caregiver final action — kept for existing callers.
 * New code should use CaregiverHitlInput with selected_codes instead.
 */
export type CaregiverFinalAction =
    | "confirm_concern"
    | "continue_monitoring"
    | "dismiss"
    | "no_prompt_shown";

// ── Alert state machine & hysteresis types ─────────────────────────────────────

export type AlertState = "NORMAL" | "ACTIVE_ALERT";

export interface AlertHysteresisState {
    patient_id: string;
    state: AlertState;
    last_alert_type?: SensorAnomalyType | PostHitlAnomalyType;
    last_alert_timestamp_iso?: string;
    last_alert_severity?: Severity;
    consecutive_normal_count: number;
    normal_since_timestamp_iso?: string;
}

export interface AlertSuppressionStatus {
    is_suppressed: boolean;
    reason?: string;
    original_notification_type?: FinalNotificationType;
    cooldown_expires_iso?: string;
}

// ── Input types ───────────────────────────────────────────────────────────────

/**
 * New v2 raw observation input type (preferred for new code).
 * Uses timestamp_iso (ISO string) and includes source_notes.
 * BP/glucose fields are carried here for external-measurement rules
 * but are NOT fed into the AE feature vector.
 */
export interface RawObservationInput {
    patient_id: string;
    timestamp_iso: string;

    // Optical wrist contact state (Watch off-wrist filter)
    isNearWrist?: boolean;
    wrist_state?: "on" | "off" | string;

    // Watch-native AE features (12D)
    heart_rate?: number;
    blood_oxygen?: number;
    body_temperature?: number;
    respiratory_rate?: number;
    activity_level?: number;
    sleep_quality?: number;
    hrv_sdnn?: number;
    steps_count?: number;
    calories_burned?: number;
    // hour_sin / hour_cos / is_sleep_window derived from timestamp_iso

    // External measurements (NOT in AE tensor)
    blood_pressure_systolic?: number;
    blood_pressure_diastolic?: number;
    glucose_level?: number;

    // Legacy fields carried for compat (not used by AE)
    stress_level?: number;
    pulse_pressure?: number;
    mean_arterial_pressure?: number;
    hour_sin?: number;
    hour_cos?: number;
    is_sleep_window?: number;

    source_notes?: string[];
}

/**
 * Previous observation snapshot for signal rate-of-change validation.
 * Used by signalValidation.ts to detect artifact jumps.
 */
export interface PreviousObservationInput {
    timestamp_iso: string;
    heart_rate?: number;
    blood_oxygen?: number;
}

/**
 * @compat Old AppleWatchVitalsInput — preserved for existing callers.
 * Uses `timestamp` (not `timestamp_iso`) and includes patient/device IDs.
 */
export type AppleWatchVitalsInput = {
    patient_id: string;
    caregiver_id?: string;
    device_id?: string;
    timestamp: string;          // @compat: old name; new type uses timestamp_iso

    // Optical wrist contact state (Watch off-wrist filter)
    isNearWrist?: boolean;
    wrist_state?: "on" | "off" | string;

    heart_rate?: number;
    blood_oxygen?: number;
    respiratory_rate?: number;
    hrv_sdnn?: number;
    steps_count?: number;
    calories_burned?: number;
    sleep_quality?: number;

    blood_pressure_systolic?: number;
    blood_pressure_diastolic?: number;
    glucose_level?: number;
    body_temperature?: number;
    stress_level?: number;
    activity_level?: number;
};

/**
 * @compat Old PatientProfileDefaults — preserved for existing callers.
 * New code should use PatientProfile with PatientBaseline.
 */
export type PatientProfileDefaults = {
    blood_pressure_systolic?: number;
    blood_pressure_diastolic?: number;
    glucose_level?: number;
    body_temperature?: number;
    stress_level?: number;
    activity_level?: number;
};

// ── Feature vector types ──────────────────────────────────────────────────────

/**
 * @compat Old feature vector result — preserved for featureEngineering.ts
 * legacy path. Uses Legacy18FeatureName in featureMap.
 */
export type UC2FeatureVectorResult = {
    rawFeatures: number[];
    featureQuality: Record<string, FeatureQuality>;
    featureMap: Record<string, number>;
};

/**
 * @compat Old TopFeatureEvidence — preserved for anomalyScoring.ts and UI.
 * New code should use AutoencoderResult.top_contributors.
 */
export type TopFeatureEvidence = {
    feature: string;
    importance: number;
    score?: number;
    abs_z?: number;
    direction: "unknown";
    source: "ae_reconstruction_contribution";
};

// ── New v2 feature types ──────────────────────────────────────────────────────

export interface FeatureQualityTag {
    feature: FeatureName;
    source: FeatureSource;
    value: number;
    warning?: string;
}

/**
 * Completed 12D Watch-native AE feature vector.
 * Only contains the 12 canonical Watch AE features.
 */
export type CompletedFeatureVector = Record<FeatureName, number>;

// ── Patient profile types (new in v2) ─────────────────────────────────────────

export interface PatientBaseline {
    resting_heart_rate?: number;
    blood_oxygen?: number;
    respiratory_rate?: number;
    body_temperature?: number;
    systolic_bp?: number;
    diastolic_bp?: number;
    glucose_level?: number;
    hrv_sdnn?: number;
}

export interface CarePlanThreshold {
    /**
     * May be a Watch12 AE feature or an external measurement (BP, glucose).
     * If it references an ExternalMeasurementName, it must be resolved from
     * ExternalMeasurements, not from CompletedFeatureVector.
     */
    feature: ThresholdFeatureName;
    operator: "gte" | "lte" | "delta_gte" | "delta_lte";
    value: number;
    severity_floor: Severity;
    reason: string;
}

export interface PatientProfile {
    patient_id: string;
    display_name?: string;
    date_of_birth?: string;
    conditions?: string[];
    medications?: string[];
    care_plan_goals?: string[];
    baseline?: PatientBaseline;
    care_plan_thresholds?: CarePlanThreshold[];
    clinician_recipient?: {
        name?: string;
        role?: string;
        endpoint?: string;
    };
    /**
     * Functional classification scales for cerebral palsy / severe disability.
     * Populated from FHIR Patient extensions in `ehrProfileAdapter.ts` and
     * drive the v2 personalized-threshold floor.
     *
     * - `gmfcs_level`: Gross Motor Function Classification System (I–V).
     *   Level V is the most severe mobility impairment.
     * - `macs`: Manual Ability Classification System (I–V).
     * - `cfcs`: Communication Function Classification System (I–V).
     * - `edacs`: Eating and Drinking Ability Classification System (I–V).
     */
    gmfcs_level?: string;
    macs?: string;
    cfcs?: string;
    edacs?: string;
    /**
     * Adaptive rolling 7-day patient baseline parameters.
     * rolling_7d_mean (mu_p) and rolling_7d_std (sigma_p) per feature.
     */
    rolling_7d_mean?: Partial<Record<FeatureName, number>>;
    rolling_7d_std?: Partial<Record<FeatureName, number>>;
    /** Patient clinical risk tier for dynamic AE threshold adjustment. */
    clinical_risk_tier?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface FhirBundle {
    resourceType: "Bundle";
    entry?: Array<{
        resource?: any;
    }>;
}

// ── Scaler / model types ──────────────────────────────────────────────────────

/**
 * @compat Old UC2Scaler — kept for existing scaler.ts callers (v1 compat path).
 * The v1 path calls scaleFeatures() which does not enforce 12D.
 * New Watch12 code uses ScalerParams with scaleVector() which enforces 12D.
 */
export type UC2Scaler = {
    mean: number[];
    scale: number[];
};

/** New v2 scaler params (superset of UC2Scaler). scaleVector() enforces 12D. */
export interface ScalerParams {
    mean: number[];
    scale: number[];
    feature_order?: string[];
    feature_cols?: string[];
}

export interface AutoencoderResult {
    ae_score: number;
    ae_threshold: number;
    is_anomaly: boolean;
    reconstructed?: number[];
    top_contributors: Array<{
        feature: FeatureName;
        contribution: number;
        value: number;
    }>;
}

// ── Signal validation (Watch12 artifact detection) ───────────────────────────

/**
 * Result of physiologic rate-of-change validation.
 * Artifacts detected here should route to INSUFFICIENT_DATA and must
 * NOT trigger emergency escalation for impossible vital jumps.
 */
export interface SignalValidationResult {
    isArtifact: boolean;
    sensor_anomaly_type?: SensorAnomalyType;
    reasons: string[];
    artifact_features: FeatureName[];
    feature_quality_tags: FeatureQualityTag[];
}

// ── Sustained duration (Watch12 temporal escalation) ─────────────────────────

/**
 * Result of continuous sustained-duration analysis.
 * Only eligible anomaly types (CARDIO_RESPIRATORY_SIGNAL_CHANGE,
 * UNEXPLAINED_PHYSIOLOGIC_STRESS) accumulate a sustained floor.
 */
export interface SustainedDurationResult {
    sustained_minutes: number;
    sustained_severity_floor: Severity;
    sustained_reasons: string[];
}

// ── Emergency rule result ─────────────────────────────────────────────────────

/**
 * @compat Old EmergencyRuleResult — extended with new fields.
 * Old field: emergency (boolean)
 * New field: is_emergency (alias for emergency)
 * Old field: reason (single string)
 * New field: reasons (array of strings)
 * Old field: pipelinePath
 * New field: (omitted in new shape — callers can infer from is_emergency)
 */
export type EmergencyRuleResult = {
    // @compat old fields
    emergency: boolean;
    severity: Severity;
    reason: string | null;
    pipelinePath: PipelinePath;
    // new v2 fields
    is_emergency?: boolean;       // alias for emergency
    reasons?: string[];           // new: array version of reason
};

// ── Sensor classification (new in v2) ─────────────────────────────────────────

export interface SensorClassificationResult {
    sensor_anomaly_type: SensorAnomalyType;
    pre_hitl_severity: Severity;
    reasons: string[];
}

// ── Caregiver HITL types (new in v2) ─────────────────────────────────────────

export interface CaregiverHitlInput {
    selected_codes: CaregiverObservationCode[];
    free_text_note?: string;
    confirmed_at_iso?: string;
}

export interface CaregiverMatrixCell {
    severity_delta: 0 | 1 | 2 | 3;
    critical_route:
        | "none"
        | "route_critical"
        | "route_critical_if_severe_dehydration_or_altered_state";
    reason: string;
}

export type CaregiverObservationMatrix = Record<
    CaregiverObservationCode,
    Record<AnomalyFamily, CaregiverMatrixCell>
>;

export interface CaregiverMatrixEvaluation {
    anomaly_family: AnomalyFamily;
    max_matrix_delta: 0 | 1 | 2 | 3;
    matrix_reasons: string[];
    critical_route_triggered: boolean;
    critical_route_reasons: string[];
}

export interface CaregiverHitlResult {
    caregiver_selected_codes: CaregiverObservationCode[];
    observation_severity_floor: Severity;
    observation_reasons: string[];
    data_quality_warning: boolean;
    human_context:
        | "caregiver_concern"
        | "no_observed_concern"
        | "sensor_issue"
        | "not_sure"
        | "not_provided";
    anomaly_family: AnomalyFamily | undefined;
    max_matrix_delta: 0 | 1 | 2 | 3;
    critical_route_triggered: boolean;
    critical_route_reasons: string[];
}

// ── Personalized thresholds (new in v2) ───────────────────────────────────────

export interface PersonalizedThresholdResult {
    personalized_threshold_severity_floor: Severity;
    personalized_threshold_reasons: string[];
    baseline_deviation_score: number;
}

// ── Anomaly history / recurrence (new in v2) ──────────────────────────────────

export interface HistoricalAnomalyEvent {
    patient_id: string;
    timestamp_iso: string;
    post_hitl_anomaly_type: PostHitlAnomalyType;
    final_severity: Severity;
    caregiver_confirmed: boolean;
    /**
     * Optional pre-HITL sensor anomaly type, used by sustainedDuration.ts to
     * determine eligibility for sustained-duration escalation.
     * Added in Watch12 migration; may be absent in older history records.
     */
    sensor_anomaly_type?: SensorAnomalyType;
}

export interface RecurrenceRiskResult {
    recurrence_risk_score: number;
    recurrence_severity_floor: Severity;
    recurrence_reasons: string[];
    same_class_count: number;
    related_class_count: number;
    caregiver_confirmed_count: number;
    prior_severity2_count: number;
    prior_severity3_count: number;
}

// ── Final decision result ─────────────────────────────────────────────────────

/**
 * FinalDecisionResult — extended in v2 to include new fields.
 *
 * @compat Old fields preserved:
 *   final_notification_type, final_notification_level, final_severity,
 *   final_notification_title, final_notification_body,
 *   slm_refinement_queued, refinement_reason
 *
 * New v2 fields:
 *   post_hitl_anomaly_type, post_hitl_severity,
 *   should_build_initial_mcp_payload, should_build_final_slm_payload,
 *   final_reasons
 */
export type FinalDecisionResult = {
    // @compat old fields
    final_notification_type: FinalNotificationType;
    final_notification_level: FinalNotificationLevel;
    final_severity: Severity;               // alias for post_hitl_severity
    final_notification_title: string;
    final_notification_body: string;
    slm_refinement_queued: boolean;
    refinement_reason: string | null;

    // new v2 fields
    post_hitl_anomaly_type?: PostHitlAnomalyType;
    post_hitl_severity?: Severity;           // primary severity field
    should_build_initial_mcp_payload?: boolean;
    should_build_final_slm_payload?: boolean;
    final_reasons?: string[];
    suppression_status?: AlertSuppressionStatus;
};

// ── Payload types (new in v2) ─────────────────────────────────────────────────

export interface InitialMcpPayload {
    event_name: string;
    patient_id: string;
    timestamp_iso: string;
    sensor_anomaly_type: SensorAnomalyType;
    pre_hitl_severity: Severity;
    ae_score: number;
    ae_threshold: number;
    top_contributors: AutoencoderResult["top_contributors"];
    feature_quality_tags: FeatureQualityTag[];
    suggested_caregiver_prompt: string;
    signal_validation?: SignalValidationResult;
}

export interface FinalSlmPayload {
    event_name: string;
    patient_id: string;
    timestamp_iso: string;
    model_name: string;
    model_version: string;

    ae_score: number | null;
    ae_threshold: number | null;
    top_contributors: AutoencoderResult["top_contributors"] | [];

    sensor_anomaly_type: SensorAnomalyType;
    post_hitl_anomaly_type: PostHitlAnomalyType;

    pre_hitl_severity: Severity;
    observation_severity_floor: Severity;
    personalized_threshold_severity_floor: Severity;
    recurrence_severity_floor: Severity;
    sustained_duration_severity_floor?: Severity;
    post_hitl_severity: Severity;

    final_notification_type: FinalNotificationType;
    final_notification_level: FinalNotificationLevel;

    caregiver_selected_codes: CaregiverObservationCode[];
    caregiver_note?: string;

    personalized_threshold_reasons: string[];
    baseline_deviation_score: number;

    recurrence_risk_score: number;
    recurrence_reasons: string[];
    same_class_count: number;
    related_class_count: number;

    feature_quality_tags: FeatureQualityTag[];
    patient_context: {
        conditions?: string[];
        medications?: string[];
        care_plan_goals?: string[];
        clinician_recipient?: PatientProfile["clinician_recipient"];
    };

    signal_validation?: SignalValidationResult;
    sustained_duration?: SustainedDurationResult;
    suppression_status?: AlertSuppressionStatus;

    slm_safety_boundary: string;
}

// ── New DecisionLayerResult (from new runUC2DecisionLayer v2 path) ─────────────

export interface DecisionLayerResult {
    emergency: EmergencyRuleResult;
    features?: CompletedFeatureVector;
    feature_vector?: number[];
    feature_quality_tags?: FeatureQualityTag[];

    ae?: AutoencoderResult | null;
    sensor_classification?: SensorClassificationResult | null;
    caregiver_hitl?: CaregiverHitlResult | null;
    personalized_thresholds?: PersonalizedThresholdResult | null;
    recurrence?: RecurrenceRiskResult | null;
    sustained_duration?: SustainedDurationResult | null;
    signal_validation?: SignalValidationResult | null;
    alert_hysteresis?: AlertHysteresisState | null;
    suppression_status?: AlertSuppressionStatus | null;
    final_decision: FinalDecisionResult;

    initial_mcp_payload?: InitialMcpPayload | null;
    final_slm_payload?: FinalSlmPayload | null;

    /** Built by runUC2DecisionLayerV2 — save via anomalyHistoryStore for recurrence tracking. */
    audit_event?: AuditEvent;
}

// ── Audit event (new in v2) ───────────────────────────────────────────────────

export interface AuditEvent {
    event_id: string;
    patient_id: string;
    timestamp_iso: string;
    pipeline_path: PipelinePath;
    emergency_triggered: boolean;
    ae_score: number | null;
    pre_hitl_severity: Severity;
    post_hitl_severity: Severity;
    final_notification_type: FinalNotificationType;
    caregiver_selected_codes: CaregiverObservationCode[];
    quality_warnings: string[];
    model_name: string;
    model_version: string;
}
