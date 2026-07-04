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
  | 'coughing';

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
  | 'feeding_intolerance';

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
  createdAt: string;
  updatedAt: string;
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

export interface PatientCondition {
  conditionId: string;
  patientId: string;
  name: string;
  icd10?: string;
  /** Original SNOMED CT code (when the source provides SNOMED, e.g. CDA import). */
  snomedCode?: string;
  onsetDate?: string;
  // M12 extensions — structured clinical metadata
  category?: string; // 'Respiratory' | 'Neurologic' | 'Cardiac' | 'Metabolic' | 'Cognitive' | 'Neurologic / Mobility' | ...
  isPrimary?: boolean;
  source?: ConditionSource; // 'onboarding' | 'medlineplus' | 'pubmed' | 'rxnorm' | 'ccda_import'
  sourceDocId?: string; // e.g. 'MLP-J44.9'
  retrievedAt?: string;
  needsReview?: boolean; // true for MedlinePlus-suggested comorbidities
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
  | 'patient-plan';

/** Coarse chunk-depth tier used by the prompt-budget router (planning/32 §12.4). */
export type KnowledgeDocumentType =
  | 'abstract'
  | 'fulltext'
  | 'guideline'
  | 'systematic_review'
  | 'spl_full'
  | 'synthetic';

/** Length tier for budget-aware prompt injection. */
export type KnowledgeLengthTier = 'short' | 'medium' | 'long';

export interface KnowledgeChunk {
  chunkId: string; // docId, e.g. 'PMID-12345678', 'MLP-J44.1'
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

export interface AppSettings {
  mode: AppMode;
  demoDefaultModelId: string;
  theme: ThemePreference;
  notifications: NotificationPreferences;
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
  appointmentid: string;
  patientId: string;
  type: string;
  provider?: string;
  date: string; // ISO date yyyy-mm-dd
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
  carePlanId?: string;
  entryDate: string; // ISO date (yyyy-mm-dd)
  therapyDay?: number;
  loggedByUserId?: string;
  loggedByRole?: string;
  therapyCompleted: boolean;
  setsCompleted: number;
  recommendedSets: number;
  painBefore?: number;
  painAfter?: number;
  fatigue?: number;
  assistanceRequired?: string;
  caregiverConcern: boolean;
  functionalTaskScore?: number;
  guidedMovementScore?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
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
