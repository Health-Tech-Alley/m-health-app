/**
 * Data layer public API.
 *
 * Repositories are the only sanctioned read/write surface. Application code
 * (services, orchestration) imports from here, never from db.ts directly.
 */

export { getDatabase, initializeDatabase, closeDatabase, resetDatabase } from './db';
export { MIGRATIONS } from './migrations';
export * from './types';

export * from './repositories/healthSampleRepository';
export * from './repositories/thresholdRepository';
export {
  insertAlert,
  getOpenAlerts,
  getActiveAlerts,
  getAlertById,
  getAlertsForLog,
  updateAlertStatus,
  updateAlertMlFields,
  dismissAlert,
  removeAlert,
  insertCaregiverAction,
  getActionsForAlert,
  resolveAllAlerts,
} from './repositories/alertRepository';
export * from './repositories/ragRepository';
export {
  upsertPatient,
  getPatient,
  upsertCaregiver,
  getCaregiverForPatient,
  upsertMedication,
  getActiveMedications,
  getMedicationById,
  deleteMedication,
  deleteCarePlanMedicationsForPatient,
  upsertCondition,
  getConditionsForPatient,
  updatePatientConditionRoles,
  confirmPendingCondition,
  deleteCondition,
  deleteConditionsForPatient,
} from './repositories/patientRepository';
export * from './repositories/auditRepository';
export * from './repositories/consentRepository';
export * from './repositories/fhirResourceRepository';
export * from './repositories/medicationScheduleRepository';
export * from './repositories/medicationConfirmationRequirementRepository';
export * from './repositories/medicationConfirmationPreferenceRepository';
export * from './repositories/notificationRepository';
export * from './repositories/appSettingsRepository';
export * from './repositories/knowledgeCacheRepository';
export * from './repositories/knowledgeChunkEdgeRepository';
export * from './repositories/patientEnrichmentLogRepository';
export * from './repositories/symptomRepository';
export * from './repositories/wearableDeviceRepository';
export * from './repositories/mlEventRepository';
export {
  getBundleStatus,
  getPatientRecordSnapshot,
  setBundlePending,
  setBundleStatus,
} from './repositories/patientRecordRepository';
export * from './repositories/dailyCareEntryRepository';
export * from './repositories/carePlanRepository';
export * from './repositories/carePlanRehabMetricRepository';
export * from './repositories/rehabExerciseAssignmentRepository';
export * from './repositories/uc3TrajectoryResultRepository';
export * from './repositories/uc4PriorityRepository';
export * from './repositories/rehabilitationMeasurementRepository';
export * from './repositories/patientLongitudinalObservationRepository';
export * from './repositories/patientTimelineEventRepository';
export * from './repositories/patientCareContextRepository';
export * from './repositories/appointmentRepository';
export * from './repositories/thresholdRecommendationRepository';
export * from './repositories/SecureMessagingRepository';
export * from './sensors';
export * from './uc3RehabExercises';
export { seedDatabaseFromProfile } from './seed/seedFromProfile';

// FHIR resource layer (derived readers + C-CDA serializer).
export * from './fhir';

// CDA EHR import (planning/33): direct importer for standardized CDA JSON
// (longitudinal EHR dataset) into the existing SQLite schema.
export * from './cda';
