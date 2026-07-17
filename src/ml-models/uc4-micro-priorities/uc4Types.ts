export const UC4_SCHEMA_VERSION = "uc4_schema_v0.1.0";
export const UC4_TEMPLATE_REGISTRY_VERSION = "uc4_template_registry_v0.1.0";
export const UC4_RULE_REGISTRY_VERSION = "uc4_rule_registry_v0.1.0";
export const UC4_SCORING_VERSION = "uc4_scoring_v0.1.0";
export const UC4_ENGINE_VERSION = "uc4_structured_micropriority_engine_v0.1.0";

export type PatientId = string;

export type UC4PriorityKind =
  | "recurring_concern"
  | "emerging_pattern"
  | "blind_spot"
  | "provider_review_support";

export type UC4SeverityContext =
  | "routine"
  | "uc2_severity_1_monitor"
  | "uc2_severity_2_provider_review"
  | "uc1_or_uc2_severity_3_emergency";

export type ObservationCode =
  | "LOOKS_NORMAL"
  | "NOT_SURE"
  | "DEVICE_OR_SENSOR_ISSUE"
  | "RECENT_ACTIVITY_OR_EXERTION"
  | "LOW_MOVEMENT"
  | "TRANSFER_OR_POSITIONING_CONTEXT"
  | "PAIN_OR_DISCOMFORT"
  | "UNUSUAL_FATIGUE"
  | "POOR_SLEEP_OR_RESTLESSNESS"
  | "BREATHING_CONCERN"
  | "COLOR_OR_OXYGEN_CONCERN"
  | "MISSED_OR_DELAYED_MEDICATION"
  | "RECENT_MEDICATION_CHANGE"
  | "APPETITE_OR_HYDRATION_CHANGE"
  | "BOWEL_OR_BLADDER_CHANGE"
  | "SKIN_OR_PRESSURE_CONCERN"
  | "SEIZURE_LIKE_EVENT_REPORTED"
  | "UNUSUAL_RESPONSIVENESS"
  | "CAREGIVER_WANTS_PROVIDER_REVIEW"
  | "FALL_OR_NEAR_FALL"
  | "THERAPY_ROUTINE_DIFFICULTY";

export type ContextCode =
  | "DURING_TRANSFER"
  | "WHILE_SITTING_OR_POSITIONED"
  | "AFTER_ACTIVITY_OR_THERAPY"
  | "AROUND_MEDICATION_TIME"
  | "DURING_SLEEP_OR_NIGHT"
  | "MEAL_OR_HYDRATION_RELATED"
  | "BATHROOM_OR_BOWEL_BLADDER"
  | "UNKNOWN_OR_NOT_SURE";

export type MedicationWatchCode =
  | "SLEEPINESS_FATIGUE"
  | "DIZZINESS_OR_LIGHTHEADEDNESS"
  | "WEAKNESS_OR_LOW_TONE_CONCERN"
  | "MOOD_BEHAVIOR_CHANGE"
  | "APPETITE_OR_HYDRATION_CHANGE"
  | "BOWEL_CHANGE"
  | "BREATHING_CONCERN"
  | "HEART_RATE_OR_BP_CONCERN"
  | "SKIN_RASH_OR_ALLERGY_CONCERN"
  | "MISSED_OR_DELAYED_DOSE"
  | "MEDICATION_TIMING_CONTEXT_NEEDED";

export interface UC4PatientProfile {
  patientId: PatientId;
  displayName: string;
  synthetic: boolean;
  primaryContextLabel?: string;
  carePlanFocusCodes: string[];
  caregiverRelationship?: string;
}

export interface UC4MedicationProfile {
  patientId: PatientId;
  medicationName: string;
  synthetic: boolean;
  watchAreas: MedicationWatchCode[];
  scheduleText?: string;
}

export interface UC4StructuredEvent {
  eventId: string;
  patientId: PatientId;
  timestampIso: string;
  source:
    | "caregiver_checkin"
    | "uc1_emergency"
    | "uc2_slow_path"
    | "uc4_response"
    | "wearable_summary"
    | "ehr_or_care_plan";
  observationCodes: ObservationCode[];
  contextCodes: ContextCode[];
  severity?: 0 | 1 | 2 | 3;
  freeTextUsedForScoring: false;
  freeTextProviderContext?: string;
  metadata?: Record<string, unknown>;
}

export interface UC4WearableSummary {
  patientId: PatientId;
  windowDays: number;
  lowMovementIncrease?: boolean;
  respiratoryRateDeltaFlag?: boolean;
  sleepDisruptionFlag?: boolean;
  activityDropFlag?: boolean;
  source: "wearable_summary";
}

export interface PreviousUC4Priority {
  patientId: PatientId;
  templateId: UC4TemplateId;
  shownAtIso: string;
  caregiverResponse?: "helpful" | "dismissed" | "not_relevant" | "logged_observation";
}

