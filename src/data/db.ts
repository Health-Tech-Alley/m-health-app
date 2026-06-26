/**
 * On-device SQLite database access.
 *
 * This layer is designed to be swapped for SQLCipher later with minimal
 * changes. For now it uses expo-sqlite. All schema/migration logic lives
 * here; application code talks to repositories, never to this file directly.
 *
 * Track A (Expo Go) and Track B (dev build) share the same SQLite schema.
 * Encryption at rest is a future migration once SQLCipher is adopted.
 */

import { openDatabaseSync, SQLiteDatabase } from 'expo-sqlite';

import { MIGRATIONS } from './migrations';

const DB_NAME = 'caregiver-concierge.db';

let dbInstance: SQLiteDatabase | null = null;

export function getDatabase(): SQLiteDatabase {
  console.log('getDatabase() called', dbInstance ? 'returning existing instance' : 'creating new instance');
  if (!dbInstance) {
    const db = openDatabaseSync(DB_NAME);
    migrate(db);          // fully complete before assigning
    dbInstance = db;      // ← only now is it visible to other callers
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.closeSync();
    dbInstance = null;
  }
}

function migrate(db: SQLiteDatabase): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS __migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  for (let i = 0; i < MIGRATIONS.length; i++) {
    console.log(`Checking migration ${i}...`);
    const exists = db.getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM __migrations WHERE id = ?;',
      i,
    );
    if (exists && exists.count > 0) continue;

    db.execSync(MIGRATIONS[i]);
    db.runSync(
      'INSERT INTO __migrations (id, applied_at) VALUES (?, ?);',
      i,
      new Date().toISOString(),
    );
  }
}

/** Wipe all app data. Useful for testing/reset. */
export function resetDatabase(): void {
  const db = getDatabase();
  db.execSync(`
    DROP TABLE IF EXISTS health_samples;
    DROP TABLE IF EXISTS health_sync_state;
    DROP TABLE IF EXISTS thresholds;
    DROP TABLE IF EXISTS alerts;
    DROP TABLE IF EXISTS caregiver_actions;
    DROP TABLE IF EXISTS rag_citations;
    DROP TABLE IF EXISTS slm_turns;
    DROP TABLE IF EXISTS slm_citations;
    DROP TABLE IF EXISTS trigger_events;
    DROP TABLE IF EXISTS graph_edges;
    DROP TABLE IF EXISTS audit_log;
    DROP TABLE IF EXISTS consent_tokens;
    DROP TABLE IF EXISTS patients;
    DROP TABLE IF EXISTS caregivers;
    DROP TABLE IF EXISTS medications;
    DROP TABLE IF EXISTS patient_conditions;
    DROP TABLE IF EXISTS care_plans;
    DROP TABLE IF EXISTS care_plan_goals;
    DROP TABLE IF EXISTS slm_turns;
    DROP TABLE IF EXISTS slm_citations;
    DROP TABLE IF EXISTS fhir_resources;
    DROP TABLE IF EXISTS medication_schedules;
    DROP TABLE IF EXISTS notifications;
    DROP TABLE IF EXISTS notification_preferences;
    DROP TABLE IF EXISTS app_settings;
    DROP TABLE IF EXISTS knowledge_cache;
    DROP TABLE IF EXISTS patient_enrichment_log;
    DROP TABLE IF EXISTS symptoms;
    DROP TABLE IF EXISTS wearable_devices;
    DROP TABLE IF EXISTS ml_events;
    DROP TABLE IF EXISTS daily_care_entries;
    DROP TABLE IF EXISTS appointments;
    DROP TABLE IF EXISTS threshold_recommendations;
    DROP TABLE IF EXISTS __migrations;
  `);
  closeDatabase();
  dbInstance = null;
  getDatabase();
}
