/**
 * Shared database types and helper types.
 *
 * These types mirror the SQLite schema. Repositories translate between
 * these typed objects and the raw database rows.
 */

export type HealthSampleSource =
  | 'apple-health'
  | 'health-connect'
  | 'manual'
  | 'mock'
  | 'fhir'
  | 'wearable'
  | 'simulated'
  | 'cda_import';

export type HealthSampleType =
  | 'spo2'
  | 'heart_rate'
  | 'respiratory_rate'
  | 'blood_pressure_systolic'
  | 'blood_pressure_diastolic'
  | 'temperature'
  | 'weight'
  | 'height'
  | 'bmi'
  | 'blood_glucose'
  | 'steps'
  | 'distance'
  | 'flights_climbed'
  | 'sleep'
  | 'coughing'
  | 'calories_burned'
  | 'hrv_sdnn'
  | 'resting_heart_rate'
  | 'walking_steadiness'
  | 'walking_speed'
  | 'step_length'
  | 'walking_asymmetry'
  | 'walking_double_support'
  | 'vo2_max'
  | 'six_minute_walk_distance';

/**
 * Frozen list of `HealthSampleType` values for runtime membership checks
 * (e.g. FHIR projection of Alert ML thresholds). Keeping this a separate
 * const makes the "is N a known vital type?" predicate deterministic
 * without re-enumerating the type union by hand.
 */
export const HEALTH_SAMPLE_TYPES: readonly HealthSampleType[] = [
  'spo2',
  'heart_rate',
  'respiratory_rate',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'temperature',
  'weight',
  'height',
  'bmi',
  'blood_glucose',
  'steps',
  'distance',
  'flights_climbed',
  'sleep',
  'coughing',
  'calories_burned',
  'hrv_sdnn',
  'resting_heart_rate',
  'walking_steadiness',
  'walking_speed',
  'step_length',
  'walking_asymmetry',
  'walking_double_support',
  'vo2_max',
  'six_minute_walk_distance',
];

export interface HealthSample {
  sampleId: string;
  patientId: string;
  source: HealthSampleSource;
  type: HealthSampleType;
  value: number;
  valueJson?: string;
  unit: string;
  recordedAt: string;
  receivedAt: string;
  metadataJson?: string;
  /** Optional reference to the source document (e.g. CDA doc_id). */
  sourceDocId?: string;
}

export type RehabilitationMeasurementType =
  | 'rehabilitation_gait_speed'
  | 'rehabilitation_shoulder_rom'
  | 'rehabilitation_grip_strength'
  | 'rehabilitation_berg_balance'
  | 'rehabilitation_fatigue'
  | 'rehabilitation_modified_ashworth'
  | 'rehabilitation_seated_postural_control'
  | 'rehabilitation_feeding_tolerance'
  | 'rehabilitation_communication_function'
  | 'rehabilitation_joint_contracture_rom';

export interface RehabilitationMeasurement {
  measurementId: string;
  patientId: string;
  type: RehabilitationMeasurementType;
  value: number;
  unit: string;
  recordedAt: string;
  source: 'fhir';
  createdAt: string;
}

export type CarePlanRehabMetricKey =
  | 'romDegrees'
  | 'exerciseReps'
  | 'adherence'
  | 'painScore'
  | 'fatigueScore'
  | 'walkingMinutes';

export type SupportedUc3ConditionGroup = 'post_stroke_rehabilitation';

export type RehabExerciseKey =
  | 'supported_arm_reach'
  | 'grasp_release'
  | 'sit_to_stand'
  | 'supported_weight_shift'
  | 'assisted_walking';

export type RehabExerciseAssignmentSource = 'developer_uc3_v2' | 'seed:fhir_import';

export interface RehabExerciseDefinition {
  key: RehabExerciseKey;
  label: string;
}

export interface RehabExerciseAssignment {
  patientId: string;
  carePlanId: string;
  exerciseKey: RehabExerciseKey;
  active: boolean;
  source: RehabExerciseAssignmentSource;
  createdAt: string;
  updatedAt: string;
}

export interface RehabExerciseAssignmentCounts {
  exercisesAssigned: number;
  exercisesCompleted: number;
}

