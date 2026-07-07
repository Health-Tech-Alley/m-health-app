/**
 * Repository for patient-medication confirmation requirements.
 */

import { getDatabase } from '../db';
import type {
  MedicationConfirmationRequirement,
  MedicationConfirmationRequirementSource,
} from '../types';

const DEFAULT_REQUIREMENT: Pick<
  MedicationConfirmationRequirement,
  'confirmationRequirement'
> = {
  confirmationRequirement: 'not_provided',
};

function mapRow(row: {
  patientId: string;
  medicationId: string;
  confirmationRequirement: MedicationConfirmationRequirement['confirmationRequirement'];
  requirementSource: MedicationConfirmationRequirementSource;
  createdAt: string;
  updatedAt: string;
}): MedicationConfirmationRequirement {
  return {
    patientId: row.patientId,
    medicationId: row.medicationId,
    confirmationRequirement: row.confirmationRequirement,
    requirementSource: row.requirementSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function getMedicationConfirmationRequirement(
  patientId: string,
  medicationId: string,
): MedicationConfirmationRequirement {
  const db = getDatabase();
  const row = db.getFirstSync<{
    patientId: string;
    medicationId: string;
    confirmationRequirement: MedicationConfirmationRequirement['confirmationRequirement'];
    requirementSource: MedicationConfirmationRequirementSource;
    createdAt: string;
    updatedAt: string;
  }>(
    `SELECT patient_id AS patientId, medication_id AS medicationId,
            confirmation_requirement AS confirmationRequirement,
            requirement_source AS requirementSource,
            created_at AS createdAt, updated_at AS updatedAt
     FROM medication_confirmation_requirements
     WHERE patient_id = ? AND medication_id = ?
     ORDER BY
       CASE requirement_source
         WHEN 'provider_configuration' THEN 1
         WHEN 'demo_override' THEN 2
         WHEN 'fhir_extension' THEN 3
         WHEN 'demo_fixture' THEN 4
         ELSE 5
       END
     LIMIT 1;`,
    patientId,
    medicationId,
  );

  if (row) return mapRow(row);
  const now = new Date(0).toISOString();
  return {
    patientId,
    medicationId,
    ...DEFAULT_REQUIREMENT,
    createdAt: now,
    updatedAt: now,
  };
}

export function getMedicationConfirmationRequirementsForPatient(
  patientId: string,
): Record<string, MedicationConfirmationRequirement> {
  const db = getDatabase();
  const rows = db.getAllSync<{
    patientId: string;
    medicationId: string;
    confirmationRequirement: MedicationConfirmationRequirement['confirmationRequirement'];
    requirementSource: MedicationConfirmationRequirementSource;
    createdAt: string;
    updatedAt: string;
  }>(
    `SELECT patient_id AS patientId, medication_id AS medicationId,
            confirmation_requirement AS confirmationRequirement,
            requirement_source AS requirementSource,
            created_at AS createdAt, updated_at AS updatedAt
     FROM medication_confirmation_requirements
     WHERE patient_id = ?
     ORDER BY
       medication_id,
       CASE requirement_source
         WHEN 'provider_configuration' THEN 1
         WHEN 'demo_override' THEN 2
         WHEN 'fhir_extension' THEN 3
         WHEN 'demo_fixture' THEN 4
         ELSE 5
       END;`,
    patientId,
  );

  const byMedicationId: Record<string, MedicationConfirmationRequirement> = {};
  for (const row of rows) {
    if (byMedicationId[row.medicationId]) continue;
    byMedicationId[row.medicationId] = mapRow(row);
  }
  return byMedicationId;
}

export function setDemoMedicationConfirmationRequired(
  patientId: string,
  medicationId: string,
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.runSync(
    `INSERT INTO medication_confirmation_requirements
      (patient_id, medication_id, confirmation_requirement, requirement_source, created_at, updated_at)
     VALUES (?, ?, 'required', 'demo_override', ?, ?)
     ON CONFLICT(patient_id, medication_id, requirement_source) DO UPDATE SET
       confirmation_requirement = 'required',
       updated_at = excluded.updated_at;`,
    patientId,
    medicationId,
    now,
    now,
  );
}

export function removeDemoMedicationConfirmationRequirement(
  patientId: string,
  medicationId: string,
): void {
  const db = getDatabase();
  db.runSync(
    `DELETE FROM medication_confirmation_requirements
     WHERE patient_id = ? AND medication_id = ? AND requirement_source = 'demo_override';`,
    patientId,
    medicationId,
  );
}
