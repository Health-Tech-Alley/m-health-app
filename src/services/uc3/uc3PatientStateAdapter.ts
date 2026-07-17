import type { CarePlanRehabMetric, DailyCareEntry, PatientCondition, PatientRecordSnapshot } from '../../data/types';
import { calculateRehabExerciseAssignmentCounts, mapConditionsToUc3ConditionGroup } from '../../data/uc3RehabExercises';
import { buildEhrRehabContextFromExtractedProfile, buildRehabPlan, type DailyRehabLog, type EHRRehabContext, type MetricTargetOverride, type PatientContext, type RehabMetricName, type RehabPlan } from '../../ml-models/uc3-rehab';

const METRIC_KEYS = new Set<RehabMetricName>(['romDegrees', 'exerciseReps', 'adherence', 'painScore', 'fatigueScore', 'walkingMinutes']);

export type UC3AdapterIssue = { code: string; message: string; path?: string };
export type UC3Input = { patient: PatientContext; ehrContext: EHRRehabContext; plan: RehabPlan; logs: DailyRehabLog[] };
export type UC3AdapterResult =
  | { status: 'ready'; input: UC3Input; warnings: UC3AdapterIssue[] }
  | { status: 'not_ready'; errors: UC3AdapterIssue[]; warnings: UC3AdapterIssue[] };

const issue = (code: string, message: string, path?: string): UC3AdapterIssue => ({ code, message, path });
const compact = (values: Array<string | null | undefined>): string[] =>
  values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function dateOnly(value?: string | null): string | null {
  if (!value) return null;
  const candidate = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate
    ? null
    : candidate;
}

function daysInclusive(start: string, end: string): number {
  return Math.floor(
    (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) /
      86400000,
  ) + 1;
}

function isMetricKey(value: string): value is RehabMetricName {
  return METRIC_KEYS.has(value as RehabMetricName);
}

function conditionLabel(condition: PatientCondition): string {
  return condition.snomedCode
    ? `${condition.name} (SNOMED ${condition.snomedCode})`
    : condition.name;
}

function buildMetricTargets(
  metrics: readonly CarePlanRehabMetric[],
  warnings: UC3AdapterIssue[],
): Partial<Record<RehabMetricName, MetricTargetOverride>> {
  const targets: Partial<Record<RehabMetricName, MetricTargetOverride>> = {};
  const seen = new Set<RehabMetricName>();

  for (const metric of metrics) {
    const key = metric.metricKey;
    if (
      !isMetricKey(key) ||
      !isNumber(metric.baselineValue) ||
      !isNumber(metric.targetValue) ||
      !Number.isFinite(metric.durationDays) ||
      metric.durationDays <= 0
    ) {
      continue;
    }
    if (seen.has(key)) {
      warnings.push(issue('duplicate_rehab_metric', `Duplicate metric ignored: ${key}.`));
      continue;
    }
    seen.add(key);
    targets[key] = {
      baselineValue: metric.baselineValue,
      targetValue: metric.targetValue,
      rationale: metric.displayName,
      source: 'care_plan_rehab_metrics',
    };
  }

  return targets;
}

function enteredBy(role?: string | null): DailyRehabLog['enteredBy'] | undefined {
  return role === 'patient' || role === 'caregiver' || role === 'clinician' || role === 'system'
    ? role
    : undefined;
}

