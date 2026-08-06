import { getDatabase } from '../db';
import type { PatientSafetyProfile } from '../types';

type PatientSafetyRow = Omit<PatientSafetyProfile, 'emergencyDisclaimerAccepted'> & {
  emergencyDisclaimerAccepted: number | boolean | null;
};

const PATIENT_SAFETY_COLUMNS =
  `patient_id AS patientId, emergency_contact_name AS emergencyContactName,
   emergency_contact_relationship AS emergencyContactRelationship,
   emergency_contact_phone AS emergencyContactPhone,
   emergency_instructions AS emergencyInstructions,
   emergency_disclaimer_accepted AS emergencyDisclaimerAccepted,
   updated_at AS updatedAt`;

export type UpsertPatientSafetyProfileInput = Pick<PatientSafetyProfile, 'patientId'> &
  Partial<Omit<PatientSafetyProfile, 'patientId' | 'updatedAt'>>;

function requirePatientId(patientId: string): string {
  const normalized = patientId.trim();
  if (!normalized) {
    throw new Error('patientId is required for safety profile operations.');
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.trim() || null;
}

function resolveOptionalText(
  value: string | null | undefined,
  existingValue: string | null | undefined,
): string | null {
  return value === undefined
    ? existingValue ?? null
    : normalizeOptionalText(value) ?? null;
}

function mapPatientSafetyProfile(row: PatientSafetyRow): PatientSafetyProfile {
  return {
    ...row,
    emergencyDisclaimerAccepted:
      row.emergencyDisclaimerAccepted === null
        ? null
        : Boolean(row.emergencyDisclaimerAccepted),
  };
}

export function getPatientSafetyProfileForPatient(
  patientId: string,
): PatientSafetyProfile | null {
  const db = getDatabase();
  const scopedPatientId = requirePatientId(patientId);
  const row = db.getFirstSync<PatientSafetyRow>(
    `SELECT ${PATIENT_SAFETY_COLUMNS}
     FROM patient_safety_profiles
     WHERE patient_id = ?
     LIMIT 1;`,
    scopedPatientId,
  );

  return row ? mapPatientSafetyProfile(row) : null;
}

export function upsertPatientSafetyProfileForPatient(
  input: UpsertPatientSafetyProfileInput,
): PatientSafetyProfile {
  const patientId = requirePatientId(input.patientId);
  const existing = getPatientSafetyProfileForPatient(patientId);
  const updatedAt = new Date().toISOString();
  const next: PatientSafetyProfile = {
    patientId,
    emergencyContactName: resolveOptionalText(
      input.emergencyContactName,
      existing?.emergencyContactName,
    ),
    emergencyContactRelationship: resolveOptionalText(
      input.emergencyContactRelationship,
      existing?.emergencyContactRelationship,
    ),
    emergencyContactPhone: resolveOptionalText(
      input.emergencyContactPhone,
      existing?.emergencyContactPhone,
    ),
    emergencyInstructions: resolveOptionalText(
      input.emergencyInstructions,
      existing?.emergencyInstructions,
    ),
    emergencyDisclaimerAccepted:
      input.emergencyDisclaimerAccepted === undefined
        ? existing?.emergencyDisclaimerAccepted ?? null
        : input.emergencyDisclaimerAccepted,
    updatedAt,
  };

  const db = getDatabase();
  db.runSync(
    `INSERT INTO patient_safety_profiles
      (patient_id, emergency_contact_name, emergency_contact_relationship,
       emergency_contact_phone, emergency_instructions,
       emergency_disclaimer_accepted, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(patient_id) DO UPDATE SET
       emergency_contact_name = excluded.emergency_contact_name,
       emergency_contact_relationship = excluded.emergency_contact_relationship,
       emergency_contact_phone = excluded.emergency_contact_phone,
       emergency_instructions = excluded.emergency_instructions,
       emergency_disclaimer_accepted = excluded.emergency_disclaimer_accepted,
       updated_at = excluded.updated_at;`,
    next.patientId,
    next.emergencyContactName ?? null,
    next.emergencyContactRelationship ?? null,
    next.emergencyContactPhone ?? null,
    next.emergencyInstructions ?? null,
    next.emergencyDisclaimerAccepted === null
      ? null
      : next.emergencyDisclaimerAccepted
        ? 1
        : 0,
    next.updatedAt,
  );

  return next;
}
