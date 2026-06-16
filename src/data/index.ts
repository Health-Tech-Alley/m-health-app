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
} from './repositories/alertRepository';
export * from './repositories/ragRepository';
export * from './repositories/patientRepository';
export { seedDatabaseFromProfile } from './seed/seedFromProfile';