function mapDailyLogs(
  entries: readonly DailyCareEntry[],
  planStart: string,
  planEnd: string | null,
  nowDate: string,
  warnings: UC3AdapterIssue[],
): DailyRehabLog[] {
  const seenDates = new Set<string>();
  const logs: Array<{ log: DailyRehabLog; index: number }> = [];

  entries.forEach((entry, index) => {
    const entryDate = dateOnly(entry.entryDate);
    if (!entryDate) {
      warnings.push(issue('invalid_daily_date', `Daily entry has invalid date: ${entry.entryDate}.`, `rehabDailyEntries.${index}`));
      return;
    }

    const log: DailyRehabLog = {
      dayIndex:
        isNumber(entry.therapyDay) && entry.therapyDay > 0
          ? entry.therapyDay
          : daysInclusive(planStart, entryDate),
      date: entryDate,
      romDegrees: isNumber(entry.romDegrees) ? entry.romDegrees : undefined,
      exerciseReps: isNumber(entry.exerciseRepetitions) ? entry.exerciseRepetitions : undefined,
      walkingMinutes: isNumber(entry.walkingMinutes) ? entry.walkingMinutes : undefined,
      fatigueScore: isNumber(entry.fatigue) ? entry.fatigue : undefined,
      painScore: isNumber(entry.painScore) ? entry.painScore : undefined,
      sessionCompleted: entry.therapyCompleted,
      skippedReason: entry.skippedReason ?? undefined,
      symptoms: entry.symptoms ? [...entry.symptoms] : undefined,
      notes: entry.notes ?? undefined,
      enteredBy: enteredBy(entry.loggedByRole),
      offlineCreatedAt: entry.createdAt,
      syncedAt: entry.updatedAt,
    };

    if (entry.assignedExerciseKeys) {
      const assignments = entry.assignedExerciseKeys.map((exerciseKey) => ({
        exerciseKey,
        active: true,
      }));
      Object.assign(
        log,
        calculateRehabExerciseAssignmentCounts(assignments, entry.completedExerciseKeys),
      );
    } else {
      warnings.push(issue('missing_daily_assigned_exercises', 'Daily entry has no stored assigned exercise keys.', `rehabDailyEntries.${index}`));
    }
    if (seenDates.has(entryDate)) warnings.push(issue('duplicate_daily_date', `Duplicate daily entry date: ${entryDate}.`, `rehabDailyEntries.${index}`));
    seenDates.add(entryDate);
    if (entryDate < planStart) warnings.push(issue('daily_date_before_plan', `Daily entry ${entryDate} is before the plan start.`, `rehabDailyEntries.${index}`));
    if (planEnd && entryDate > planEnd) warnings.push(issue('daily_date_after_plan', `Daily entry ${entryDate} is after the plan end.`, `rehabDailyEntries.${index}`));
    if (entryDate > nowDate) warnings.push(issue('future_daily_entry', `Daily entry ${entryDate} is in the future.`, `rehabDailyEntries.${index}`));
    if (log.romDegrees === undefined && log.exerciseReps === undefined && log.walkingMinutes === undefined && log.fatigueScore === undefined && log.painScore === undefined) {
      warnings.push(issue('missing_daily_metric_values', `Daily entry ${entryDate} has no optional rehab metric values.`, `rehabDailyEntries.${index}`));
    }
    logs.push({ log, index });
  });

  return logs
    .sort((a, b) => a.log.date!.localeCompare(b.log.date!) || a.log.dayIndex - b.log.dayIndex || a.index - b.index)
    .map(({ log }) => log);
}

