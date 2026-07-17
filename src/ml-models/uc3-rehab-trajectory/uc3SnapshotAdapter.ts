import type { PatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';
import type { DailyCareEntry, CarePlanRehabMetric } from '@/data';
import type {
  DailyRehabLog,
  EHRRehabContext,
  RehabPlan,
  PatientContext,
  MetricTargetOverride,
} from './types';
import { buildRehabPlan, buildEhrRehabContextFromExtractedProfile } from './plan';

export interface Uc3EngineInputs {
  plan: RehabPlan;
  logs: DailyRehabLog[];
  ehrContext: EHRRehabContext;
  inputWindow: { start: string; end: string };
}

function toDailyRehabLog(entry: DailyCareEntry, index: number, planStartDate?: string | null): DailyRehabLog {
  const therapyDay = entry.therapyDay ?? (index + 1);
  const date = entry.entryDate ?? (planStartDate ? calculateDate(planStartDate, index) : undefined);

  return {
    dayIndex: therapyDay,
    date,
    romDegrees: entry.romDegrees ?? undefined,
    exerciseReps: entry.exerciseRepetitions ?? undefined,
    adherence: undefined,
    painScore: entry.painAfter ?? entry.painBefore ?? undefined,
    fatigueScore: entry.fatigue ?? undefined,
    walkingMinutes: entry.walkingMinutes ?? undefined,
    exercisesAssigned: entry.recommendedSets ?? undefined,
    exercisesCompleted: entry.setsCompleted ?? undefined,
    sessionCompleted: entry.therapyCompleted ?? undefined,
    skippedReason: entry.notes ?? undefined,
    symptoms: entry.symptoms ? (Array.isArray(entry.symptoms) ? entry.symptoms : []) : undefined,
    notes: entry.notes ?? undefined,
  };
}

function calculateDate(startDate: string, dayOffset: number): string {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString().slice(0, 10);
}

function buildPatientContextFromSnapshot(snapshot: PatientRecordSnapshot): PatientContext {
  const patient = snapshot.patient;
  const caregiver = snapshot.caregiver;
  const primary = snapshot.primaryCondition;

  return {
    patientId: patient?.patientId ?? 'unknown',
    displayName: patient?.preferredName ?? patient?.name ?? 'Patient',
    ageYears: patient?.age ? parseInt(patient.age, 10) || 0 : 0,
    condition: primary?.name ?? 'Rehabilitation',
    setting: 'Home-assisted',
    caregiverName: caregiver?.name ?? 'Caregiver',
    locationContext: 'Home',
  };
}

function buildEhrContextFromSnapshot(snapshot: PatientRecordSnapshot): EHRRehabContext {
  const primary = snapshot.primaryCondition;
  const conditionGroup = primary?.name?.toLowerCase().replace(/\s+/g, '_') ?? 'rehabilitation';
  const mobilityLimitations: string[] = [];
  const safetyConsiderations: string[] = [];

  if (snapshot.safetyNotes) {
    safetyConsiderations.push(snapshot.safetyNotes);
  }

  for (const obs of snapshot.functionalObservations) {
    const text = obs.textValue ?? '';
    if (text) {
      mobilityLimitations.push(text);
    }
  }

  const relevantHistory = snapshot.timelineEvents.map((e) => e.summary).filter(Boolean);

  return buildEhrRehabContextFromExtractedProfile({
    conditionGroup,
    mobilityLimitations,
    relevantHistory,
    safetyConsiderations,
    sourceSummary: 'Generated from patient record snapshot for UC3 trajectory evaluation.',
  });
}

function mapSnapshotRehabMetrics(snapshot: PatientRecordSnapshot): Record<string, MetricTargetOverride> {
  const result: Record<string, MetricTargetOverride> = {};

  for (const metric of snapshot.rehabPlanMetrics) {
    if (metric.baselineValue != null && metric.targetValue != null) {
      result[metric.metricKey] = {
        baselineValue: metric.baselineValue,
        targetValue: metric.targetValue,
      };
    }
  }

  return result;
}

function inferDurationDays(plan: PatientRecordSnapshot['carePlan'], rehabMetrics: CarePlanRehabMetric[]): number {
  for (const metric of rehabMetrics) {
    if (metric.durationDays && metric.durationDays > 0) {
      return metric.durationDays;
    }
  }
  return 28;
}

export function buildUc3InputsFromSnapshot(
  snapshot: PatientRecordSnapshot,
): Uc3EngineInputs {
  const patientContext = buildPatientContextFromSnapshot(snapshot);
  const ehrContext = buildEhrContextFromSnapshot(snapshot);

  const carePlan = snapshot.carePlan;
  const rehabMetrics = snapshot.rehabPlanMetrics;
  const entries = snapshot.rehabDailyEntries;

  const durationDays = inferDurationDays(carePlan, rehabMetrics);
  const planStartDate = carePlan?.periodStart ?? carePlan?.effectiveDate;

  const metricOverrides = mapSnapshotRehabMetrics(snapshot);
  const plan = buildRehabPlan(patientContext, ehrContext, {
    durationDays,
    metricTargets: Object.keys(metricOverrides).length > 0 ? metricOverrides : undefined,
  });

  const logs: DailyRehabLog[] = entries.map((entry, index) =>
    toDailyRehabLog(entry, index, planStartDate),
  );

  const sortedLogs = logs.sort((a, b) => a.dayIndex - b.dayIndex);

  const windowStart = sortedLogs[0]?.date ?? planStartDate ?? new Date().toISOString().slice(0, 10);
  const windowEnd = sortedLogs[sortedLogs.length - 1]?.date ?? new Date().toISOString().slice(0, 10);

  return {
    plan,
    logs: sortedLogs,
    ehrContext,
    inputWindow: { start: windowStart, end: windowEnd },
  };
}
