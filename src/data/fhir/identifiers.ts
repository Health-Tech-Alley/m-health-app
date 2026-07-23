/**
 * FHIR identifier helpers.
 *
 * Deterministic id minting so the same typed row always produces the same
 * FHIR resource id. This keeps derived readers idempotent and makes C-CDA
 * export reproducible for audit.
 */

import type { FhirReference, FhirResourceType } from './types';

/**
 * Deterministic FHIR-style id from a typed row id. FHIR ids are limited to
 * [A-Za-z0-9-.]{1,64}. We sanitize the row id and prefix it with the resource
 * type so ids are unique across resource types in a Bundle.
 */
export function toFhirId(rowId: string, resourceType: FhirResourceType): string {
  const sanitized = rowId.replace(/[^A-Za-z0-9-.]/g, '-').slice(0, 48);
  return `${resourceType.toLowerCase()}-${sanitized}`;
}

/**
 * Build a FHIR reference (`{ reference: "ResourceType/id" }`) from a row id.
 */
export function toFhirReference(
  resourceType: FhirResourceType,
  rowId: string,
  display?: string,
): FhirReference {
  const ref: FhirReference = { reference: `${resourceType}/${toFhirId(rowId, resourceType)}` };
  if (display) ref.display = display;
  return ref;
}

/**
 * Build a logical URN-style UUID-ish identifier from a row id. Used for C-CDA
 * `<id root="..."/>` values where a URN is appropriate. We do not ship a real
 * UUID v5 implementation; this is a deterministic hash-derived URN.
 */
export function makeLogicalId(rowId: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000123;
  for (let i = 0; i < rowId.length; i++) {
    const c = rowId.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x100041b3) >>> 0;
  }
  const a = (h1 >>> 0).toString(16).padStart(8, '0');
  const b = (h2 >>> 0).toString(16).padStart(8, '0');
  const hex = (a + b).padEnd(16, '0').slice(0, 16);
  return `urn:oid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}
