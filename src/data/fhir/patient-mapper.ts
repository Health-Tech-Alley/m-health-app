/**
 * Patient / caregiver / provider → FHIR resource mappers.
 */

import type { Caregiver, Patient } from '../types';
import { RXNORM_URI } from './codes';
import { toFhirId, toFhirReference } from './identifiers';
import type {
  FhirPatient,
  FhirPractitioner,
  FhirRelatedPerson,
} from './types';

function splitName(name: string): { family?: string; given?: string[]; text: string } {
  const trimmed = name.trim();
  if (!trimmed) return { text: 'Unknown' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { given: parts, text: trimmed };
  const family = parts[parts.length - 1];
  const given = parts.slice(0, -1);
  return { family, given, text: trimmed };
}

export function toFhirPatient(patient: Patient): FhirPatient {
  const { family, given, text } = splitName(patient.name);
  return {
    resourceType: 'Patient',
    id: toFhirId(patient.patientId, 'Patient'),
    meta: { lastUpdated: patient.updatedAt, versionId: '1' },
    identifier: [
      {
        use: 'official',
        system: 'urn:oid:1.2.3.4.5.6.7',
        value: patient.patientId,
      },
    ],
    name: [{ use: 'official', text, family, given }],
    gender: 'unknown',
    birthDate: parseBirthDate(patient.age),
    telecom: [],
  };
}

function parseBirthDate(age?: string): string | undefined {
  if (!age) return undefined;
  const digits = age.match(/(\d+)/);
  if (!digits) return undefined;
  const years = parseInt(digits[1], 10);
  if (!Number.isFinite(years) || years < 0 || years > 130) return undefined;
  const now = new Date();
  const birthYear = now.getUTCFullYear() - years;
  return `${birthYear}-01-01`;
}

export function toFhirRelatedPerson(
  caregiver: Caregiver,
  patientId: string,
): FhirRelatedPerson {
  const { family, given, text } = splitName(caregiver.name);
  return {
    resourceType: 'RelatedPerson',
    id: toFhirId(caregiver.caregiverId, 'RelatedPerson'),
    meta: { lastUpdated: caregiver.createdAt, versionId: '1' },
    patient: toFhirReference('Patient', patientId),
    relationship: caregiver.relationship
      ? [
          {
            coding: [
              { system: 'http://terminology.hl7.org/CodeSystem/v2-0131', code: 'C', display: caregiver.relationship },
            ],
            text: caregiver.relationship,
          },
        ]
      : undefined,
    name: [{ use: 'usual', text, family, given }],
    telecom: [],
  };
}

export interface ProviderRow {
  providerId: string;
  patientId: string;
  name: string;
  phone?: string;
  email?: string;
  role?: string;
  createdAt: string;
}

export function toFhirPractitioner(provider: ProviderRow): FhirPractitioner {
  const { family, given, text } = splitName(provider.name);
  const telecom = [];
  if (provider.phone) telecom.push({ system: 'phone' as const, value: provider.phone, use: 'work' as const });
  if (provider.email) telecom.push({ system: 'email' as const, value: provider.email, use: 'work' as const });
  return {
    resourceType: 'Practitioner',
    id: toFhirId(provider.providerId, 'Practitioner'),
    meta: { lastUpdated: provider.createdAt, versionId: '1' },
    identifier: [
      {
        use: 'official',
        system: RXNORM_URI,
        value: provider.providerId,
      },
    ],
    name: [{ use: 'official', text, family, given }],
    telecom,
  };
}
