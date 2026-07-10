import type { NormalizedActivePatient } from '@/data/types';

export const UNKNOWN_PATIENT = 'Unknown';
export const NOT_PROVIDED = 'Not provided';
export const NOT_AVAILABLE = 'Not available';
export const PENDING_CONFIRMATION = 'Pending confirmation';

export function displayEntered(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || NOT_PROVIDED;
}

export function displayClinical(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || NOT_AVAILABLE;
}

export function getPatientDisplayName(patient: NormalizedActivePatient | null): string {
  if (!patient) return UNKNOWN_PATIENT;
  return patient.displayName.trim() || UNKNOWN_PATIENT;
}

export function getPatientAgeDisplay(patient: NormalizedActivePatient | null): string {
  if (!patient) return NOT_PROVIDED;
  return displayEntered(patient.age);
}

export function getCaregiverDisplay(patient: NormalizedActivePatient | null): string {
  if (!patient?.caregiver) return NOT_PROVIDED;
  return displayEntered(patient.caregiver.name);
}

export function getCaregiverRoleDisplay(patient: NormalizedActivePatient | null): string {
  if (!patient?.caregiver) return NOT_PROVIDED;
  return displayEntered(patient.caregiver.relationship);
}

export function getPrimaryDiagnosisDisplay(patient: NormalizedActivePatient | null): string {
  if (!patient) return NOT_AVAILABLE;
  if (patient.primaryDiagnosis) {
    return [
      patient.primaryDiagnosis.icd10,
      patient.primaryDiagnosis.name,
    ].filter(Boolean).join(' - ');
  }
  if (patient.pendingConditions.length > 0) return PENDING_CONFIRMATION;
  return NOT_AVAILABLE;
}

export function getComorbiditiesDisplay(patient: NormalizedActivePatient | null): string {
  if (!patient) return NOT_AVAILABLE;
  if (patient.comorbidities.length > 0) {
    return patient.comorbidities
      .map((condition) => [condition.icd10, condition.name].filter(Boolean).join(' - '))
      .join(', ');
  }
  if (patient.pendingConditions.length > 0) return PENDING_CONFIRMATION;
  return NOT_AVAILABLE;
}
