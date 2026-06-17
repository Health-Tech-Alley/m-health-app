/**
 * Data layer public API.
 *
 * Repositories are the only sanctioned read/write surface. Application code
 * (services, orchestration) imports from here, never from db.ts directly.
 */

export { getDatabase, closeDatabase, resetDatabase } from './db';
export { MIGRATIONS } from './migrations';
export * from './types';

export * from './repositories/healthSampleRepository';
export * from './repositories/thresholdRepository';
export {
  insertAlert,
  getOpenAlerts,
  getActiveAlerts,
  getAlertById,
  updateAlertStatus,
  insertCaregiverAction,
  getActionsForAlert,
  resolveAllAlerts,
} from './repositories/alertRepository';
export * from './repositories/ragRepository';
export * from './repositories/patientRepository';
export * from './repositories/auditRepository';
export * from './repositories/consentRepository';
export * from './repositories/fhirResourceRepository';
export * from './repositories/medicationScheduleRepository';
export * from './repositories/notificationRepository';
export * from './repositories/appSettingsRepository';
export * from './sensors';
export { seedDatabaseFromProfile } from './seed/seedFromProfile';

// FHIR resource layer (derived readers + C-CDA serializer).
export * from './fhir';
