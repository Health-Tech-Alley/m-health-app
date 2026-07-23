import type {
  Alert,
  DailyCareEntry,
  PatientRecordSnapshot,
  Uc4CaregiverResponseSummary,
} from '../../data/types';
import { mapMedicationNameToWatchAreas } from '../../ml-models/uc4-micro-priorities/uc4MedicationWatchMapping';
import {
  categorizeCareText,
  uc4FocusCodeForCategory,
} from '../carePlan/careCategories';
import type {
  ContextCode,
  ObservationCode,
  PreviousUC4Priority,
  UC4RunInput,
  UC4SeverityContext,
  UC4StructuredEvent,
  UC4WearableSummary,
} from '../../ml-models/uc4-micro-priorities';

export type UC4AdapterIssue = { code: string; message: string; path?: string };

export type UC4AppStateBundle = {
  snapshot: PatientRecordSnapshot;
  activeAlerts: Pick<Alert, 'alertId' | 'severity' | 'createdAt' | 'title'>[];
  previousPriorities: PreviousUC4Priority[];
  nowIso: string;
  wearableSummary?: UC4WearableSummary;
};

export type UC4AdapterResult =
  | { status: 'ready'; input: UC4RunInput; warnings: UC4AdapterIssue[] }
  | { status: 'not_ready'; errors: UC4AdapterIssue[]; warnings: UC4AdapterIssue[] };

const issue = (code: string, message: string, path?: string): UC4AdapterIssue => ({
  code,
  message,
  path,
});

function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value !== null && value !== undefined);
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function dateTimestamp(value?: string | null): string | null {
  if (!value) return null;
  const dateOnly = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  return `${dateOnly}T12:00:00.000Z`;
}

function eventId(prefix: string, patientId: string, timestampIso: string, index: number): string {
  return `${prefix}:${patientId}:${timestampIso}:${index}`;
}

function currentSeverityContext(
  alerts: UC4AppStateBundle['activeAlerts'],
): { uc1ActiveEmergency: boolean; currentSeverityContext: UC4SeverityContext } {
  if (alerts.some((alert) => alert.severity === 3)) {
    return {
      uc1ActiveEmergency: true,
      currentSeverityContext: 'uc1_or_uc2_severity_3_emergency',
    };
  }
  if (alerts.some((alert) => alert.severity === 2)) {
    return {
      uc1ActiveEmergency: false,
      currentSeverityContext: 'uc2_severity_2_provider_review',
    };
  }
  if (alerts.some((alert) => alert.severity === 1)) {
    return {
      uc1ActiveEmergency: false,
      currentSeverityContext: 'uc2_severity_1_monitor',
    };
  }
  return { uc1ActiveEmergency: false, currentSeverityContext: 'routine' };
}

function mapCarePlanFocusCodes(snapshot: PatientRecordSnapshot): string[] {
  const codes: string[] = [];
  const addFromText = (text: string | null | undefined) => {
    const focusCode = uc4FocusCodeForCategory(categorizeCareText(text));
    if (focusCode) codes.push(focusCode);
  };

  if (snapshot.rehabPlanMetrics.length > 0 || snapshot.rehabExerciseAssignments.length > 0) {
    codes.push('REHAB_THERAPY');
  }
  for (const condition of snapshot.conditions) addFromText(condition.name);
  for (const symptom of snapshot.symptoms) addFromText(symptom.label);
  for (const goal of snapshot.carePlanGoals) addFromText(goal.description);
  for (const activity of snapshot.carePlan?.activities ?? []) {
    addFromText(activity.description);
  }
  return unique(codes).sort();
}

function mapSkippedReason(reason?: string | null): ObservationCode[] {
  switch (reason) {
    case 'fall':
    case 'injury':
      return ['FALL_OR_NEAR_FALL'];
    case 'shortness of breath':
      return ['BREATHING_CONCERN'];
    case 'severe pain':
    case 'chest pain':
      return ['PAIN_OR_DISCOMFORT'];
    case 'vomiting':
      return ['APPETITE_OR_HYDRATION_CHANGE'];
    case 'clinician told us to stop':
    case 'doctor told us to stop':
    case 'nurse told us to stop':
    case 'urgent':
    case 'emergency':
      return ['THERAPY_ROUTINE_DIFFICULTY'];
    default:
      return [];
  }
}

function mapUrgentSymptom(symptom: string): ObservationCode | null {
  switch (symptom) {
    case 'shortness_of_breath':
      return 'BREATHING_CONCERN';
    case 'severe_sudden_pain':
    case 'severe_pain':
    case 'chest_pain':
      return 'PAIN_OR_DISCOMFORT';
    case 'fall_with_injury':
      return 'FALL_OR_NEAR_FALL';
    case 'confusion':
    case 'loss_of_consciousness':
    case 'new_weakness':
      return 'UNUSUAL_RESPONSIVENESS';
    default:
      return null;
  }
}

