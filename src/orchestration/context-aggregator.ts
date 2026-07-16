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
  getLatestRehabilitationMeasurements,
  getPatientLongitudinalObservations,
  type HealthSample,
} from '@/data';
import type { Patient } from '@/data/types';
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
    /** Functional scales (CP / post-stroke / TBI) — planning/32 §8.4 / P7. */
    functionalScales?: { gmfcs?: string; fms?: string; macs?: string; cfcs?: string; edacs?: string };
    /** Free-text patient location for SDOH (CDC PLACES) — D5. */
    location?: string;
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
  /** Rehab / longitudinal measures (ST-02) — planning/32 §8.4 / P7. */
  progressMeasures?: {
    rehabilitation?: { type: string; value: number; unit: string; recordedAt: string }[];
    longitudinal?: { type: string; numericValue?: number | null; textValue?: string | null; recordedAt: string }[];
  };
  /** Caregiver action + decision history (D8 / §9). Populated when the
   *  orchestrator's priorDecisionsProvider is wired. */
  priorDecisions?: { verb: string; summary: string; at: string }[];
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
  const hasCuratedConditionRoles = confirmedConditions.some((condition) =>
    Boolean(condition.conditionRole),
  );
  const primaryCondition =
    confirmedConditions.find((c) => c.conditionRole === 'primary_diagnosis') ??
    snapshot.primaryCondition ??
    confirmedConditions.find((c) => c.isPrimary) ??
    confirmedConditions[0];
  const activeComorbidities = hasCuratedConditionRoles
    ? confirmedConditions.filter((c) => c.conditionRole === 'active_comorbidity')
    : confirmedConditions.filter((c) => c !== primaryCondition);
  const selectedConditions = hasCuratedConditionRoles
    ? [primaryCondition, ...activeComorbidities].filter(
        (condition): condition is NonNullable<typeof primaryCondition> => Boolean(condition),
      )
    : confirmedConditions;
  const conditionNames = selectedConditions.map((c) => c.name);
  const comorbidityNames = activeComorbidities.map((c) => c.name);

  const meds = snapshot.medications
    .map((m) => m.name.trim())
    .filter(Boolean);
  const medicationSummary = meds.join(', ');

  const retrieval = await retriever.retrieve({
    intent,
    conditions: conditionNames,
    activeMeds: meds,
    kTools: 3,
    kChunks: 8,
  });

  // P7: progress measures (latest-per-type rehab + last 5 longitudinal).
  let progressMeasures: AggregatedContext['progressMeasures'];
  try {
    const rehab = getLatestRehabilitationMeasurements(patientId);
    const long = getPatientLongitudinalObservations(patientId);
    if (rehab.length > 0 || long.length > 0) {
      progressMeasures = {
        rehabilitation: rehab.map((r) => ({
          type: r.type,
          value: r.value,
          unit: r.unit,
          recordedAt: r.recordedAt,
        })),
        longitudinal: long
          .slice(-5)
          .map((o) => ({
            type: o.measurementType,
            numericValue: o.numericValue,
            textValue: o.textValue,
            recordedAt: o.recordedAt,
          })),
      };
    }
  } catch {
    // progressMeasures is optional; no-op on error
  }

  return {
    patient: {
      patientId,
      name: snapshot.patient?.name ?? 'Unknown',
      age: snapshot.patient?.age,
      conditions: conditionNames,
      comorbidities: comorbidityNames,
      medications: medicationSummary,
      spo2Cutoff: snapshot.patient?.spo2Cutoff,
      baselineHeartRate: snapshot.patient?.baselineHeartRate,
      primaryCondition: primaryCondition
        ? { name: primaryCondition.name, icd10: primaryCondition.icd10, category: primaryCondition.category }
        : undefined,
      functionalScales: snapshot.patient
        ? {
            gmfcs: snapshot.patient.gmfcs,
            fms: snapshot.patient.fms,
            macs: snapshot.patient.macs,
            cfcs: snapshot.patient.cfcs,
            edacs: snapshot.patient.edacs,
          }
        : undefined,
      location: (snapshot.patient as Patient & { location?: string }).location,
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
    progressMeasures,
  };
}
