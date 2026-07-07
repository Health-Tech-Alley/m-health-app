/**
 * CDA JSON → SQLite direct importer — planning/33 Avenue B.
 *
 * `importCdaJsonDoc(cda, patientId)` reads a single standardized CDA
 * JSON document and writes all sections directly to the existing 24-table
 * schema via the existing repositories. No FHIR conversion (Avenue A
 * loses the narrative sections, which are the highest-value SLM
 * context). No two-phase onboarding (Avenue C — the CDA data is too
 * redacted to drive the full profile).
 *
 * Sections handled per doc:
 *   - patient_conditions   (with SNOMED → ICD-10 cross-walk)
 *   - medications          (active meds, dedup by name)
 *   - health_samples       (structured vitals organizers)
 *   - knowledge_cache      (narrative + care_plan + functional_status
 *                          sections, BM25-retrievable for the SLM)
 *   - care_plans           (plan of treatment as a single care plan)
 *   - patient_longitudinal_observations  (functional status + pain scores)
 *   - appointments         (encounters as completed visits)
 *   - cda_documents        (per-doc metadata + import summary)
 *
 * Dedup strategy (per D6):
 *   - Conditions: stable condition_id = `cond-{patientId}-{icd10|snomed}`
 *     → re-imports are idempotent at the row level
 *   - Medications: stable medication_id = `med-{patientId}-{slug(name)}`
 *   - Vitals: all 83 structured vitals are kept (small volume)
 *   - Narrative chunks: stable chunkId = `CDA-{docId}-{slug(title)}`
 *
 * The function is sync (writes are SQLite-bound) and returns a per-doc
 * summary. The batch zip import (`cda-zip-import.ts`) wraps it in
 * transactions across the entire import.
 */

import {
  insertHealthSample,
} from '@/data/repositories/healthSampleRepository';
import {
  insertKnowledgeChunks,
} from '@/data/repositories/knowledgeCacheRepository';
import {
  upsertCarePlan,
} from '@/data/repositories/carePlanRepository';
import {
  upsertCondition,
  upsertMedication,
} from '@/data/repositories/patientRepository';
import {
  upsertPatientLongitudinalObservation,
} from '@/data/repositories/patientLongitudinalObservationRepository';
import { getDatabase } from '@/data/db';
import { insertAppointment } from '@/data/repositories/appointmentRepository';
import type { CarePlanActivity } from '@/data/types';
import type { CdaJsonDoc } from './cda-types';
import {
  extractSnomedCode,
  mapCdaCarePlanSectionToActivities,
  mapCdaConditionToPatientCondition,
  mapCdaDocToKnowledgeChunks,
  mapCdaEncounterToAppointment,
  mapCdaFunctionalStatusToObservations,
  mapCdaMedication,
  mapCdaVitalOrganizer,
} from './cda-mappers';

export interface CdaImportSummary {
  docId: string;
  sourceFile: string;
  conditions: number;
  medications: number;
  vitals: number;
  narrativeChunks: number;
  carePlanActivities: number;
  longitudinalObservations: number;
  appointments: number;
  /** When true, a new patient row was upserted from the CDA demographics. */
  patientCreated: boolean;
  /** Per-section parse / validation warnings (non-fatal). */
  warnings: string[];
}

const KNOWN_PRIMARY_SNOMED = new Set(['48721008']); // CP GMFCS V — primary diagnosis

function recordWarning(summary: CdaImportSummary, msg: string): void {
  summary.warnings.push(msg);
}

/**
 * Import a single standardized CDA JSON document into the SQLite schema.
 * Idempotent: re-importing the same doc (same source_stem) overwrites the
 * previous rows in `cda_documents` and re-stamps health_samples /
 * narrative chunks; condition / medication / care-plan rows are upserted
 * by stable content-derived IDs.
 */