export interface CarePlanRehabMetric {
  id: string;
  patientId: string;
  carePlanId: string;
  carePlanActivityId?: string | null;
  metricKey: CarePlanRehabMetricKey;
  displayName: string;
  baselineValue?: number | null;
  targetValue?: number | null;
  unit: string;
  durationDays: number;
  sourceGoalId?: string | null;
  sourceBaselineObservationId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LongitudinalObservationType =
  | 'vomiting_episodes'
  | 'urinary_symptom_score'
  | 'bowel_regimen_score'
  | 'mobility_score'
  | 'sleep_quality'
  | 'pain_score'
  | 'hydration_status'
  | 'seizure_frequency'
  | 'spasticity_episodes'
  | 'respiratory_suctioning_events'
  | 'feeding_intolerance'
  | 'mobility_assistance_level'
  | 'musculoskeletal_limitation_level';

export interface PatientLongitudinalObservation {
  patientId: string;
  observationId: string;
  measurementType: LongitudinalObservationType;
  recordedAt: string;
  encounterId?: string | null;
  numericValue?: number | null;
  textValue?: string | null;
  unit?: string | null;
  sourceSystem?: string | null;
  sourceCode: string;
  sourceType: 'fhir';
  sourceLabel?: string | null;
  sourceFile?: string | null;
  sourceSection?: string | null;
  visitIndex?: number | null;
  daysFromFirstVisit?: number | null;
  confidence?: string | null;
  rawExcerpt?: string | null;
}

export interface Threshold {
  thresholdId: string;
  patientId: string;
  vitalType: string;
  value: number;
  direction: 'above' | 'below' | 'equals';
  severity: 1 | 2 | 3;
  source: 'ml_baseline' | 'pcp_careplan' | 'caregiver_override';
  citationId?: string;
  createdAt: string;
  supersededAt?: string;
}

export interface CarePlanActivity {
  activityId: string;
  planId: string;
  status?: string;
  description?: string;
  sequence: number;
}

export interface CarePlan {
  planId: string;
  patientId: string;
  version: number;
  effectiveDate: string;
  status?: string;
  intent?: string;
  title?: string;
  description?: string;
  periodStart?: string;
  periodEnd?: string;
  careTeamDisplayJson?: string;
  safetyNotes?: string;
  emergencyContact?: string;
  createdAt: string;
  activities: CarePlanActivity[];
}

export interface CarePlanGoalSummary {
  goalId: string;
  description: string;
  targetDate?: string;
  status: string;
}

export interface Alert {
  alertId: string;
  patientId: string;
  severity: 1 | 2 | 3;
  // 'dismissed' = caregiver permanently suppressed the critical popup (shows
  //   as inactive in the alerts log; kept for audit).
  // 'removed'    = caregiver removed the alert from the log (hidden from the
  //   log UI but preserved in SQLite for the tamper-evident audit trail).
  status: 'open' | 'acknowledged' | 'resolved' | 'escalated' | 'dismissed' | 'removed';
  title: string;
  body: string;
  mlScore?: number;
  mlFeaturesJson?: string;
  createdAt: string;
  resolvedAt?: string;
  // ── UC2 decision-layer columns (migration 15) ──
  pipelinePath?: string;
  initialAnomalyType?: string;
  postHitlAnomalyType?: string;
  featureQualityJson?: string;
  scoreRatio?: number;
  aeScore?: number;
}

export type CaregiverActionType =
  | 'ack'
  | 'override'
  | 'escalate'
  | 'log_observation'
  | 'ask_slm'
  | 'answer_clarifying_question';

export interface CaregiverAction {
  actionId: string;
  alertId?: string;
  patientId: string;
  caregiverId: string;
  type: CaregiverActionType;
  payloadJson?: string;
  createdAt: string;
}

export interface RagCitation {
  citationId: string;
  docId: string;
  source: string;
  text: string;
  retrievedAt: string;
  useCount: number;
}

export interface SlmTurn {
  turnId: string;
  alertId?: string;
  patientId: string;
  modelId?: string;
  promptHash?: string;
  responseHash?: string;
  latencyMs?: number;
  tokensGenerated?: number;
  peakRamBytes?: number;
  createdAt: string;
}

export interface TriggerEvent {
  eventId: string;
  type: string;
  patientId: string;
  alertId?: string;
  actionId?: string;
  outcome?: string;
  createdAt: string;
}

export interface AuditLogEntry {
  auditId: string;
  patientId?: string;
  actor: 'orchestrator' | 'caregiver' | 'slm' | 'system';
  action: string;
  resourceType: string;
  resourceId?: string;
  payloadJson?: string;
  hashChain: string;
  createdAt: string;
}

export interface ConsentToken {
  tokenId: string;
  patientId: string;
  scope: string;
  granted: boolean;
  expiresAt?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface Patient {
  patientId: string;
  name: string;
  preferredName?: string;
  age?: string;
  conditions?: string;
  baselineDailyRoutine?: string;
  currentMedications?: string;
  spo2Cutoff?: string;
  baselineHeartRate?: string;
  baselineBloodOxygen?: string;
  baselineRespiratoryRate?: string;
  baselineBloodPressureSystolic?: string;
  baselineBloodPressureDiastolic?: string;
  baselineGlucoseLevel?: string;
  baselineBodyTemperature?: string;
  gmfcs?: string;
  fms?: string;
  macs?: string;
  cfcs?: string;
  edacs?: string;
  /** Free-text location (county / state) used for SDOH bundling. */
  location?: string;
  /** Caregiver-entered onboarding safety notes, scoped to this patient. */
  safetyNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PatientSafetyProfile {
  patientId: string;
  emergencyContactName?: string | null;
  emergencyContactRelationship?: string | null;
  emergencyContactPhone?: string | null;
  emergencyInstructions?: string | null;
  emergencyDisclaimerAccepted?: boolean | null;
  updatedAt: string;
}

export interface PatientSafetySnapshot {
  patientId: string;
  safetyNotes: string;
  emergencyContactName?: string | null;
  emergencyContactRelationship?: string | null;
  emergencyContactPhone?: string | null;
  emergencyInstructions?: string | null;
  emergencyDisclaimerAccepted?: boolean | null;
  updatedAt: string | null;
}

export interface Caregiver {
  caregiverId: string;
  patientId: string;
  name: string;
  relationship?: string;
  experience?: string;
  availability?: string;
  languagePreference?: string;
  medicalComfortLevel?: string;
  hobbiesOrRoutines?: string;
  mainConcern?: string;
  stressOrSupportNeeds?: string;
  backupCaregiver?: string;
  createdAt: string;
}

export interface Provider {
  providerId: string;
  patientId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  role?: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export interface Medication {
  medicationId: string;
  patientId: string;
  name: string;
  dosage?: string;
  frequency?: string;
  route?: string;
  indication?: string;
  active: boolean;
  source?: 'care_plan' | 'custom' | 'fhir' | 'ccda_import';
}

export interface MedicationCandidate {
  candidateId: string;
  patientId: string;
  name: string;
  category: string;
  currentHomeUseStatus: 'unknown' | 'not_confirmed';
  confirmationRequired: boolean;
  sourceFile?: string;
  visitIndex?: number;
  daysFromFirstVisit?: number;
  summary?: string;
  fhirResourceId: string;
}

export type MedicationConfirmationRequirementStatus =
  | 'required'
  | 'not_required'
  | 'not_provided';

export type MedicationConfirmationRequirementSource =
  | 'demo_override'
  | 'demo_fixture'
  | 'fhir_extension'
  | 'provider_configuration';

export interface MedicationConfirmationRequirement {
  patientId: string;
  medicationId: string;
  confirmationRequirement: MedicationConfirmationRequirementStatus;
  requirementSource?: MedicationConfirmationRequirementSource;
  createdAt: string;
  updatedAt: string;
}

export type MedicationConfirmationPreferenceMode =
  | 'all'
  | 'required_only'
  | 'personalized';

export interface MedicationConfirmationPreference {
  patientId: string;
  confirmationMode: MedicationConfirmationPreferenceMode;
  selectedMedicationIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type PatientTimelineEventType =
  | 'pre_op_planning'
  | 'operative_event'
  | 'discharge_restrictions'
  | 'post_op_follow_up'
  | 'ot_orthosis_plan'
  | 'equipment_orthotics_support';

export interface PatientTimelineEvent {
  eventId: string;
  patientId: string;
  eventType: PatientTimelineEventType;
  title: string;
  summary: string;
  visitIndex: number;
  daysFromFirstVisit: number;
  daysBeforeLatestVisit: number;
  sourceFile: string;
  sourceSection: string;
  confidence: 'high' | 'medium' | 'low';
  clinicalRelevance: string;
  createdAt: string;
}

export interface PatientCareContextItem {
  itemId: string;
  patientId: string;
  contextCategory: string;
  plainTitle: string;
  factualSummary: string;
  sourceExcerpt: string;
  sourceDocument: string;
  sourceSection: string;
  visitIndex?: number | null;
  daysFromFirstVisit?: number | null;
  sourcePath?: string | null;
  relatedTimelineEvent?: string | null;
  handling: string[];
  confidence?: 'high' | 'medium' | 'low' | string | null;
  limitations?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PatientCondition {
  conditionId: string;
  patientId: string;
  name: string;
  icd10?: string;
  /** Original SNOMED CT code (when the source provides SNOMED, e.g. CDA import). */
  snomedCode?: string;
  onsetDate?: string;
  conditionRole?: PatientConditionRole;
  sourceReferences?: PatientConditionSourceReference[];
  // M12 extensions — structured clinical metadata
  category?: string; // 'Respiratory' | 'Neurologic' | 'Cardiac' | 'Metabolic' | 'Cognitive' | 'Neurologic / Mobility' | ...
  isPrimary?: boolean;
  source?: ConditionSource; // 'onboarding' | 'medlineplus' | 'pubmed' | 'rxnorm' | 'ccda_import'
  sourceDocId?: string; // e.g. 'MLP-J44.9'
  retrievedAt?: string;
  needsReview?: boolean; // true for MedlinePlus-suggested comorbidities
}

export type PatientConditionRole =
  | 'primary_diagnosis'
  | 'active_comorbidity'
  | 'history_context';

export interface PatientConditionSourceReference {
  rawLabel?: string;
  sourceFile?: string;
  sourceSection?: string;
  visitIndex?: number;
  daysFromFirstVisit?: number;
  daysBeforeLatestVisit?: number;
  sourceDate?: string;
  dateKind?: 'diagnosed' | 'noted' | 'source_effective_time' | 'first_source_mention';
  provenanceId?: string;
}

export type ConditionSource = 'onboarding' | 'medlineplus' | 'pubmed' | 'rxnorm' | 'ccda_import' | 'fhir_import';

// ---------------------------------------------------------------------------
// Symptoms (structured from onboarding catalog + future EHR import)
// ---------------------------------------------------------------------------

export type SymptomCategory =
  | 'respiratory'
  | 'cardiac'
  | 'neurologic'
  | 'mobility'
  | 'general'
  | 'pain'
  | 'behavioral'
  | 'other';

export interface Symptom {
  symptomId: string;
  patientId: string;
  label: string;
  category: SymptomCategory;
  source?: ConditionSource;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Wearable devices (structured from onboarding)
// ---------------------------------------------------------------------------

export type WearableDeviceType =
  | 'Apple Watch'
  | 'Fitbit'
  | 'Garmin'
  | 'Samsung Galaxy Watch'
  | 'Oura Ring'
  | 'Phone only'
  | 'No device yet'
  | 'Other';

export type WearableBaselineStatus = 'not_started' | 'simulated' | 'connected' | 'failed';

export interface WearableDevice {
  deviceId: string;
  patientId: string;
  deviceType: WearableDeviceType;
  deviceLabel?: string;
  connected: boolean;
  baselineStatus: WearableBaselineStatus;
  baselineStartedAt?: string;
  baselineCompletedAt?: string;
  createdAt: string;
  updatedAt: string;
  healthkitSourceId?: string;
  healthkitSourceName?: string;
}

// ---------------------------------------------------------------------------
// Knowledge cache (PubMed / MedlinePlus / RxNorm / DailyMed / OpenFDA chunks)
// (see planning/22_clinical-data-gathering.md §6a)
// ---------------------------------------------------------------------------

export type KnowledgeSource =
  | 'pubmed'
  | 'medlineplus'
  | 'rxnorm'
  | 'dailymed'
  | 'openfda'
  | 'orphanet'
  | 'clinicaltrials'
  | 'umls'
  | 'cdc-places'
  | 'semmeddb'
  | 'synthetic'
  | 'hedis'
  | 'patient-plan'
  | 'patient-record'
  // ADCP (planning/39 P4) — chunks projected from the per-patient care plan
  | 'adcp_plan';

/** Coarse chunk-depth tier used by the prompt-budget router (planning/32 §12.4). */
export type KnowledgeDocumentType =
  | 'abstract'
  | 'fulltext'
  | 'guideline'
  | 'systematic_review'
  | 'spl_full'
  | 'synthetic'
  // ADCP (planning/39 P4) — section / rolling decision-log chunks
  | 'care_plan_section'
  | 'care_plan_decision_log';

/** Length tier for budget-aware prompt injection. */
export type KnowledgeLengthTier = 'short' | 'medium' | 'long';

export interface KnowledgeChunk {
  chunkId: string; // patient-scoped, e.g. 'kc:{patientId}:pubmed:PMID-123' or 'adcp:{patientId}:…'
  source: KnowledgeSource;
  text: string;
  queryHash?: string;
  conditions?: string; // CSV
  retrievedAt: string;
  expiresAt?: string;
  useCount: number;
  metadataJson?: string;
  /** Optional chunk-depth classification (planning/32 §12.3). */
  documentType?: KnowledgeDocumentType;
  /** Optional length tier (planning/32 §12.3). */
  lengthTier?: KnowledgeLengthTier;
  /** For section-chunked full-text docs, the heading that this chunk came from. */
  sectionHeading?: string;
  /**
   * Owning patient. Required for all new writes. Rows without patient_id are
   * treated as orphans and excluded from retrieval after the isolation migration.
   */
  patientId?: string;
  /** Original source document id (PMID, setid, fixture id) before patient prefix. */
  externalId?: string;
  /**
   * Caregiver relevance feedback for this patient (−1 not useful, 0 neutral, +1 useful).
   * Used to boost/penalize BM25 ranking within that patient's corpus only.
   */
  feedbackScore?: number;
  sourceId?: string;
  sourceType?: string;
  resourceId?: string;
  effectiveAt?: string;
  synthetic?: boolean;
  retrievalMethod?: string;
}

/** Per-patient knowledge relevance signal (isolation + NLU tuning). */
export type KnowledgeFeedbackSignal = 'useful' | 'not_useful' | 'neutral';

export interface KnowledgeChunkFeedback {
  feedbackId: string;
  patientId: string;
  chunkId: string;
  signal: KnowledgeFeedbackSignal;
  createdAt: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Knowledge chunk edge - evidence graph for RAG seed expansion (doc 36)
// ---------------------------------------------------------------------------

export type KnowledgeChunkEdgeType =
  | 'PARENT_OF'
  | 'SHARES_CONDITION'
  | 'SHARES_MEDICATION';

export interface KnowledgeChunkEdge {
  fromChunkId: string;
  toChunkId: string;
  type: KnowledgeChunkEdgeType;
  weight: number;
  source?: string;
  metadataJson?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Patient enrichment log (auditable record of every clinical-source enrichment)
// ---------------------------------------------------------------------------

export type EnrichmentField = 'condition' | 'medication' | 'threshold' | 'goal';
export type EnrichmentAction = 'bundled' | 'suggested' | 'supplemented_live';

export interface PatientEnrichmentLogEntry {
  logId: string;
  patientId: string;
  field: EnrichmentField;
  resourceId?: string;
  source: KnowledgeSource;
  action: EnrichmentAction;
  deidentifiedQuery?: string;
  resultCount?: number;
  latencyMs?: number;
  chunkIds?: string; // CSV
  createdAt: string;
}

// ---------------------------------------------------------------------------
// ML events (full structured output from the Alert ML model)
// (Jay's sample JSON shape — preserved verbatim for the ML → SLM bridge)
// ---------------------------------------------------------------------------

export interface MlEvent {
  eventId: string;
  patientId: string;
  deviceId?: string;
  alertId?: string;
  queueType?: string; // 'SLM_HEURISTIC_REFINEMENT' | ...
  eventType?: string; // 'TRIGGER_WORKFLOW_ANOMALY_TYPE_04' | ...
  timestamp: string;
  modelVersion?: string;
  threshold?: number;
  personalizedThreshold?: number;
  reconstructionError?: number;
  anomalyDetected: boolean;
  inputHash?: string;
  topFeaturesJson?: string; // [["stress_level",23.19],...]
  ruleEngineJson?: string; // {is_emergency, severity, reasons[]}
  caregiverJson?: string; // {action, confirmed, observations[]}
  rawVitalsJson?: string; // full 8-feature snapshot
  trainingLabelProxyJson?: string;
  createdAt: string;
  // ── UC2 decision-layer columns (migration 15) ──
  featureQualityJson?: string;
  initialAnomalyType?: string;
  postHitlAnomalyType?: string;
  scoreRatio?: number;
  slmTaskJson?: string;
  thresholdRecommendationJson?: string;
}

/** Parsed top-feature tuple from MlEvent.topFeaturesJson. */
export type MlTopFeature = [string, number];

/** Parsed rule-engine block from MlEvent.ruleEngineJson. */
export interface MlRuleEngine {
  is_emergency: boolean;
  severity: number;
  reasons: string[];
}

/** Parsed caregiver block from MlEvent.caregiverJson. */
export interface MlCaregiverBlock {
  action?: string; // 'confirmed' | 'pending' | ...
  confirmed?: boolean;
  observations?: string[];
}

/** Parsed raw-vitals snapshot from MlEvent.rawVitalsJson. */
export interface MlRawVitals {
  heart_rate?: number;
  blood_oxygen?: number;
  respiratory_rate?: number;
  activity_level?: number;
  sleep_quality?: number;
  stress_level?: number;
  hrv_sdnn?: number;
  body_temperature?: number;
  [key: string]: number | undefined;
}

export interface MlInputProvenance {
  source?: HealthSampleSource;
  sampleId?: string;
  recordedAt?: string;
  receivedAt?: string;
  unit?: string;
  healthSampleType?: HealthSampleType;
  metadataJson?: string;
}

export interface MlRawVitalsInputEnvelope {
  contract: 'AppleWatchVitalsInput';
  contractVersion: 1;
  input: {
    patient_id: string;
    caregiver_id?: string;
    device_id?: string;
    timestamp: string;
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
  provenance: Record<string, MlInputProvenance>;
  evaluatedAt: string;
}

export type MlRawVitalsPayload = MlRawVitals | MlRawVitalsInputEnvelope;

// ---------------------------------------------------------------------------
// Medication schedules (structured reminder times)
// ---------------------------------------------------------------------------

export interface MedicationSchedule {
  scheduleId: string;
  medicationId: string;
  patientId: string;
  timeOfDay: string; // 'HH:mm' 24h local
  daysOfWeek?: string; // CSV '0,1,2,3,4,5,6' (Sun..Sat) or null = daily
  doseLabel?: string;
  active: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationScope = 'anomaly' | 'medication' | 'appointment' | 'care_task';

export interface NotificationRecord {
  notificationId: string;
  patientId: string;
  scope: NotificationScope;
  triggerRef?: string; // alertId | scheduleId | appointmentId
  title: string;
  body: string;
  severity?: number;
  bypassDnd: boolean;
  deliveredAt?: string;
  dismissedAt?: string;
  actionTaken?: string; // 'ack' | 'snooze' | 'open' | null
  createdAt: string;
}

export interface NotificationPreferences {
  anomaly: boolean;
  medication: boolean;
  medicationDevice: boolean;
  appointment: boolean;
  appointmentDevice: boolean;
  appointmentLeadTimeMin: number;
  careTask: boolean;
  careTaskDevice: boolean;
  quietHoursStart?: string; // 'HH:mm'
  quietHoursEnd?: string;
}

// ---------------------------------------------------------------------------
// App settings (persisted; consumed by SettingsContext)
// ---------------------------------------------------------------------------

export type AppMode = 'demo' | 'developer';
export type ThemePreference = 'light' | 'dark' | 'system';
export type CarePlanMode = 'full' | 'read_only';
/** Concierge reasoning mode. 'auto' = model uses its think channel; 'off' = force direct answers (template-native models get a no-think chat template). */
export type ConciergeReasoningMode = 'auto' | 'off';

export interface AppSettings {
  mode: AppMode;
  demoDefaultModelId: string;
  theme: ThemePreference;
  /**
   * Application UI language preference. Caregiver language is legacy metadata
   * for frozen SLM paths and must not control app localization.
   */
  languagePreference: string;
  notifications: NotificationPreferences;
  /**
   * When true (default): on-demand SLM load/unload (doc 34 dynamic path).
   * When false: doc-32 legacy startup + foreground reload, with OOM gate/retry fix.
   */
  dynamicSlmLoading: boolean;
  /** __DEV__ only: allow mock/hash NLU fallback when native NLU assets are absent. */
  nluDevelopmentFallback: boolean;
  /** __DEV__ only: allow bundled evidence fixtures in retrieval indexes. */
  evidenceDevelopmentFallback: boolean;
  /** Evidence graph expansion for RAG retrieval (doc 36). Default true after pack (doc 42). */
  knowledgeGraphExpansion: boolean;
  /**
   * When true (default): primary clinical knowledge path is the on-device pack
   * runner (doc 42). When false: legacy live multi-host knowledge bundle.
   */
  knowledgePackRunner: boolean;
  /**
   * When true (default): pack layers + clinical clients hit live NLM/open APIs
   * (MedlinePlus, DailyMed, PubMed lit_lite, RxNorm, …), including first
   * onboarding Device setup. When false: offline fixtures / owned digests only.
   */
  liveClinicalFetch: boolean;
  /**
   * Living care plan mutation policy (planning/41 D1).
   * 'full' (default): Concierge can queue proposal → HITL → ML vet → publish.
   * 'read_only': display + RAG + explain intents + export; no plan mutations
   * (restore allowed with explicit confirm + consent).
   */
  carePlanMode: CarePlanMode;
  /**
   * When true (default): iOS Apple Health / HealthKit sensor source may connect
   * and poll. When false, HealthKit is not started so empty devices are not
   * constantly queried.
   */
  healthKitIntegrationEnabled: boolean;
  /**
   * Developer-only test flag: synthetically reports the Concierge SLM and
   * knowledge cache as not downloaded, so the optional-feature prompt and
   * grey-out surfaces (doc 26 §7) can be exercised without removing models.
   */
  simulateMissingOptionalFeatures: boolean;
  /**
   * Concierge reasoning mode. 'auto' (default): models use their think channel
   * (Gemma 4 via reasoning_format; LFM2.5 / Bonsai via template-forced think).
   * 'off': force direct answers — Gemma disables thinking via reasoning_format,
   * and template-native models (lfm2 / qwen3) get a no-think chat template
   * override so their GGUF's forced <think> injection is skipped.
   */
  conciergeReasoning: ConciergeReasoningMode;
}

// ---------------------------------------------------------------------------
// FHIR resource cache + export queue
// ---------------------------------------------------------------------------

export type FhirResourceKind = 'care_plan' | 'export_queue' | 'consent_snapshot' | 'imported';

export interface FhirResource {
  resourceType: string; // 'CarePlan' | 'Composition' | 'Consent' | 'Provenance' ...
  resourceId: string;
  version: number;
  kind: FhirResourceKind;
  payloadJson: string;
  lastSyncedAt: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Next-step actions (anomaly detection flow)
// ---------------------------------------------------------------------------

export type NextStepActionId =
  | 'call_911'
  | 'go_to_er'
  | 'contact_pcp'
  | 'geofence_service'
  | 'schedule_urgent_appt'
  | 'share_record'
  | 'monitor_home'
  | 'log_note';

export interface NextStep {
  actionId: NextStepActionId;
  label: string;
  rationale?: string;
}

// ---------------------------------------------------------------------------
// Threshold personalization queue (planning/23 §7.2)
// ---------------------------------------------------------------------------

export type ThresholdRecommendationStatus = 'pending' | 'applied' | 'dismissed';

export interface ThresholdRecommendation {
  recommendationId: string;
  patientId: string;
  recommendedThreshold: number;
  adjustmentPct?: number;
  reason?: string;
  status: ThresholdRecommendationStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface Appointment {
  appointmentId: string;
  appointmentid?: string;
  patientId: string;
  type: string;
  provider?: string;
  date: string; // ISO date yyyy-mm-dd
  time?: string;
  starttime?: string;
  patientappointmenttypename?: string;
  location?: string;
  reason?: string;
  reminder?: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Daily care entries (per-day therapy log editable from the Care screen)
// ---------------------------------------------------------------------------

export interface DailyCareEntry {
  entryId: string;
  patientId: string;
  carePlanId?: string | null;
  entryDate: string; // ISO date (yyyy-mm-dd)
  therapyDay?: number | null;
  loggedByUserId?: string | null;
  loggedByRole?: string | null;
  therapyCompleted: boolean;
  setsCompleted: number;
  recommendedSets: number;
  exerciseRepetitions?: number | null;
  romDegrees?: number | null;
  walkingMinutes?: number | null;
  assignedExerciseKeys?: RehabExerciseKey[];
  completedExerciseKeys?: RehabExerciseKey[];
  painScore?: number | null;
  painBefore?: number | null;
  painAfter?: number | null;
  fatigue?: number | null;
  skippedReason?: string | null;
  symptoms?: string[];
  assistanceRequired?: string | null;
  caregiverConcern: boolean;
  functionalTaskScore?: number | null;
  guidedMovementScore?: number | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type Uc3TrajectoryResultStatus = 'active' | 'superseded' | 'acknowledged';

export interface Uc3TrajectoryMetricAnalysisSummary {
  metricName: string;
  finalActual: number | null;
  finalExpected: number | null;
  gap: number | null;
  gapPercent: number | null;
  recentSlope: number | null;
  plateauDays: number;
  dataPoints: number;
}

export interface Uc3TrajectoryDataQualitySummary {
  totalExpectedDays: number;
  totalLoggedDays: number;
  missingDays: number[];
  completenessRatio: number;
  sufficientData: boolean;
  warnings: string[];
}

export interface LatestUc3TrajectoryResultSummary {
  resultId: string;
  patientId: string;
  carePlanId: string;
  modelFamily: string;
  modelVersion: string;
  inputFingerprint: string;
  eventType: string;
  severity: string;
  requiresHumanReview: boolean;
  emergencyThresholdBreach: boolean;
  reviewPriorityScore: number;
  reasonCodes: string[];
  explanations: string[];
  metricAnalyses: Record<string, Uc3TrajectoryMetricAnalysisSummary>;
  dataQuality: Uc3TrajectoryDataQualitySummary;
  generatedAt: string;
  status: Uc3TrajectoryResultStatus;
  caregiverMessagePreview?: string;
}

export type Uc4RunStatus = 'completed' | 'paused' | 'no_cards' | 'error';
export type Uc4PriorityCardStatus =
  | 'active'
  | 'acknowledged'
  | 'completed'
  | 'dismissed'
  | 'superseded';

export interface Uc4WhatToLogNextFieldSummary {
  fieldId: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  usedForScoring: boolean;
}

export interface LatestUc4RunSummary {
  runId: string;
  patientId: string;
  status: Uc4RunStatus;
  paused: boolean;
  pauseReason?: string | null;
  generatedAt: string;
  engineVersion: string;
  schemaVersion: string;
  templateRegistryVersion: string;
  ruleRegistryVersion: string;
  scoringVersion: string;
  cardCount: number;
}

export interface LatestUc4PriorityCardSummary {
  cardId: string;
  patientId: string;
  runId: string;
  templateId: string;
  priorityKind: string;
  title: string;
  body: string;
  domain: string;
  score: number;
  firedRuleCodes: string[];
  evidence: unknown[];
  whatToLogNextSchema: Uc4WhatToLogNextFieldSummary[];
  safetyBoundary: string;
  status: Uc4PriorityCardStatus;
  generatedAt: string;
}

export interface Uc4CaregiverResponseSummary {
  responseId: string;
  patientId: string;
  cardId?: string | null;
  templateId?: string | null;
  action: string;
  observationCodes: string[];
  contextCodes: string[];
  caregiverRequestedProviderReview: boolean;
  shortText?: string | null;
  createdAt: string;
}

export interface BundleStatus {
  state: 'in_flight' | 'complete' | 'failed';
  chunksAdded: number;
  error?: string;
  updatedAt?: string;
  /** 0–1 fraction while in_flight (optional; older rows omit it). */
  progress?: number;
  /** Short caregiver-facing phase label while in_flight. */
  phase?: string;
  completedSteps?: number;
  totalSteps?: number;
}

/**
 * Narrow ADCP summary surfaced through the snapshot per planning/39
 * `E4 Snapshot RFC fields (minimum)`.
 *
 * Full history/detail lives in `care_plan_revisions` and `pending_plan_proposals`.
 */
export interface ActiveAdcpVersionSlice {
  planId: string;
  version: number;
  publishedAt: string;
  source: 'seed:onboarding' | 'seed:fhir_import' | 'seed:restore' | 'ml_apply' | 'caregiver_confirm' | 'slm_apply_with_hitl';
  therapyContractPresent: boolean;
  prioritiesCount: number;
  medicationBindingsCount: number;
}

/**
 * Alias of the repository-side summary shape. Kept as a separate name so
 * consumers can wire to the snapshot field without importing the ADCP repo.
 */
export interface PendingPlanProposalSlice {
  proposalId: string;
  patientId: string;
  intent: string;
  section: string;
  kind: string;
  status: string;
  summary: string;
  rationale: string;
  draftedBy: 'slm' | 'ml_engine' | 'caregiver';
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface PatientRecordSnapshot {
  patient: Patient | null;
  safetyNotes: string;
  patientSafety: PatientSafetySnapshot | null;
  caregiver: Caregiver | null;
  primaryCareProvider?: Provider | null;
  conditions: PatientCondition[];
  comorbidities: PatientCondition[];
  primaryCondition: PatientCondition | null;
  pendingReviewConditions: PatientCondition[];
  symptoms: Symptom[];
  wearable: WearableDevice | null;
  medications: Medication[];
  medicationCandidates: MedicationCandidate[];
  medicationConfirmationRequirements: Record<string, MedicationConfirmationRequirement>;
  functionalObservations: PatientLongitudinalObservation[];
  thresholds: Threshold[];
  carePlan: CarePlan | null;
  carePlans: CarePlan[];
  rehabPlanMetrics: CarePlanRehabMetric[];
  rehabExerciseAssignments: RehabExerciseAssignment[];
  todayDailyCareEntry: DailyCareEntry | null;
  rehabDailyEntries: DailyCareEntry[];
  latestUc3TrajectoryResult: LatestUc3TrajectoryResultSummary | null;
  latestUc4Run: LatestUc4RunSummary | null;
  latestUc4PriorityCards: LatestUc4PriorityCardSummary[];
  recentUc4CaregiverResponses: Uc4CaregiverResponseSummary[];
  careContextItems: PatientCareContextItem[];
  timelineEvents: PatientTimelineEvent[];
  carePlanGoals: CarePlanGoalSummary[];
  knowledgeStats: { total: number; bySource: Record<string, number> };
  enrichmentStats: {
    total: number;
    bySource: Record<string, number>;
    lastRunAt?: string;
  };
  bundlePending: boolean;
  bundleStatus: BundleStatus;
  // ADCP (planning/39 E4) — additive summary fields, populated by adcpRepository.
  activeAdcpVersion: ActiveAdcpVersionSlice | null;
  pendingPlanProposals: PendingPlanProposalSlice[];
  therapyContractPresent: boolean;
  lastRefreshedAt: string;
}

export type NormalizedVitalReading = {
  sampleId: string;
  type: string;
  value: number;
  unit: string;
  recordedAt: string;
  source: string;
};

export type NormalizedBloodPressurePair = {
  systolic?: number;
  diastolic?: number;
  systolicSampleId?: string;
  diastolicSampleId?: string;
  unit: string;
  recordedAt?: string;
  source?: string;
};

export type NormalizedVitalMetric = {
  key: string;
  label: string;
  value: string;
  unit: string;
  status: "available" | "not_available";
  recordedAt?: string;
  sampleId?: string;
  source?: string;
  readings: NormalizedVitalReading[];
  bloodPressure?: NormalizedBloodPressurePair;
  bloodPressureReadings?: NormalizedBloodPressurePair[];
  data: number[];
};

export type NormalizedActivePatient = {
  patientId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  preferredName: string;
  age: string;
  caregiver: Pick<Caregiver, "name" | "relationship"> | null;
  primaryDiagnosis: PatientCondition | null;
  comorbidities: PatientCondition[];
  pendingConditions: PatientCondition[];
  classifications: {
    gmfcs: string;
    fms: string;
    macs: string;
    cfcs: string;
    edacs: string;
  };
  baselineDailyRoutine: string;
  currentMedications: string;
  spo2Cutoff: string;
  baselineHeartRate: string;
  baselineBloodOxygen: string;
  baselineRespiratoryRate: string;
  baselineBloodPressureSystolic: string;
  baselineBloodPressureDiastolic: string;
  baselineGlucoseLevel: string;
  baselineBodyTemperature: string;
  medicationConfirmationRequirements: Record<string, MedicationConfirmationRequirement>;
  status: "available" | "unknown";
  lastRefreshedAt: string;
};
