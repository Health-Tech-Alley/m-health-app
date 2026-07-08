/**
 * CDA EHR import — public API.
 *
 * Re-exports the importer + mappers so the UI layer (and tests) can
 * import from a single entry point. Keep this file thin — it should
 * only re-export, never define new symbols.
 */

export type { CdaJsonDoc } from './cda-types';
export type { CdaImportSummary } from './cda-importer';
export type { CdaZipImportSummary, ImportCdaZipOptions } from './cda-zip-import';

export { importCdaJsonDoc } from './cda-importer';
export { importCdaZip, importCdaJsonString } from './cda-zip-import';
export {
  isRealSnomedCode,
  lookupSnomedToIcd10,
  SNOMED_TO_ICD10,
} from './snomed-icd10-map';
