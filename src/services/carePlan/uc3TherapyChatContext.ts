/**
 * UC3 / therapy Concierge helpers — locator-first (no mutable session dumps).
 *
 * Daily reps/ROM/pain/etc. stay in SQLite; prompts only say where they live.
 * In-card explain still gets a short seed pointer + optional UC3 eval labels
 * already on the result card (not a full multi-day metric transcript).
 */

import type { PatientRecordSnapshot } from '@/data/types';
import { getAssignedDevelopmentRehabExercises } from '@/data/uc3RehabExercises';
import { buildLocalDataLocatorContext } from '@/services/slm/localDataLocatorContext';

/** @deprecated Prefer buildLocalDataLocatorContext — kept name for call sites. */
export function buildUc3TherapySystemContext(
  snapshot: PatientRecordSnapshot | null | undefined,
): string {
  const locator = buildLocalDataLocatorContext(snapshot);
  if (!snapshot) return locator;

  const assigned = getAssignedDevelopmentRehabExercises(
    snapshot.rehabExerciseAssignments ?? [],
  );
  const ex =
    assigned.length > 0
      ? `Assigned exercise names (labels only): ${assigned.map((e) => e.label).join('; ')}.`
      : 'Assigned exercise names: none in record.';

  const uc3 = snapshot.latestUc3TrajectoryResult;
  const evalLine = uc3
    ? `Latest rehab-progress eval label: ${uc3.eventType} (sev=${uc3.severity}) — detail on Care → Therapy; do not invent metric series.`
    : 'Latest rehab-progress eval: none stored yet.';

  // No daily metric values — only names + where to look.
  return [locator, '', 'THERAPY POINTERS', ex, evalLine].join('\n');
}

/**
 * Short seed add-on for in-card explain. No session number dumps.
 */
export function buildUc3TherapySeedSupplement(
  snapshot: PatientRecordSnapshot | null | undefined,
): string {
  if (!snapshot) return '';

  const assigned = getAssignedDevelopmentRehabExercises(
    snapshot.rehabExerciseAssignments ?? [],
  );
  const ex =
    assigned.length > 0
      ? assigned.map((e) => e.label).join('; ')
      : 'none assigned';

  const hasToday = Boolean(snapshot.todayDailyCareEntry);
  const histN = (snapshot.rehabDailyEntries ?? []).length;
  const logPtr =
    hasToday || histN > 0
      ? `Daily session rows exist in daily_care_entries (today=${hasToday ? 'yes' : 'no'}, history_rows=${histN}) — open Care → Therapy for values.`
      : 'No daily therapy session rows yet — caregiver logs on Care → Therapy.';

  return `\nTherapy pointers — assigned exercises (names only): ${ex}. ${logPtr}`;
}

export function snapshotHasTherapyGroundTruth(
  snapshot: PatientRecordSnapshot | null | undefined,
): boolean {
  if (!snapshot) return false;
  if (snapshot.therapyContractPresent) return true;
  if ((snapshot.rehabExerciseAssignments ?? []).some((a) => a.active)) return true;
  if ((snapshot.rehabPlanMetrics ?? []).length > 0) return true;
  if (snapshot.todayDailyCareEntry) return true;
  if ((snapshot.rehabDailyEntries ?? []).length > 0) return true;
  if (snapshot.latestUc3TrajectoryResult) return true;
  return false;
}
