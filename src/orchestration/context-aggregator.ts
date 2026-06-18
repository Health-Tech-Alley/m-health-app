/**
 * Context Aggregator.
 *
 * Fuses patient state, recent events, geofence (deferred), and RAG retrieval
 * into a single context object passed to the SLM.
 *
 * Reads the denormalized patient record from PatientRecordStore (the single
 * source of truth) rather than re-querying individual repositories, so the
 * SLM and the UI always see the same point-in-time view.
 */

import {
  getRecentHealthSamples,
  type HealthSample,
} from '@/data';
import type { PatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';
import type { FusedRetriever, RetrievalResult } from '@/knowledge';

export type CarePlanGoalSummary = {
  goalId: string;
  description: string;
  targetDate?: string;
  status: string;
};

export type AggregatedContext = {
  patient: {
    patientId: string;
    name: string;
    age?: string;
    conditions: string[];
    comorbidities: string[];
    medications?: string;
    spo2Cutoff?: string;
    baselineHeartRate?: string;
    primaryCondition?: { name: string; icd10?: string; category?: string };
  };
  caregiver?: {
    name: string;
    relationship?: string;
    mainConcern?: string;
  };
  symptoms: { label: string; category: string }[];
  recentVitals: Record<string, { latest?: number; unit: string; samples: number }>;
  activeThresholds: {
    thresholdId: string;
    vitalType: string;
    value: number;
    direction: string;
    severity: number;
  }[];
  carePlanGoals: CarePlanGoalSummary[];
  retrieval: RetrievalResult;
};

export async function buildAggregatedContext(
  patientId: string,
  intent: string,
  retriever: FusedRetriever,
  snapshot: PatientRecordSnapshot,
): Promise<AggregatedContext> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const vitalsTypes: HealthSample['type'][] = [
    'spo2',
    'heart_rate',
    'respiratory_rate',
    'temperature',
  ];
  const recentVitals: AggregatedContext['recentVitals'] = {};
  for (const type of vitalsTypes) {
    const samples = getRecentHealthSamples(patientId, type, since, 100);
    if (samples.length > 0) {
      recentVitals[type] = {
        latest: samples[0].value,
        unit: samples[0].unit,
        samples: samples.length,
      };
    }
  }

  // Use structured conditions from the snapshot — exclude pending-review
  // suggestions so the SLM only sees confirmed conditions.
  const confirmedConditions = snapshot.conditions.filter((c) => !c.needsReview);
  const conditionNames = confirmedConditions.map((c) => c.name);
  const comorbidityNames = confirmedConditions
    .filter((c) => !c.isPrimary)
    .map((c) => c.name);
  const primaryCondition = confirmedConditions.find((c) => c.isPrimary) ?? confirmedConditions[0];

  const medsList = snapshot.patient?.currentMedications ?? '';
  const meds = medsList
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  const retrieval = await retriever.retrieve({
    intent,
    conditions: conditionNames,
    activeMeds: meds,
    kTools: 3,
    kChunks: 8,
  });

  return {
    patient: {
      patientId,
      name: snapshot.patient?.name ?? 'Unknown',
      age: snapshot.patient?.age,
      conditions: conditionNames,
      comorbidities: comorbidityNames,
      medications: snapshot.patient?.currentMedications,
      spo2Cutoff: snapshot.patient?.spo2Cutoff,
      baselineHeartRate: snapshot.patient?.baselineHeartRate,
      primaryCondition: primaryCondition
        ? { name: primaryCondition.name, icd10: primaryCondition.icd10, category: primaryCondition.category }
        : undefined,
    },
    caregiver: snapshot.caregiver
      ? {
          name: snapshot.caregiver.name,
          relationship: snapshot.caregiver.relationship,
          mainConcern: snapshot.caregiver.mainConcern,
        }
      : undefined,
    symptoms: snapshot.symptoms.map((s) => ({ label: s.label, category: s.category })),
    recentVitals,
    activeThresholds: snapshot.thresholds.map((t) => ({
      thresholdId: t.thresholdId,
      vitalType: t.vitalType,
      value: t.value,
      direction: t.direction,
      severity: t.severity,
    })),
    carePlanGoals: snapshot.carePlanGoals,
    retrieval,
  };
}
