/**
 * Repository for caregiver medication-confirmation preferences.
 */

import { getDatabase } from '../db';
import type {
  MedicationConfirmationPreference,
  MedicationConfirmationPreferenceMode,
} from '../types';

const DEFAULT_MODE: MedicationConfirmationPreferenceMode = 'all';

function parseSelectedMedicationIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  } catch {
    return [];
  }
}

function normalizeMode(value: string | null | undefined): MedicationConfirmationPreferenceMode {
  if (value === 'all' || value === 'required_only' || value === 'personalized') {
    return value;
  }
  return DEFAULT_MODE;
}

function defaultPreference(patientId: string): MedicationConfirmationPreference {
  const now = new Date(0).toISOString();
  return {
    patientId,
    confirmationMode: DEFAULT_MODE,
    selectedMedicationIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function getMedicationConfirmationPreference(
  patientId: string,
): MedicationConfirmationPreference {
  const db = getDatabase();
  const row = db.getFirstSync<{
    patientId: string;
    confirmationMode: string;
    selectedMedicationIdsJson: string;
    createdAt: string;
    updatedAt: string;
  }>(
    `SELECT patient_id AS patientId,
            confirmation_mode AS confirmationMode,
            selected_medication_ids_json AS selectedMedicationIdsJson,
            created_at AS createdAt,
            updated_at AS updatedAt
     FROM medication_confirmation_preferences
     WHERE patient_id = ?
     LIMIT 1;`,
    patientId,
  );

  if (!row) return defaultPreference(patientId);
  return {
    patientId: row.patientId,
    confirmationMode: normalizeMode(row.confirmationMode),
    selectedMedicationIds: parseSelectedMedicationIds(row.selectedMedicationIdsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function saveMedicationConfirmationPreference(
  preference: Pick<
    MedicationConfirmationPreference,
    'patientId' | 'confirmationMode' | 'selectedMedicationIds'
  >,
): MedicationConfirmationPreference {
  const db = getDatabase();
  const existing = getMedicationConfirmationPreference(preference.patientId);
  const now = new Date().toISOString();
  const selectedMedicationIds = Array.from(new Set(preference.selectedMedicationIds));
  db.runSync(
    `INSERT INTO medication_confirmation_preferences
      (patient_id, confirmation_mode, selected_medication_ids_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(patient_id) DO UPDATE SET
       confirmation_mode = excluded.confirmation_mode,
       selected_medication_ids_json = excluded.selected_medication_ids_json,
       updated_at = excluded.updated_at;`,
    preference.patientId,
    preference.confirmationMode,
    JSON.stringify(selectedMedicationIds),
    existing.createdAt === new Date(0).toISOString() ? now : existing.createdAt,
    now,
  );

  return {
    patientId: preference.patientId,
    confirmationMode: preference.confirmationMode,
    selectedMedicationIds,
    createdAt: existing.createdAt === new Date(0).toISOString() ? now : existing.createdAt,
    updatedAt: now,
  };
}
