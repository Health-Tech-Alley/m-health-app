import type { PatientRecordSnapshot, LatestUc4CardSummary } from '@/data/repositories/patientRecordRepository';
import type {
  UC4RunInput,
  UC4PatientProfile,
  UC4MedicationProfile,
  UC4StructuredEvent,
  UC4WearableSummary,
  PreviousUC4Priority,
  UC4SeverityContext,
  UC4PriorityCard,
  MedicationWatchCode,
} from './uc4Types';
import { mapMedicationNameToWatchAreas } from './uc4MedicationWatchMapping';

function buildUC4PatientProfile(snapshot: PatientRecordSnapshot): UC4PatientProfile {
  const patient = snapshot.patient;
  const primary = snapshot.primaryCondition;
  return {
    patientId: patient?.patientId ?? 'unknown',
    displayName: patient?.preferredName ?? patient?.name ?? 'Patient',
    synthetic: true,
    primaryContextLabel: primary?.name ?? 'general',
    carePlanFocusCodes: snapshot.carePlans.flatMap((plan) =>
      plan.activities?.map((a) => a.description ?? '').filter(Boolean) ?? [],
    ),
    caregiverRelationship: snapshot.caregiver?.relationship ?? undefined,
  };
}

function buildUC4MedicationProfiles(snapshot: PatientRecordSnapshot): UC4MedicationProfile[] {
  return snapshot.medications.map((med) => {
    const medicationName = med.name ?? 'Unknown medication';
    return {
      patientId: snapshot.patient?.patientId ?? 'unknown',
      medicationName,
      synthetic: true,
      watchAreas: mapMedicationNameToWatchAreas(medicationName) as MedicationWatchCode[],
      scheduleText: med.dosage ?? med.frequency ?? undefined,
    };
  });
}

function buildUC4WearableSummary(snapshot: PatientRecordSnapshot): UC4WearableSummary | undefined {
  if (!snapshot.wearable) return undefined;
  return {
    patientId: snapshot.patient?.patientId ?? 'unknown',
    windowDays: 7,
    lowMovementIncrease: false,
    respiratoryRateDeltaFlag: false,
    sleepDisruptionFlag: false,
    activityDropFlag: false,
    source: 'wearable_summary',
  };
}

export function buildUc4RunInput(params: {
  snapshot: PatientRecordSnapshot;
  recentEvents: UC4StructuredEvent[];
  previousPriorities: PreviousUC4Priority[];
  uc1ActiveEmergency: boolean;
  currentSeverityContext: UC4SeverityContext;
  nowIso: string;
  runId: string;
}): UC4RunInput {
  const { snapshot, recentEvents, previousPriorities, uc1ActiveEmergency, currentSeverityContext, nowIso } = params;

  return {
    patient: buildUC4PatientProfile(snapshot),
    medications: buildUC4MedicationProfiles(snapshot),
    recentEvents,
    wearableSummary: buildUC4WearableSummary(snapshot),
    previousPriorities,
    uc1ActiveEmergency,
    currentSeverityContext,
    nowIso,
  };
}

export function toLatestUc4CardSummary(card: UC4PriorityCard, cardId: string): LatestUc4CardSummary {
  return {
    cardId,
    templateId: card.templateId,
    title: card.title,
    summary: card.body,
    score: card.score,
    status: 'active',
    createdAt: card.generatedAtIso,
  };
}
