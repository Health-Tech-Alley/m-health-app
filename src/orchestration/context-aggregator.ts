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
  getAlertById,
  getAppSettings,
  getOpenAlerts,
  getRecentHealthSamples,
  getLatestRehabilitationMeasurements,
  getPatientLongitudinalObservations,
  getRecentMlEvents,
  type HealthSample,
} from '@/data';
import type {
  Alert,
  AppSettings,
  LatestUc4PriorityCardSummary,
  MlEvent,
  Patient,
  Uc4CaregiverResponseSummary,
} from '@/data/types';
import type { PatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';
import type { FusedRetriever, RetrievalResult, RetrievedChunk } from '@/knowledge';

export type CarePlanGoalSummary = {
  goalId: string;
  description: string;
  targetDate?: string;
  status: string;
};

export type ConciergeSlmReadiness = {
  loadStatus: 'idle' | 'loading' | 'ready' | 'error';
  currentModelId?: string | null;
  loadError?: string | null;
  nativeAvailable?: boolean;
};

export type ProviderReviewRequestContext = {
  responseId: string;
  patientId: string;
  cardId?: string | null;
  templateId?: string | null;
  requestedAt: string;
  caregiverResponseAction: string;
  observationCodes: string[];
  contextCodes: string[];
  shortText?: string | null;
  originatingCard?: {
    cardId: string;
    runId: string;
    title: string;
    status: string;
    generatedAt: string;
  };
  status: 'caregiver_requested';
};

export type ConciergeEvidenceMetadata = {
  docId: string;
  source: RetrievedChunk['source'];
  documentType?: RetrievedChunk['documentType'];
  lengthTier?: RetrievedChunk['lengthTier'];
  sectionHeading?: string;
};

export type BuildAggregatedContextOptions = {
  currentAlertId?: string;
  slmReadiness?: ConciergeSlmReadiness;
};

export type AggregatedContext = {
  patientRecordSnapshot: PatientRecordSnapshot;
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
  activeAlerts: Alert[];
  currentAlert?: Alert;
  recentMlEvents: MlEvent[];
  latestUc3Result: PatientRecordSnapshot['latestUc3TrajectoryResult'];
  activeUc4Cards: PatientRecordSnapshot['latestUc4PriorityCards'];
  recentUc4CaregiverResponses: PatientRecordSnapshot['recentUc4CaregiverResponses'];
  providerReviewRequests: ProviderReviewRequestContext[];
  appSettings: AppSettings;
  slmReadiness?: ConciergeSlmReadiness;
  retrieval: RetrievalResult;
  evidenceMetadata: ConciergeEvidenceMetadata[];
  /** Rehab / longitudinal measures (ST-02) — planning/32 §8.4 / P7. */
  progressMeasures?: {
    rehabilitation?: { type: string; value: number; unit: string; recordedAt: string }[];
    longitudinal?: { type: string; numericValue?: number | null; textValue?: string | null; recordedAt: string }[];
  };
  /** Caregiver action + decision history (D8 / §9). Populated when the
   *  orchestrator's priorDecisionsProvider is wired. */
  priorDecisions?: { verb: string; summary: string; at: string }[];
};

function freezeArray<T>(items: T[]): T[] {
  return Object.freeze([...items]) as T[];
}

function buildProviderReviewRequests(
  patientId: string,
  responses: Uc4CaregiverResponseSummary[],
  cards: LatestUc4PriorityCardSummary[],
): ProviderReviewRequestContext[] {
  const cardById = new Map(cards.map((card) => [card.cardId, card]));
  return responses
    .filter(
      (response) =>
        response.patientId === patientId &&
        response.caregiverRequestedProviderReview,
    )
    .map((response) => {
      const card =
        response.cardId && cardById.get(response.cardId)?.patientId === patientId
          ? cardById.get(response.cardId)
          : undefined;

      return {
        responseId: response.responseId,
        patientId: response.patientId,
        cardId: response.cardId ?? null,
        templateId: response.templateId ?? null,
        requestedAt: response.createdAt,
        caregiverResponseAction: response.action,
        observationCodes: freezeArray(response.observationCodes),
        contextCodes: freezeArray(response.contextCodes),
        shortText: response.shortText ?? null,
        originatingCard: card
          ? {
              cardId: card.cardId,
              runId: card.runId,
              title: card.title,
              status: card.status,
              generatedAt: card.generatedAt,
            }
          : undefined,
        status: 'caregiver_requested' as const,
      };
    });
}

function evidenceMetadataFromRetrieval(
  retrieval: RetrievalResult,
): ConciergeEvidenceMetadata[] {
  return retrieval.chunks.map((chunk) => ({
    docId: chunk.docId,
    source: chunk.source,
    documentType: chunk.documentType,
    lengthTier: chunk.lengthTier,
    sectionHeading: chunk.sectionHeading,
  }));
}

export async function buildAggregatedContext(
  patientId: string,
  intent: string,
  retriever: FusedRetriever,
  snapshot: PatientRecordSnapshot,
  options: BuildAggregatedContextOptions = {},
): Promise<AggregatedContext> {
  if (snapshot.patient?.patientId && snapshot.patient.patientId !== patientId) {
    throw new Error(
      `Patient snapshot ${snapshot.patient.patientId} does not match requested patient ${patientId}`,
    );
  }

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

  const activeAlerts = getOpenAlerts(patientId);
  const currentAlert = options.currentAlertId
    ? getAlertById(options.currentAlertId)
    : null;
  const patientScopedCurrentAlert =
    currentAlert?.patientId === patientId ? currentAlert : undefined;
  const recentMlEvents = getRecentMlEvents(patientId, 10);
  const activeUc4Cards = snapshot.latestUc4PriorityCards.filter(
    (card) => card.patientId === patientId,
  );
  const recentUc4CaregiverResponses = snapshot.recentUc4CaregiverResponses.filter(
    (response) => response.patientId === patientId,
  );
  const providerReviewRequests = buildProviderReviewRequests(
    patientId,
    recentUc4CaregiverResponses,
    activeUc4Cards,
  );

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

  const context: AggregatedContext = {
    patientRecordSnapshot: snapshot,
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
    symptoms: freezeArray(
      snapshot.symptoms.map((s) => ({ label: s.label, category: s.category })),
    ),
    recentVitals,
    activeThresholds: freezeArray(
      snapshot.thresholds.map((t) => ({
        thresholdId: t.thresholdId,
        vitalType: t.vitalType,
        value: t.value,
        direction: t.direction,
        severity: t.severity,
      })),
    ),
    carePlanGoals: freezeArray(snapshot.carePlanGoals),
    activeAlerts: freezeArray(activeAlerts),
    currentAlert: patientScopedCurrentAlert,
    recentMlEvents: freezeArray(recentMlEvents),
    latestUc3Result:
      snapshot.latestUc3TrajectoryResult?.patientId === patientId
        ? snapshot.latestUc3TrajectoryResult
        : null,
    activeUc4Cards: freezeArray(activeUc4Cards),
    recentUc4CaregiverResponses: freezeArray(recentUc4CaregiverResponses),
    providerReviewRequests: freezeArray(providerReviewRequests),
    appSettings: getAppSettings(),
    slmReadiness: options.slmReadiness,
    retrieval,
    evidenceMetadata: freezeArray(evidenceMetadataFromRetrieval(retrieval)),
    progressMeasures,
    priorDecisions: undefined,
  };

  return Object.seal(context);
}
