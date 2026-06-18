/**
 * Shared database types and helper types.
 *
 * These types mirror the SQLite schema. Repositories translate between
 * these typed objects and the raw database rows.
 */

export type HealthSampleSource = 'apple-health' | 'health-connect' | 'manual' | 'mock';

export type HealthSampleType =
  | 'spo2'
  | 'heart_rate'
  | 'respiratory_rate'
  | 'blood_pressure_systolic'
  | 'blood_pressure_diastolic'
  | 'temperature'
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

export interface Alert {
  alertId: string;
  patientId: string;
  severity: 1 | 2 | 3;
  status: 'open' | 'acknowledged' | 'resolved' | 'escalated';
  title: string;
  body: string;
  mlScore?: number;
  mlFeaturesJson?: string;
  createdAt: string;
  resolvedAt?: string;
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
  age?: string;
  conditions?: string;
  baselineDailyRoutine?: string;
  currentMedications?: string;
  spo2Cutoff?: string;
  baselineHeartRate?: string;
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
  source?: 'care_plan' | 'custom';
}

export interface PatientCondition {
  conditionId: string;
  patientId: string;
  name: string;
  icd10?: string;
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
}

// ---------------------------------------------------------------------------
// Knowledge cache (PubMed / MedlinePlus / RxNorm / DailyMed / OpenFDA chunks)
// (see planning/22_clinical-data-gathering.md §6a)
// ---------------------------------------------------------------------------

export type KnowledgeSource = 'pubmed' | 'medlineplus' | 'rxnorm' | 'dailymed' | 'openfda';

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
  appointment: boolean;
  appointmentLeadTimeMin: number;
  careTask: boolean;
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

export type FhirResourceKind = 'care_plan' | 'export_queue' | 'consent_snapshot';

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
// Appointments (Schedule screen)
// ---------------------------------------------------------------------------

export interface Appointment {
  appointmentId: string;
  patientId: string;
  type: string;
  provider?: string;
  date: string; // ISO date yyyy-mm-dd
  time?: string;
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
