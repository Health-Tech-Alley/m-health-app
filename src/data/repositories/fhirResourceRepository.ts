/**
 * Repository for the FHIR resource cache + export queue.
 */

import { getDatabase } from '../db';
import type { FhirResource, FhirResourceKind } from '../types';

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