export function importCdaJsonDoc(
  cda: CdaJsonDoc,
  patientId: string,
  options: { isNewPatient?: boolean } = {},
): CdaImportSummary {
  const summary: CdaImportSummary = {
    docId: cda.source_stem,
    sourceFile: cda.source_file,
    conditions: 0,
    medications: 0,
    vitals: 0,
    narrativeChunks: 0,
    carePlanActivities: 0,
    longitudinalObservations: 0,
    appointments: 0,
    patientCreated: Boolean(options.isNewPatient),
    warnings: [],
  };
  const db = getDatabase();
  const docId = cda.source_stem;
  const effectiveTime =
    typeof cda.document?.effective_time === 'string'
      ? cda.document.effective_time
      : (cda.document?.effective_time as { value?: string } | undefined)?.value ?? null;
  const title = cda.document?.title ?? null;

  // 1. Upsert a minimal patient row (only when the caller indicates a
  //    new patient). Existing rows are not touched (so caregiver-set
  //    identity fields persist across re-imports).
  if (options.isNewPatient) {
    const now = new Date().toISOString();
    db.runSync(
      `INSERT OR IGNORE INTO patients (patient_id, name, age, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?);`,
      patientId,
      'Patient Redacted',
      null,
      now,
      now,
    );
  }

  // 2. Conditions → patient_conditions (SNOMED → ICD-10 cross-walk)
  let isPrimarySet = false;
  for (const cond of cda.conditions ?? []) {
    if (!extractSnomedCode(cond)) continue;
    const isPrimary = !isPrimarySet && KNOWN_PRIMARY_SNOMED.has(extractSnomedCode(cond) ?? '');
    if (isPrimary) isPrimarySet = true;
    const mapped = mapCdaConditionToPatientCondition(cond, patientId, docId, isPrimary);
    if (!mapped) continue;
    upsertCondition(mapped);
    summary.conditions++;
  }
  if (!isPrimarySet && summary.conditions > 0) {
    recordWarning(summary, 'No primary condition detected — first imported condition is not CP');
  }

  // 3. Medications → medications (dedup by name)
  for (const med of cda.medications ?? []) {
    const mapped = mapCdaMedication(med, patientId, docId);
    if (!mapped) continue;
    try {
      upsertMedication({
        medicationId: mapped.medicationId,
        patientId: mapped.patientId,
        name: mapped.name,
        dosage: mapped.dosage ?? undefined,
        frequency: mapped.frequency ?? undefined,
        route: mapped.route ?? undefined,
        indication: mapped.indication ?? undefined,
        active: mapped.active,
        source: mapped.source,
      });
      summary.medications++;
    } catch (err) {
      recordWarning(summary, `medication upsert failed: ${(err as Error).message}`);
    }
  }

  // 4. Structured vitals → health_samples
  for (const org of cda.vitals?.structured ?? []) {
    const samples = mapCdaVitalOrganizer(org, patientId, docId);
    for (const s of samples) {
      try {
        insertHealthSample(s);
        summary.vitals++;
      } catch (err) {
        recordWarning(summary, `health_sample insert failed: ${(err as Error).message}`);
      }
    }
  }

  // 5. Narrative sections + care_plan + functional_status → knowledge_cache
  const chunks = mapCdaDocToKnowledgeChunks(cda, patientId, docId);
  if (chunks.length > 0) {
    try {
      insertKnowledgeChunks(chunks);
      summary.narrativeChunks = chunks.length;
    } catch (err) {
      recordWarning(summary, `knowledge_chunks insert failed: ${(err as Error).message}`);
    }
  }

  // 6. Care plan narrative → care_plans + care_plan_activities
  const carePlanRows = cda.care_plan ?? [];
  if (carePlanRows.length > 0) {
    const planId = `cda-${docId}-plan`;
    const now = new Date().toISOString();
    const activities: CarePlanActivity[] = [];
    let seq = 0;
    for (const item of carePlanRows) {
      const acts = mapCdaCarePlanSectionToActivities(item, planId, seq);
      seq += acts.length;
      for (const a of acts) {
        activities.push({
          activityId: a.activityId,
          planId: a.planId,
          status: a.status ?? undefined,
          description: a.description ?? undefined,
          sequence: a.sequence,
        });
        summary.carePlanActivities++;
      }
    }
    if (activities.length > 0) {
      try {
        upsertCarePlan({
          planId,
          patientId,
          version: 1,
          effectiveDate: now,
          status: 'active',
          intent: 'plan',
          title: `CDA Plan of Treatment — ${docId}`,
          description: activities
            .map((a) => a.description)
            .filter((d): d is string => Boolean(d))
            .join('\n\n')
            .slice(0, 2000),
          periodStart: effectiveTime ?? undefined,
          periodEnd: undefined,
          careTeamDisplayJson: undefined,
          safetyNotes: undefined,
          emergencyContact: undefined,
          createdAt: now,
          activities,
        });
      } catch (err) {
        recordWarning(summary, `care_plan upsert failed: ${(err as Error).message}`);
      }
    }
  }

  // 7. Functional status → patient_longitudinal_observations
  for (const item of cda.functional_status ?? []) {
    const recordedAt = effectiveTime ?? new Date().toISOString();
    const observations = mapCdaFunctionalStatusToObservations(item, docId, patientId, recordedAt);
    for (const o of observations) {
      try {
        upsertPatientLongitudinalObservation({
          patientId,
          observationId: o.observationId,
          measurementType: o.measurementType,
          recordedAt: o.recordedAt,
          encounterId: undefined,
          numericValue: o.numericValue,
          textValue: o.textValue,
          unit: o.unit,
          sourceSystem: o.sourceSystem,
          sourceCode: o.sourceCode,
          sourceType: o.sourceType,
        });
        summary.longitudinalObservations++;
      } catch (err) {
        recordWarning(summary, `longitudinal_obs upsert failed: ${(err as Error).message}`);
      }
    }
  }

  // 8. Encounters → appointments (only one row per source_stem so we
  //    don't accumulate 93 rows of the same visit; the appointment table
  //    is keyed per-row-id, so we only insert when no apt with this
  //    sourceDocId exists).
  for (const enc of cda.encounters ?? []) {
    const appt = mapCdaEncounterToAppointment(enc, docId, patientId);
    if (!appt) continue;
    try {
      // Check for an existing appointment with this sourceDocId (stored
      // in the reason field, since the schema doesn't carry a
      // source_doc_id column for appointments).
      const existing = db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM appointments WHERE patient_id = ? AND reason LIKE ? LIMIT 1;`,
        patientId,
        `%${docId}%`,
      );
      if (existing && existing.count > 0) continue;
      insertAppointment({
        appointmentId: appt.appointmentId,
        patientId: appt.patientId,
        type: appt.type,
        provider: appt.provider ?? undefined,
        date: appt.date,
        time: appt.time ?? undefined,
        location: appt.location ?? undefined,
        // Append docId so a re-import skips duplicates
        reason: appt.reason ? `${appt.reason} (${docId})` : docId,
        reminder: appt.reminder ?? undefined,
        status: appt.status,
      });
      summary.appointments++;
    } catch (err) {
      recordWarning(summary, `appointment insert failed: ${(err as Error).message}`);
    }
  }

  // 9. cda_documents row (overwrites the previous import summary)
  try {
    db.runSync(
      `INSERT OR REPLACE INTO cda_documents
        (doc_id, patient_id, source_file, effective_time, title, imported_at, import_summary_json)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      docId,
      patientId,
      cda.source_file,
      effectiveTime,
      title,
      new Date().toISOString(),
      JSON.stringify(summary),
    );
  } catch (err) {
    recordWarning(summary, `cda_documents row insert failed: ${(err as Error).message}`);
  }

  return summary;
}
