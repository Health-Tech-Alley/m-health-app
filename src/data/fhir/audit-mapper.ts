/**
 * Audit log entry → FHIR Provenance mapper.
 *
 * Each audit entry becomes a Provenance resource that attests who acted on
 * which resource, when. The hash chain is preserved as the Provenance id
 * suffix so the chain can be re-verified downstream.
 */

import type { AuditLogEntry } from '../types';
import { toFhirId } from './identifiers';
import type { FhirCodeableConcept, FhirProvenance } from './types';

const ACTOR_DISPLAY: Record<AuditLogEntry['actor'], string> = {
  orchestrator: 'Caregiver Concierge Orchestrator',
  caregiver: 'Caregiver',
  slm: 'On-device SLM',
  system: 'System',
};

const ACTION_CODE_MAP: Record<string, { code: string; display: string }> = {
  create: { code: 'create', display: 'Create' },
  read: { code: 'read', display: 'Read' },
  update: { code: 'update', display: 'Update' },
  delete: { code: 'delete', display: 'Delete' },
  generate: { code: 'generate', display: 'Generate' },
  grant: { code: 'grant', display: 'Grant' },
  revoke: { code: 'revoke', display: 'Revoke' },
  ack: { code: 'acknowledge', display: 'Acknowledge' },
  override: { code: 'override', display: 'Override' },
  escalate: { code: 'escalate', display: 'Escalate' },
};

function actorToReference(actor: AuditLogEntry['actor'], patientId?: string): { reference: string; display?: string } {
  switch (actor) {
    case 'caregiver':
      return patientId
        ? { reference: `RelatedPerson/caregiver-${patientId}`, display: 'Caregiver' }
        : { reference: 'RelatedPerson/unknown', display: 'Caregiver' };
    case 'slm':
      return { reference: 'Device/slm', display: ACTOR_DISPLAY.slm };
    case 'system':
      return { reference: 'Device/system', display: ACTOR_DISPLAY.system };
    case 'orchestrator':
    default:
      return { reference: 'Device/orchestrator', display: ACTOR_DISPLAY.orchestrator };
  }
}

export function toFhirProvenance(entry: AuditLogEntry): FhirProvenance {
  const activity: FhirCodeableConcept | undefined = ACTION_CODE_MAP[entry.action]
    ? {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation',
            code: ACTION_CODE_MAP[entry.action].code,
            display: ACTION_CODE_MAP[entry.action].display,
          },
        ],
        text: entry.action,
      }
    : { coding: [], text: entry.action };

  const target = entry.resourceId
    ? [
        {
          reference: `${entry.resourceType}/${toFhirId(entry.resourceId, 'Provenance')}`,
          display: `${entry.resourceType} ${entry.resourceId}`,
        },
      ]
    : [{ reference: `${entry.resourceType}/unknown` }];

  return {
    resourceType: 'Provenance',
    id: toFhirId(entry.auditId, 'Provenance'),
    meta: { versionId: '1', lastUpdated: entry.createdAt },
    target,
    recorded: entry.createdAt,
    activity,
    agent: [
      {
        who: actorToReference(entry.actor, entry.patientId),
        role: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type',
                code: 'author',
                display: 'Author',
              },
            ],
            text: ACTOR_DISPLAY[entry.actor],
          },
        ],
      },
    ],
  };
}
