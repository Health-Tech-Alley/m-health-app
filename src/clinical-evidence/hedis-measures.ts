/**
 * HEDIS measure table — DISABLED for auto-injection (2026-07 prune).
 *
 * Previously the condition bundler wrote matching measures into
 * `care_plan_goals` and fetched PubMed packs tagged with measure ids. That
 * polluted Care-tab timelines, every orchestrator explain prompt
 * (`carePlanGoalsBlock`), and BM25 ranking with ambulatory preventive
 * boilerplate (adult immunization, BP 130/80 via `/cerebral/` matching CP,
 * smoking without tobacco status, etc.).
 *
 * ACCESS-DP targets severely disabled caregivers (CP GMFCS V, TBI, COPD,
 * Spina Bifida, post-stroke). Care-gap framing lives in the
 * `detect-care-gaps` skill (disability-first), not NCQA adult panels.
 *
 * This file keeps the historical measure definitions for reference / future
 * opt-in research only. `measuresForPatient` always returns [] so nothing
 * auto-applies. `bundleMeasurePack` is a no-op.
 */

import type { PatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';

export interface HedisMeasure {
  id: string;
  domain: string;
  appliesTo: (snapshot: PatientRecordSnapshot) => boolean;
  clinicalQuestion: string;
  carePlanGoal: string;
  sourceQuery: { pubmed: string; medlineplus?: string };
}

/**
 * Historical catalog — not applied. Do not re-enable without an explicit
 * product decision and a path that never writes `care_plan_goals`.
 */
export const HEDIS_MEASURES: HedisMeasure[] = [];

/** Always empty — HEDIS auto-goals and evidence packs are disabled. */
export function measuresForPatient(_snapshot: PatientRecordSnapshot): HedisMeasure[] {
  return [];
}
