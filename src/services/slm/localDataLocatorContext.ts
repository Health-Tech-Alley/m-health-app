/**
 * Compact map of where on-device patient facts live — not the facts themselves.
 *
 * Keeps n_ctx free of mutable daily logs / vitals dumps. Concierge is told
 * which SQLite tables and caregiver surfaces hold therapy sessions, care
 * focus, considerations, HealthKit samples, etc., and must not invent values.
 */

import type { PatientRecordSnapshot } from '@/data/types';

const MAX_CHARS = 1100;

function presenceLine(snapshot: PatientRecordSnapshot): string {
  const dailyN = (snapshot.rehabDailyEntries ?? []).length;
  const today = Boolean(snapshot.todayDailyCareEntry);
  const assignN = (snapshot.rehabExerciseAssignments ?? []).filter((a) => a.active)
    .length;
  const uc4N = (snapshot.latestUc4PriorityCards ?? []).length;
  const pendingN = (snapshot.pendingPlanProposals ?? []).length;
  const medN = (snapshot.medications ?? []).filter((m) => m.active !== false).length;
  const thrN = (snapshot.thresholds ?? []).length;
  const ctxN = (snapshot.careContextItems ?? []).length;
  const uc3 = snapshot.latestUc3TrajectoryResult?.eventType ?? 'none';

  return [
    today || dailyN > 0
      ? `rehab_logs=yes(today=${today ? 'y' : 'n'},hist=${dailyN})`
      : 'rehab_logs=none',
    `exercises=${assignN}`,
    `uc3=${uc3}`,
    `care_focus=${uc4N}`,
    `your_review=${pendingN}`,
    `considerations=${ctxN}`,
    `meds=${medN}`,
    `thresholds=${thrN}`,
  ].join('; ');
}

/**
 * Stable locator block for main Concierge and in-card paths.
 */
export function buildLocalDataLocatorContext(
  snapshot: PatientRecordSnapshot | null | undefined,
): string {
  if (!snapshot?.patient?.patientId) {
    return [
      'LOCAL DATA MAP (on-device)',
      'No patient loaded — do not invent clinical or therapy values.',
    ].join('\n');
  }

  const lines = [
    'LOCAL DATA MAP (SQLite + UI — locations only, not row values)',
    'Do not invent vitals, rehab numbers, priorities, or meds. If a value is not already in this prompt, say it is not loaded here and point the caregiver to the surface below.',
    `Presence: ${presenceLine(snapshot)}`,
    'Stores:',
    '- Therapy sessions (reps/ROM/walk/pain/fatigue): daily_care_entries → Care→Therapy',
    '- Exercise assignments: rehab_exercise_assignments → Care→Therapy',
    '- Rehab metric targets: care_plan_rehab_metrics → plan goals',
    '- Rehab progress eval (UC3): uc3_trajectory_results → Care→Therapy / Home',
    '- Care focus priorities (UC4): uc4 priority tables → Care focus / Home',
    '- Care considerations: patient_care_context_items → Care context',
    '- Goals/activities: care_plan_goals + care_plans → Care',
    '- Living plan + Your Review: ADCP repos → Care→Your Review',
    '- Meds: medications → Meds tab',
    '- Thresholds / Health Monitor: thresholds → Care monitoring',
    '- HealthKit/wearable samples: health_samples (+ Apple Health bridge) → Home vitals / Health Monitor (not bulk-loaded into chat)',
    '- Alerts/timeline: alerts + patient_timeline_events → Home / Schedule',
    '- Literature packs: knowledge_cache (RAG only; not personal logs)',
    'Tabs: Home · Care · Meds · Schedule · Concierge',
  ];

  let text = lines.join('\n');
  if (text.length > MAX_CHARS) {
    text = `${text.slice(0, MAX_CHARS)}\n…`;
  }
  return text;
}
