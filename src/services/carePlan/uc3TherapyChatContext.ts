/**
 * Read-only UC3 / therapy context for in-card Concierge (rehab explain mini chat).
 *
 * Compact by design: base caregiver system + tools already consume most of
 * n_ctx (4096). This block must stay small so generation is not capped to ~128.
 */

import type { PatientRecordSnapshot } from '@/data/types';
import { getAssignedDevelopmentRehabExercises } from '@/data/uc3RehabExercises';

/** Hard cap — leave room for persona + seed + answer inside n_ctx=4096. */
const MAX_CONTEXT_CHARS = 1400;

function formatMedLine(m: {
  name: string;
  dosage?: string;
  frequency?: string;
  route?: string;
}): string {
  const bits = [m.name.trim()];
  if (m.dosage?.trim()) bits.push(m.dosage.trim());
  if (m.frequency?.trim()) bits.push(m.frequency.trim());
  if (m.route?.trim()) bits.push(m.route.trim());
  return bits.join(' · ');
}

function exerciseLabel(key: string, labelByKey: Map<string, string>): string {
  return labelByKey.get(key) ?? key.replace(/_/g, ' ');
}

/**
 * Compact therapy + medication block for the UC3 in-card system prompt.
 * Prefer this over plan-RAG + seed duplication (those blew past n_ctx).
 */
export function buildUc3TherapySystemContext(
  snapshot: PatientRecordSnapshot | null | undefined,
): string {
  if (!snapshot) {
    return [
      'UC3 THERAPY (record)',
      'No patient loaded — do not invent exercises or medications.',
    ].join('\n');
  }

  const assigned = getAssignedDevelopmentRehabExercises(
    snapshot.rehabExerciseAssignments ?? [],
  );
  const labelByKey = new Map(assigned.map((e) => [e.key, e.label]));

  const lines: string[] = [
    'UC3 THERAPY (record — use only this for exercises/meds/rehab)',
    'Do not invent exercises, targets, or meds. Do not change the plan or prescribe.',
  ];

  if (assigned.length === 0) {
    lines.push('Exercises: none assigned');
  } else {
    lines.push(
      `Exercises: ${assigned.map((e) => e.label).join('; ')}`,
    );
  }

  const today = snapshot.todayDailyCareEntry;
  if (today) {
    const parts: string[] = [
      `done=${today.therapyCompleted ? 'yes' : 'no'}`,
    ];
    if (today.setsCompleted != null || today.recommendedSets != null) {
      parts.push(`sets ${today.setsCompleted ?? 0}/${today.recommendedSets ?? '—'}`);
    }
    if (today.exerciseRepetitions != null) parts.push(`reps ${today.exerciseRepetitions}`);
    if (today.romDegrees != null) parts.push(`ROM ${today.romDegrees}°`);
    if (today.walkingMinutes != null) parts.push(`walk ${today.walkingMinutes}m`);
    if (today.painScore != null) parts.push(`pain ${today.painScore}`);
    if (today.fatigue != null) parts.push(`fatigue ${today.fatigue}`);
    const done = (today.completedExerciseKeys ?? [])
      .map((k) => exerciseLabel(k, labelByKey))
      .join(', ');
    if (done) parts.push(`completed: ${done}`);
    lines.push(`Today: ${parts.join(' · ')}`);
  } else {
    lines.push('Today: no log yet');
  }

  const metrics = (snapshot.rehabPlanMetrics ?? []).slice(0, 6);
  if (metrics.length > 0) {
    lines.push(
      `Metrics: ${metrics
        .map(
          (m) =>
            `${m.displayName} ${m.baselineValue ?? '—'}→${m.targetValue ?? '—'} ${m.unit}`,
        )
        .join('; ')}`,
    );
  }

  const activities = (snapshot.carePlan?.activities ?? [])
    .slice(0, 4)
    .map((a) => a.description?.trim())
    .filter((d): d is string => Boolean(d));
  if (activities.length > 0) {
    lines.push(`Activities: ${activities.join('; ')}`);
  }

  const goals = (snapshot.carePlanGoals ?? [])
    .slice(0, 4)
    .map((g) => g.description?.trim())
    .filter((d): d is string => Boolean(d));
  if (goals.length > 0) {
    lines.push(`Goals: ${goals.join('; ')}`);
  }

  const uc3 = snapshot.latestUc3TrajectoryResult;
  if (uc3) {
    const note = uc3.explanations?.[0]?.trim().slice(0, 120);
    lines.push(
      `UC3: ${uc3.eventType} sev=${uc3.severity}${note ? ` — ${note}` : ''}`,
    );
  } else {
    lines.push('UC3: not evaluated');
  }

  const activeMeds = (snapshot.medications ?? [])
    .filter((m) => m.active !== false)
    .slice(0, 12);
  if (activeMeds.length > 0) {
    lines.push(`Meds: ${activeMeds.map(formatMedLine).join('; ')}`);
  } else {
    const legacy = snapshot.patient?.currentMedications?.trim();
    lines.push(legacy ? `Meds: ${legacy.slice(0, 200)}` : 'Meds: none listed');
  }

  lines.push(
    'If asked which exercise matters most: choose only from Exercises, using Today/Metrics/UC3; say when data is missing.',
  );

  let text = lines.join('\n');
  if (text.length > MAX_CONTEXT_CHARS) {
    text = `${text.slice(0, MAX_CONTEXT_CHARS)}\n…`;
  }
  return text;
}

/**
 * Minimal seed add-on. Prefer system context for the full list; keep seed short
 * so multi-turn history does not explode n_ctx. Includes today's actual logged
 * therapy values so the first explain turn (and follow-ups) see what the
 * caregiver just entered on the therapy card.
 */
export function buildUc3TherapySeedSupplement(
  snapshot: PatientRecordSnapshot | null | undefined,
): string {
  if (!snapshot) return '';

  const assigned = getAssignedDevelopmentRehabExercises(
    snapshot.rehabExerciseAssignments ?? [],
  );
  const labelByKey = new Map(assigned.map((e) => [e.key, e.label]));
  const ex =
    assigned.length > 0
      ? assigned.map((e) => e.label).join('; ')
      : 'none assigned';

  const activeMeds = (snapshot.medications ?? [])
    .filter((m) => m.active !== false)
    .slice(0, 8);
  const meds =
    activeMeds.length > 0
      ? activeMeds.map((m) => m.name).join('; ')
      : snapshot.patient?.currentMedications?.trim()?.slice(0, 120) || 'none listed';

  const today = snapshot.todayDailyCareEntry;
  const todayBits: string[] = [];
  if (today) {
    todayBits.push(`done=${today.therapyCompleted ? 'yes' : 'no'}`);
    if (today.exerciseRepetitions != null) todayBits.push(`reps ${today.exerciseRepetitions}`);
    if (today.romDegrees != null) todayBits.push(`ROM ${today.romDegrees}°`);
    if (today.walkingMinutes != null) todayBits.push(`walk ${today.walkingMinutes}m`);
    if (today.painScore != null) todayBits.push(`pain ${today.painScore}/10`);
    if (today.fatigue != null) todayBits.push(`fatigue ${today.fatigue}/10`);
    const completed = (today.completedExerciseKeys ?? [])
      .map((k) => exerciseLabel(k, labelByKey))
      .join(', ');
    if (completed) todayBits.push(`completed: ${completed}`);
  }
  const todayLine = todayBits.length > 0 ? ` Today: ${todayBits.join(' · ')}.` : '';

  return `\nPlan snapshot — exercises: ${ex}. Meds: ${meds}.${todayLine}`;
}
