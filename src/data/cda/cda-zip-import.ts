/**
 * CDA zip import service — planning/33 §6.
 *
 * Reads a `.zip` file (e.g. the `standardized_json/`
 * folder zipped) and imports every DOC*_deidentified.json file via
 * `importCdaJsonDoc`. The whole batch runs inside a single SQLite
 * transaction for atomicity.
 *
 * The picked zip URI comes from `expo-document-picker`. We read the
 * binary as a Uint8Array via `expo-file-system`'s `File.arrayBuffer()`,
 * then hand the bytes to `jszip` which inflates each entry as a string.
 *
 * Per-file errors are captured (file is skipped) so a single bad JSON
 * does not abort the import — the summary returned to the UI shows
 * per-file failure messages.
 */

import JSZip from 'jszip';
import { File } from 'expo-file-system';

import { getDatabase } from '@/data/db';
import { importCdaJsonDoc, type CdaImportSummary } from './cda-importer';
import type { CdaJsonDoc } from './cda-types';

export interface CdaZipImportSummary {
  filesDiscovered: number;
  filesImported: number;
  filesSkipped: number;
  totalConditions: number;
  totalMedications: number;
  totalVitals: number;
  totalNarrativeChunks: number;
  totalCarePlanActivities: number;
  totalLongitudinalObservations: number;
  totalAppointments: number;
  /** Per-file errors (file basename → error message). */
  errors: { file: string; message: string }[];
  /** Per-file summaries. */
  perFile: CdaImportSummary[];
  /** Total wall-clock time in milliseconds. */
  elapsedMs: number;
}

export interface ImportCdaZipOptions {
  /** Patient id to import under. */
  patientId: string;
  /** Whether to create the patient row if missing. */
  isNewPatient?: boolean;
  /**
   * Optional progress callback. Called once per file with the file
   * index, total count, and the per-file summary as it completes.
   */
  onProgress?: (fileIndex: number, total: number, summary: CdaImportSummary) => void;
}

/**
 * Import every DOC*_deidentified.json entry inside a zip file into the
 * SQLite database under the given patientId.
 *
 * Implementation: pre-load every file's text (async), then run the sync
 * importer inside a single SQLite transaction. JSZip's per-entry
 * reader is async, but `importCdaJsonDoc` is sync — we close the gap by
 * loading all strings first, then iterating them synchronously inside
 * `db.withTransactionSync`.
 */
export async function importCdaZip(
  zipUri: string,
  options: ImportCdaZipOptions,
): Promise<CdaZipImportSummary> {
  const start = Date.now();
  const errors: { file: string; message: string }[] = [];
  const perFile: CdaImportSummary[] = [];

  // 1. Read the zip bytes from the picked file
  const zipFile = new File(zipUri);
  const ab = await zipFile.arrayBuffer();
  const bytes = new Uint8Array(ab);
  const zip = await JSZip.loadAsync(bytes);

  // 2. Discover all *_deidentified.json entries (skip manifest.json and
  //    any non-JSON files in the zip)
  const jsonNames = Object.keys(zip.files)
    .filter((name) => /_deidentified\.json$/i.test(name) && !zip.files[name].dir)
    .sort();

  if (jsonNames.length === 0) {
    return {
      filesDiscovered: 0,
      filesImported: 0,
      filesSkipped: 0,
      totalConditions: 0,
      totalMedications: 0,
      totalVitals: 0,
      totalNarrativeChunks: 0,
      totalCarePlanActivities: 0,
      totalLongitudinalObservations: 0,
      totalAppointments: 0,
      errors: [{ file: '(zip)', message: 'No *_deidentified.json files found in the zip' }],
      perFile: [],
      elapsedMs: Date.now() - start,
    };
  }

  // 3. Preload all file contents (async — this is the only async part)
  const preloaded = await Promise.all(
    jsonNames.map((name) => zip.files[name].async('string').catch(() => null as string | null)),
  );

  // 4. Run the synchronous importer inside a single transaction
  const db = getDatabase();
  const total = jsonNames.length;
  let filesImported = 0;
  let filesSkipped = 0;
  let totalConditions = 0;
  let totalMedications = 0;
  let totalVitals = 0;
  let totalNarrativeChunks = 0;
  let totalCarePlanActivities = 0;
  let totalLongitudinalObservations = 0;
  let totalAppointments = 0;

  db.withTransactionSync(() => {
    for (let i = 0; i < total; i++) {
      const baseName = (jsonNames[i].split('/').pop() ?? jsonNames[i]);
      const text = preloaded[i];
      try {
        if (text == null) {
          throw new Error('Failed to read file content from zip');
        }
        const cda = JSON.parse(text) as CdaJsonDoc;
        if (!cda?.source_stem || !cda?.schema?.name) {
          throw new Error('Not a standardized_deidentified_cda_json document');
        }
        const summary = importCdaJsonDoc(cda, options.patientId, {
          isNewPatient: options.isNewPatient,
        });
        perFile.push(summary);
        filesImported++;
        totalConditions += summary.conditions;
        totalMedications += summary.medications;
        totalVitals += summary.vitals;
        totalNarrativeChunks += summary.narrativeChunks;
        totalCarePlanActivities += summary.carePlanActivities;
        totalLongitudinalObservations += summary.longitudinalObservations;
        totalAppointments += summary.appointments;
        options.onProgress?.(i + 1, total, summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ file: baseName, message });
        filesSkipped++;
        options.onProgress?.(i + 1, total, {
          docId: baseName,
          sourceFile: baseName,
          conditions: 0,
          medications: 0,
          vitals: 0,
          narrativeChunks: 0,
          carePlanActivities: 0,
          longitudinalObservations: 0,
          appointments: 0,
          patientCreated: false,
          warnings: [message],
        });
      }
    }
  });

  return {
    filesDiscovered: total,
    filesImported,
    filesSkipped,
    totalConditions,
    totalMedications,
    totalVitals,
    totalNarrativeChunks,
    totalCarePlanActivities,
    totalLongitudinalObservations,
    totalAppointments,
    errors,
    perFile,
    elapsedMs: Date.now() - start,
  };
}

/**
 * Read a single CDA JSON file (not a zip) into the importer. Useful for
 * the More tab "Import from health record" flow when the user has
 * already extracted the zip and picks one file.
 */
export function importCdaJsonString(
  jsonText: string,
  options: ImportCdaZipOptions,
): CdaImportSummary {
  const cda = JSON.parse(jsonText) as CdaJsonDoc;
  if (!cda?.source_stem || !cda?.schema?.name) {
    throw new Error('Not a standardized_deidentified_cda_json document');
  }
  return importCdaJsonDoc(cda, options.patientId, { isNewPatient: options.isNewPatient });
}