export type UC4TemplateId =
  | "SKIN_PRESSURE_AFTER_SEATED_PERIOD"
  | "MEDICATION_WINDOW_FATIGUE_TRACKING"
  | "MISSED_DELAYED_MEDICATION_CONTEXT"
  | "TRANSFER_DISCOMFORT_TRACKING"
  | "BOWEL_ROUTINE_DISCOMFORT_CONTEXT"
  | "BREATHING_CONCERN_CONTEXT"
  | "UNUSUAL_RESPONSIVENESS_CONTEXT"
  | "CAREGIVER_REPORTED_SEIZURE_LIKE_EVENT_CONTEXT"
  | "THERAPY_REHAB_ROUTINE_DIFFICULTY"
  | "FALL_OR_NEAR_FALL_CONTEXT"
  | "CAREGIVER_PROVIDER_REVIEW_REQUEST";

export interface WhatToLogNextField {
  fieldId: string;
  label: string;
  type: "single_select" | "multi_select" | "boolean" | "number" | "timestamp" | "short_text_provider_context";
  required: boolean;
  options?: string[];
  usedForScoring: boolean;
}

export interface UC4Template {
  templateId: UC4TemplateId;
  titleTemplate: string;
  bodyTemplate: string;
  priorityKind: UC4PriorityKind;
  domain: string;
  safetyBoundary: string;
  whatToLogNextSchema: WhatToLogNextField[];
  allowedObservationCodes: ObservationCode[];
  allowedContextCodes: ContextCode[];
}

export interface UC4RuleContext {
  patient: UC4PatientProfile;
  medications: UC4MedicationProfile[];
  recentEvents: UC4StructuredEvent[];
  wearableSummary?: UC4WearableSummary;
  previousPriorities: PreviousUC4Priority[];
  uc1ActiveEmergency: boolean;
  currentSeverityContext: UC4SeverityContext;
  aggregateFeatures: Record<string, number | boolean | string | undefined>;
}

export interface EvidenceRef {
  fieldPath: string;
  value: string | number | boolean | null;
  comparator:
    | "eq"
    | "neq"
    | "gte"
    | "lte"
    | "gt"
    | "lt"
    | "contains"
    | "exists"
    | "not_exists";
  threshold?: string | number | boolean;
  source:
    | "patient_profile"
    | "medication_profile"
    | "structured_events"
    | "wearable_summary"
    | "previous_uc4"
    | "uc1_uc2_context"
    | "aggregate_features";
}

export interface FiredRule {
  ruleCode: string;
  description: string;
  weight: number;
  appliesToTemplates: UC4TemplateId[];
  evidence: EvidenceRef[];
  safetyTags: string[];
}

export interface RuleValidator {
  ruleCode: string;
  description: string;
  weight: number;
  appliesToTemplates: UC4TemplateId[];
  evidenceFields: string[];
  safetyTags: string[];
  evaluate: (ctx: UC4RuleContext) => FiredRule | null;
}

export interface UC4Candidate {
  patientId: PatientId;
  templateId: UC4TemplateId;
  firedRules: FiredRule[];
  scoreTrace: UC4ScoreTrace;
  finalScore: number;
}

export interface UC4ScoreTrace {
  ruleScore: number;
  blindSpotBonus: number;
  usefulnessBonus: number;
  repeatPenalty: number;
  dismissPenalty: number;
  normalizedScore: number;
}

export interface UC4PriorityCard {
  patientId: PatientId;
  templateId: UC4TemplateId;
  title: string;
  body: string;
  priorityKind: UC4PriorityKind;
  domain: string;
  score: number;
  firedRuleCodes: string[];
  evidence: EvidenceRef[];
  whatToLogNextSchema: WhatToLogNextField[];
  freeTextUsedForScoring: false;
  safetyBoundary: string;
  generatedAtIso: string;
  versions: {
    schema: string;
    templateRegistry: string;
    ruleRegistry: string;
    scoring: string;
    engine: string;
  };
}

export interface UC4RunInput {
  patient: UC4PatientProfile;
  medications: UC4MedicationProfile[];
  recentEvents: UC4StructuredEvent[];
  wearableSummary?: UC4WearableSummary;
  previousPriorities: PreviousUC4Priority[];
  uc1ActiveEmergency: boolean;
  currentSeverityContext: UC4SeverityContext;
  nowIso: string;
}

export interface UC4RunOutput {
  patientId: PatientId;
  paused: boolean;
  pauseReason?: string;
  candidates: UC4Candidate[];
  selectedCards: UC4PriorityCard[];
  auditRecords: UC4AuditRecord[];
}

export interface UC4AuditRecord {
  auditId: string;
  patientId: PatientId;
  timestampIso: string;
  action:
    | "UC4_RUN_STARTED"
    | "UC4_PAUSED_FOR_EMERGENCY"
    | "UC4_RULE_FIRED"
    | "UC4_CANDIDATE_SCORED"
    | "UC4_CARD_RENDERED"
    | "UC4_RUN_COMPLETED";
  templateId?: UC4TemplateId;
  ruleCode?: string;
  score?: number;
  details?: Record<string, unknown>;
}