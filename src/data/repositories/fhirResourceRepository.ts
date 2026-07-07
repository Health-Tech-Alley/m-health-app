/**
 * Repository for the FHIR resource cache + export queue.
 */

import { getDatabase } from '../db';
import type { FhirResource, FhirResourceKind, MedicationCandidate } from '../types';

const MEDICATION_REVIEW_BASIC_CODES = new Set([
  'medication-review',
  'short-course-medication-history',
  'perioperative-medication-context',
  'iv-fluid-context',
  'rescue-reversal-medication-context',
]);

export function upsertFhirResource(resource: FhirResource): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO fhir_resources
      (resource_type, resource_id, version, kind, payload_json, last_synced_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    resource.resourceType,
    resource.resourceId,
    resource.version,
    resource.kind,
    resource.payloadJson,
    resource.lastSyncedAt,
    resource.createdAt,
  );
}

export function getFhirResource(
  resourceType: string,
  resourceId: string,
): FhirResource | null {
  const db = getDatabase();
  return (
    db.getFirstSync<FhirResource>(
      `SELECT resource_type AS resourceType, resource_id AS resourceId,
              version, kind, payload_json AS payloadJson,
              last_synced_at AS lastSyncedAt, created_at AS createdAt
       FROM fhir_resources
       WHERE resource_type = ? AND resource_id = ?
       ORDER BY version DESC LIMIT 1;`,
      resourceType,
      resourceId,
    ) ?? null
  );
}

export function getLatestFhirResourceVersion(
  resourceType: string,
  resourceId: string,
): number {
  const db = getDatabase();
  const row = db.getFirstSync<{ version: number }>(
    `SELECT version FROM fhir_resources
     WHERE resource_type = ? AND resource_id = ?
     ORDER BY version DESC LIMIT 1;`,
    resourceType,
    resourceId,
  );
  return row?.version ?? 0;
}

export function getFhirResourcesByKind(kind: FhirResourceKind): FhirResource[] {
  const db = getDatabase();
  return db.getAllSync<FhirResource>(
    `SELECT resource_type AS resourceType, resource_id AS resourceId,
            version, kind, payload_json AS payloadJson,
            last_synced_at AS lastSyncedAt, created_at AS createdAt
     FROM fhir_resources
     WHERE kind = ?
     ORDER BY created_at DESC;`,
    kind,
  );
}

export function getMedicationCandidatesForPatient(patientId: string): MedicationCandidate[] {
  const resources = getFhirResourcesByKind('imported');
  const candidates: MedicationCandidate[] = [];

  for (const resource of resources) {
    if (resource.resourceType !== 'Basic') continue;

    const parsed = parseJsonResource(resource.payloadJson);
    if (!parsed || getBasicCode(parsed) === null) continue;
    const category = getBasicCode(parsed);
    if (!category || !MEDICATION_REVIEW_BASIC_CODES.has(category)) continue;
    if (getPatientReferenceId(parsed.subject?.reference) !== patientId) continue;

    const label = getStringExtension(parsed, 'medication-label') ?? parsed.code?.text;
    if (!label) continue;

    const source = getFirstSourceReference(parsed);
    candidates.push({
      candidateId: parsed.id,
      patientId,
      name: label,
      category,
      currentHomeUseStatus: 'unknown',
      confirmationRequired: getBooleanExtension(parsed, 'confirmation-required') ?? true,
      sourceFile: source?.sourceFile,
      visitIndex: source?.visitIndex,
      daysFromFirstVisit: source?.daysFromFirstVisit,
      summary: parsed.note?.[0]?.text,
      fhirResourceId: parsed.id,
    });
  }

  return candidates.sort((a, b) => {
    const visitDelta = (a.visitIndex ?? Number.MAX_SAFE_INTEGER) - (b.visitIndex ?? Number.MAX_SAFE_INTEGER);
    if (visitDelta !== 0) return visitDelta;
    return a.name.localeCompare(b.name);
  });
}

export function deleteFhirResource(
  resourceType: string,
  resourceId: string,
  version: number,
): void {
  const db = getDatabase();
  db.runSync(
    'DELETE FROM fhir_resources WHERE resource_type = ? AND resource_id = ? AND version = ?;',
    resourceType,
    resourceId,
    version,
  );
}

function parseJsonResource(payloadJson: string): any | null {
  try {
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

function getBasicCode(resource: any): string | null {
  return resource.code?.coding?.[0]?.code ?? resource.code?.text ?? null;
}

function getPatientReferenceId(reference?: string): string | null {
  if (!reference) return null;
  return reference.split('/').pop() ?? null;
}

function getStringExtension(resource: any, suffix: string): string | null {
  const extension = resource.extension?.find((item: any) => item?.url?.endsWith(`/${suffix}`));
  return extension?.valueString ?? null;
}

function getBooleanExtension(resource: any, suffix: string): boolean | null {
  const extension = resource.extension?.find((item: any) => item?.url?.endsWith(`/${suffix}`));
  return typeof extension?.valueBoolean === 'boolean' ? extension.valueBoolean : null;
}

function getFirstSourceReference(resource: any): {
  sourceFile?: string;
  visitIndex?: number;
  daysFromFirstVisit?: number;
} | null {
  const sourceReference = resource.extension?.find((item: any) =>
    item?.url?.endsWith('/source-reference'),
  );
  if (!sourceReference?.extension) return null;

  const getNestedValue = (name: string): string | number | undefined => {
    const item = sourceReference.extension.find((nested: any) => nested?.url === name);
    return item?.valueString ?? item?.valueInteger;
  };

  const sourceFile = getNestedValue('source_file');
  const visitIndex = getNestedValue('visit_index');
  const daysFromFirstVisit = getNestedValue('days_from_first_visit');

  return {
    sourceFile: typeof sourceFile === 'string' ? sourceFile : undefined,
    visitIndex: typeof visitIndex === 'number' ? visitIndex : undefined,
    daysFromFirstVisit: typeof daysFromFirstVisit === 'number' ? daysFromFirstVisit : undefined,
  };
}
