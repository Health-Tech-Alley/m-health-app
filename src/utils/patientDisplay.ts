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

/**
 * English possessive with a typographic apostrophe.
 * Names ending in s/S/z/Z use trailing apostrophe only (James’ not James’s).
 */
export function formatPossessive(name: string): string {
  const n = name.trim();
  if (!n || n === UNKNOWN_PATIENT || n === NOT_PROVIDED || n === NOT_AVAILABLE) {
    return n;
  }
  if (/[sSzZ]$/.test(n)) return `${n}\u2019`;
  return `${n}\u2019s`;
}

/** First token of a display name (for “James’ Care Plan”). */
export function getFirstName(displayName: string): string {
  const n = displayName.trim();
  return n.split(/\s+/)[0] || n;
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
