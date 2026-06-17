/**
 * Consent token → FHIR Consent mapper.
 */

import type { ConsentToken } from '../types';
import { toFhirId, toFhirReference } from './identifiers';
import type { FhirConsent } from './types';

export function toFhirConsent(token: ConsentToken): FhirConsent {
  const revoked = token.revokedAt !== undefined;
  const expired = token.expiresAt !== undefined && new Date(token.expiresAt).getTime() < Date.now();
  const active = token.granted && !revoked && !expired;

  return {
    resourceType: 'Consent',
    id: toFhirId(token.tokenId, 'Consent'),
    meta: { versionId: '1', lastUpdated: token.createdAt },
    status: active ? 'active' : revoked ? 'inactive' : 'entered-in-error',
    scope: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/consentscope',
          code: 'patient-privacy',
          display: 'Privacy Consent',
        },
      ],
      text: token.scope,
    },
    patient: toFhirReference('Patient', token.patientId),
    provision: [
      {
        type: active ? 'permit' : 'deny',
        period: {
          start: token.createdAt,
          end: token.revokedAt ?? token.expiresAt,
        },
      },
    ],
  };
}
