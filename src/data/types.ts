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
}

export interface PatientCondition {
  conditionId: string;
  patientId: string;
  name: string;
  icd10?: string;
  onsetDate?: string;
}