export function adaptPatientRecordSnapshotToUC3Input(
  snapshot: PatientRecordSnapshot,
  now: Date = new Date(),
): UC3AdapterResult {
  const errors: UC3AdapterIssue[] = [];
  const warnings: UC3AdapterIssue[] = [];
  const patient = snapshot.patient;
  const carePlan = snapshot.carePlan;
  const planStart = dateOnly(carePlan?.periodStart ?? carePlan?.effectiveDate);
  const planEnd = dateOnly(carePlan?.periodEnd);
  const conditionGroup = mapConditionsToUc3ConditionGroup(snapshot.conditions);
  const metricTargets = buildMetricTargets(snapshot.rehabPlanMetrics, warnings);
  const usableMetrics = Object.keys(metricTargets) as RehabMetricName[];

  if (!patient?.patientId?.trim()) errors.push(issue('missing_patient_identity', 'Patient identity is required.', 'patient.patientId'));
  if (!carePlan || (carePlan.status && carePlan.status !== 'active')) errors.push(issue('no_active_rehab_care_plan', 'An active rehabilitation CarePlan is required.', 'carePlan'));
  if (!conditionGroup) errors.push(issue('unmappable_condition_group', 'Condition group could not be derived from supported SNOMED codes.', 'conditions'));
  if (!planStart || (planEnd && daysInclusive(planStart, planEnd) <= 0)) errors.push(issue('invalid_care_plan_dates', 'CarePlan start and end dates must form a valid range.', 'carePlan'));
  if (usableMetrics.length === 0) errors.push(issue('no_usable_rehab_metric_plan', 'At least one usable rehabilitation metric is required.', 'rehabPlanMetrics'));
  if (errors.length > 0) return { status: 'not_ready', errors, warnings };

  const readyPatient = patient!;
  const readyCarePlan = carePlan!;
  const readyPlanStart = planStart!;
  const readyConditionGroup = conditionGroup!;

  if (!readyPatient.location?.trim()) warnings.push(issue('missing_location_context', 'Patient location context is not available.', 'patient.location'));
  if (!snapshot.caregiver) warnings.push(issue('missing_caregiver_context', 'Caregiver context is not available.', 'caregiver'));
  if (!snapshot.wearable?.connected) warnings.push(issue('missing_connectivity_context', 'Connected wearable context is not available.', 'wearable'));
  const ageYears = readyPatient.age && Number.isFinite(Number(readyPatient.age)) ? Number(readyPatient.age) : 0;
  if (!readyPatient.age || !Number.isFinite(Number(readyPatient.age))) warnings.push(issue('invalid_or_missing_age', 'Patient age is not available as a valid number.', 'patient.age'));

  const patientContext: PatientContext = {
    patientId: readyPatient.patientId,
    displayName: readyPatient.preferredName?.trim() || readyPatient.name?.trim() || readyPatient.patientId,
    ageYears,
    condition: snapshot.primaryCondition?.name ?? snapshot.conditions[0]?.name ?? readyConditionGroup,
    caregiverName: snapshot.caregiver?.name?.trim() || 'Caregiver',
    setting: snapshot.caregiver ? 'home-assisted' : 'not_provided',
    locationContext: compact([
      readyPatient.location,
      snapshot.caregiver?.relationship && `caregiver relationship: ${snapshot.caregiver.relationship}`,
      snapshot.caregiver?.availability && `caregiver availability: ${snapshot.caregiver.availability}`,
      snapshot.caregiver?.medicalComfortLevel && `caregiver comfort: ${snapshot.caregiver.medicalComfortLevel}`,
      snapshot.wearable?.connected ? 'connected wearable available' : undefined,
    ]).join('; '),
  };
  const mobilityLimitations = compact([
    readyPatient.baselineDailyRoutine,
    ...snapshot.functionalObservations.map((item) => item.textValue ?? `${item.measurementType}: ${item.numericValue ?? ''}`),
    ...snapshot.careContextItems
      .filter((item) => /mobility|function|rehab|therapy/i.test(item.contextCategory))
      .map((item) => `${item.plainTitle}: ${item.factualSummary}`),
  ]);
  const relevantHistory = compact([
    ...snapshot.conditions.map(conditionLabel),
    ...snapshot.comorbidities.map(conditionLabel),
    ...snapshot.timelineEvents.map((event) => `${event.title}: ${event.summary}`),
    ...snapshot.careContextItems.map((item) => `${item.plainTitle}: ${item.factualSummary}`),
    snapshot.caregiver?.mainConcern && `caregiver concern: ${snapshot.caregiver.mainConcern}`,
  ]);
  const safetyConsiderations = compact([
    snapshot.safetyNotes,
    readyCarePlan.safetyNotes,
    snapshot.caregiver?.stressOrSupportNeeds,
  ]);
  const ehrContext = buildEhrRehabContextFromExtractedProfile({
    conditionGroup: readyConditionGroup,
    mobilityLimitations,
    relevantHistory,
    safetyConsiderations,
    sourceSummary: compact([readyCarePlan.title, readyCarePlan.description, `CarePlan ${readyCarePlan.planId}`]).join('; '),
  });
  const durationFromMetrics = Math.max(
    1,
    ...snapshot.rehabPlanMetrics
      .filter((metric) => usableMetrics.includes(metric.metricKey))
      .map((metric) => metric.durationDays),
  );
  const builtPlan = buildRehabPlan(patientContext, ehrContext, {
    durationDays: Math.max(durationFromMetrics, planEnd ? daysInclusive(readyPlanStart, planEnd) : 1),
    metricTargets,
    planSource: 'PatientRecordSnapshot',
    planNote: readyCarePlan.description ?? readyCarePlan.title,
  });
  const clinicianGoals = compact([
    ...snapshot.carePlanGoals.map((goal) => goal.description),
    ...readyCarePlan.activities.map((activity) => activity.description),
  ]);
  const plan: RehabPlan = {
    ...builtPlan,
    planId: readyCarePlan.planId,
    clinicianAuthoredGoals: clinicianGoals.length ? clinicianGoals : builtPlan.clinicianAuthoredGoals,
    safetyBoundaries: safetyConsiderations.length ? safetyConsiderations : builtPlan.safetyBoundaries,
  };
  const logs = mapDailyLogs(
    snapshot.rehabDailyEntries,
    readyPlanStart,
    planEnd,
    dateOnly(now.toISOString()) ?? now.toISOString().slice(0, 10),
    warnings,
  );

  return { status: 'ready', input: { patient: patientContext, ehrContext, plan, logs }, warnings };
}
