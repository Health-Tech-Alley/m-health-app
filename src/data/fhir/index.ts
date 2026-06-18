/**
 * FHIR resource layer — public barrel.
 *
 * Re-exports the typed FHIR interfaces, terminology maps, identifier helpers,
 * and the row→FHIR mappers. C-CDA serialization is exported from `./ccda`.
 */

export * from './types';
export * from './codes';
export * from './identifiers';
export * from './patient-mapper';
export * from './clinical-mappers';
export * from './care-plan-mapper';
export * from './consent-mapper';
export * from './audit-mapper';
export {
  SECTIONS,
  CCD_TEMPLATE_OID,
  CCD_FULL_LOINC,
  CCD_DOCUMENT_LOINC,
} from './ccda/ccda-templates';
export { buildCcdDocument } from './ccda/ccda-serializer';
export type { BuildCcdDocumentParams } from './ccda/ccda-serializer';
export { buildFhirComposition } from './ccda/composition-builder';
export type { BuildCompositionParams } from './ccda/composition-builder';
