/**
 * Patient NLU context builder.
 *
 * Converts a PatientRecordSnapshot into a lightweight dictionary for entity
 * linking and intent classification. Patient-specific entities come only from
 * the active persisted snapshot; generic terms are non-persona clinical terms.
 */

import type { PatientNluContext } from './types';
import type { PatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';
import { getAssignedDevelopmentRehabExercises } from '@/data/uc3RehabExercises';
import { APP_SURFACE_LABELS } from './app-surfaces';

const VITAL_LEXICON = [
  'SpO2',
  'heart rate',
  'blood pressure',
  'respiratory rate',
  'temperature',
  'glucose',
  'blood sugar',
  'oxygen saturation',
  'systolic',
  'diastolic',
  'bpm',
  'o2 sat',
];

const GENERIC_CLINICAL_KEYWORDS = [
  'autonomic dysreflexia',
  'suction',
  'exacerbation',
  'GMFCS',
  'seizure',
  'spasticity',
  'constipation',
  'GERD',
  'aspiration',
  'pressure injury',
  'skin breakdown',
  'latex allergy',
  'shunt malfunction',
  'catheter',
  'bowel',
  'bladder',
  'therapy progress',
  'rehab plateau',
  'care focus',
  'priorities',
  'watch areas',
  'monitoring thresholds',
  'care plan',
  'handoff',
];

export function buildPatientNluContext(
  snapshot: PatientRecordSnapshot | null,
): PatientNluContext {
  if (!snapshot) {
    return {
      patientId: '',
      patientName: '',
      conditions: [],
      comorbidities: [],
      medications: [],
      symptoms: [],
      knowledgeKeywords: GENERIC_CLINICAL_KEYWORDS,
      vitalTypes: VITAL_LEXICON,
      appSurfaces: APP_SURFACE_LABELS,
    };
  }

  const confirmedConditions = snapshot.conditions.filter((c) => !c.needsReview);
  const conditionNames = confirmedConditions.map((c) => c.name);
  const comorbidityNames = confirmedConditions
    .filter((c) => !c.isPrimary)
    .map((c) => c.name);

  const medsList = snapshot.patient?.currentMedications ?? '';
  const medications = medsList
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  const symptoms = snapshot.symptoms.map((s) => s.label);

  // Therapy ground truth is NOT in the vector/knowledge graph. Surface labels
  // and assigned exercise names here so intent/entity linking can route
  // rehab questions; numeric daily logs are injected separately into SLM
  // system context via uc3TherapyChatContext.
  const assignedExercises = getAssignedDevelopmentRehabExercises(
    snapshot.rehabExerciseAssignments ?? [],
  );
  const therapyKeywords: string[] = [];
  if (
    snapshot.therapyContractPresent ||
    assignedExercises.length > 0 ||
    (snapshot.rehabDailyEntries ?? []).length > 0 ||
    snapshot.todayDailyCareEntry ||
    snapshot.latestUc3TrajectoryResult
  ) {
    therapyKeywords.push(
      'daily rehab log',
      'therapy session',
      'exercise repetitions',
      'range of motion',
      'walking minutes',
      'pain score',
      'fatigue score',
      'rehab exercises',
      ...assignedExercises.map((e) => e.label),
    );
  }

  const knowledgeKeywords = [
    ...new Set([
      ...conditionNames,
      ...medications,
      ...GENERIC_CLINICAL_KEYWORDS,
      ...therapyKeywords,
    ]),
  ];

  const functionalScales = snapshot.patient
    ? {
        gmfcs: (snapshot.patient as { gmfcs?: string }).gmfcs,
        macs: (snapshot.patient as { macs?: string }).macs,
        cfcs: (snapshot.patient as { cfcs?: string }).cfcs,
        edacs: (snapshot.patient as { edacs?: string }).edacs,
      }
    : undefined;

  return {
    patientId: snapshot.patient?.patientId ?? '',
    patientName: snapshot.patient?.name ?? '',
    conditions: conditionNames,
    comorbidities: comorbidityNames,
    medications,
    symptoms,
    knowledgeKeywords,
    functionalScales,
    vitalTypes: VITAL_LEXICON,
    appSurfaces: APP_SURFACE_LABELS,
  };
}