function dailyCareObservationCodes(entry: DailyCareEntry): ObservationCode[] {
  const codes: ObservationCode[] = [];
  codes.push(...mapSkippedReason(entry.skippedReason));
  if (entry.therapyCompleted === false || entry.skippedReason) {
    codes.push('THERAPY_ROUTINE_DIFFICULTY');
  }
  if (
    entry.assignedExerciseKeys &&
    entry.assignedExerciseKeys.length > 0 &&
    (entry.completedExerciseKeys?.length ?? 0) < entry.assignedExerciseKeys.length
  ) {
    codes.push('THERAPY_ROUTINE_DIFFICULTY');
  }
  if (typeof entry.painScore === 'number' && Number.isFinite(entry.painScore) && entry.painScore > 0) {
    codes.push('PAIN_OR_DISCOMFORT');
  }
  if (typeof entry.fatigue === 'number' && Number.isFinite(entry.fatigue) && entry.fatigue > 0) {
    codes.push('UNUSUAL_FATIGUE');
  }
  for (const symptom of entry.symptoms ?? []) {
    const mapped = mapUrgentSymptom(symptom);
    if (mapped) codes.push(mapped);
  }
  return unique(codes).sort();
}

function dailyCareContextCodes(entry: DailyCareEntry): ContextCode[] {
  const codes: ContextCode[] = [];
  if (entry.therapyCompleted === false || entry.skippedReason) {
    codes.push('AFTER_ACTIVITY_OR_THERAPY');
  }
  return unique(codes).sort();
}

function dailyCareEvents(snapshot: PatientRecordSnapshot): UC4StructuredEvent[] {
  const patientId = snapshot.patient?.patientId ?? '';
  return snapshot.rehabDailyEntries
    .map((entry, index): UC4StructuredEvent | null => {
      const timestampIso = dateTimestamp(entry.entryDate);
      if (!timestampIso) return null;
      const observationCodes = dailyCareObservationCodes(entry);
      const contextCodes = dailyCareContextCodes(entry);
      if (observationCodes.length === 0 && contextCodes.length === 0) return null;
      return {
        eventId: eventId('uc4-daily', patientId, timestampIso, index),
        patientId,
        timestampIso,
        source: 'caregiver_checkin',
        observationCodes,
        contextCodes,
        freeTextUsedForScoring: false,
        freeTextProviderContext: entry.skippedReason ?? undefined,
        metadata: {
          entryId: entry.entryId,
          therapyCompleted: entry.therapyCompleted,
          skippedReason: entry.skippedReason,
        },
      };
    })
    .filter((event): event is UC4StructuredEvent => event !== null);
}

function responseEvents(
  responses: Uc4CaregiverResponseSummary[],
): UC4StructuredEvent[] {
  return responses.map((response) => ({
    eventId: response.responseId,
    patientId: response.patientId,
    timestampIso: response.createdAt,
    source: 'uc4_response',
    observationCodes: response.observationCodes as ObservationCode[],
    contextCodes: response.contextCodes as ContextCode[],
    freeTextUsedForScoring: false,
    freeTextProviderContext: response.shortText ?? undefined,
    metadata: {
      cardId: response.cardId,
      templateId: response.templateId,
      action: response.action,
      caregiverRequestedProviderReview: response.caregiverRequestedProviderReview,
    },
  }));
}

export function adaptPatientRecordSnapshotToUC4Input(
  bundle: UC4AppStateBundle,
): UC4AdapterResult {
  const errors: UC4AdapterIssue[] = [];
  const warnings: UC4AdapterIssue[] = [];
  const { snapshot } = bundle;
  const patient = snapshot.patient;

  if (!patient?.patientId?.trim()) {
    errors.push(issue('missing_patient_identity', 'Patient identity is required.', 'snapshot.patient.patientId'));
  }
  if (errors.length > 0) return { status: 'not_ready', errors, warnings };

  if (snapshot.wearable?.connected && !bundle.wearableSummary) {
    warnings.push(issue(
      'wearable_summary_omitted',
      'Connected wearable exists, but no structured UC4 wearable flags were provided.',
      'bundle.wearableSummary',
    ));
  }

  const patientId = patient!.patientId;
  const severity = currentSeverityContext(bundle.activeAlerts);
  const recentEvents = [...dailyCareEvents(snapshot), ...responseEvents(snapshot.recentUc4CaregiverResponses)]
    .sort((a, b) => b.timestampIso.localeCompare(a.timestampIso) || a.eventId.localeCompare(b.eventId));

  return {
    status: 'ready',
    warnings,
    input: {
      patient: {
        patientId,
        displayName: patient!.preferredName?.trim() || patient!.name?.trim() || patientId,
        synthetic: false,
        primaryContextLabel: snapshot.primaryCondition?.name ?? snapshot.conditions[0]?.name,
        carePlanFocusCodes: mapCarePlanFocusCodes(snapshot),
        caregiverRelationship: snapshot.caregiver?.relationship ?? undefined,
      },
      medications: snapshot.medications
        .filter((medication) => medication.active)
        .map((medication) => ({
          patientId,
          medicationName: medication.name,
          synthetic: false,
          watchAreas: mapMedicationNameToWatchAreas(medication.name),
          scheduleText: compact([medication.dosage, medication.frequency]).join(' ') || undefined,
        })),
      recentEvents,
      wearableSummary: bundle.wearableSummary,
      previousPriorities: bundle.previousPriorities,
      ...severity,
      nowIso: bundle.nowIso,
    },
  };
}
