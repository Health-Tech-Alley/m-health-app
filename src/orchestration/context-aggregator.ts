/**
 * Context Aggregator.
 *
 * Fuses patient state, recent events, geofence (deferred), and RAG retrieval
 * into a single context object passed to the SLM.
 */

import {
  getActiveThresholds,
  getCaregiverForPatient,
  getConditionsForPatient,
  getDatabase,
  getPatient,
  getRecentHealthSamples,
  type HealthSample,
} from '@/data';
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
    medications?: string;
    spo2Cutoff?: string;
    baselineHeartRate?: string;
  };
  caregiver?: {
    name: string;
    relationship?: string;
    mainConcern?: string;
  };
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

function getCarePlanGoals(patientId: string): CarePlanGoalSummary[] {
  try {
    const db = getDatabase();
    return db.getAllSync<CarePlanGoalSummary>(
      `SELECT g.goal_id AS goalId, g.description, g.target_date AS targetDate, g.status
       FROM care_plan_goals g
       JOIN care_plans p ON g.plan_id = p.plan_id
       WHERE p.patient_id = ? AND g.status = 'active'
       ORDER BY g.target_date;`,
      patientId,
    );
  } catch {
    return [];
  }
}

export async function buildAggregatedContext(
  patientId: string,
  intent: string,
  retriever: FusedRetriever,
): Promise<AggregatedContext> {
  const patient = getPatient(patientId);
  const caregiver = getCaregiverForPatient(patientId);
  const conditions = getConditionsForPatient(patientId);
  const thresholds = getActiveThresholds(patientId);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const vitalsTypes: HealthSample['type'][] = ['spo2', 'heart_rate', 'respiratory_rate', 'temperature'];
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

  const medsList = patient?.currentMedications ?? '';
  const meds = medsList.split(',').map((m) => m.trim()).filter(Boolean);
  const conditionNames = conditions.map((c) => c.name);

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
      name: patient?.name ?? 'Unknown',
      age: patient?.age,
      conditions: conditionNames,
      medications: patient?.currentMedications,
      spo2Cutoff: patient?.spo2Cutoff,
      baselineHeartRate: patient?.baselineHeartRate,
    },
    caregiver: caregiver
      ? {
          name: caregiver.name,
          relationship: caregiver.relationship,
          mainConcern: caregiver.mainConcern,
        }
      : undefined,
    recentVitals,
    activeThresholds: thresholds,
    carePlanGoals: getCarePlanGoals(patientId),
    retrieval,
  };
}
