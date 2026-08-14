/**
 * Patient NLU context builder.
 *
 * Converts a PatientRecordSnapshot into a lightweight dictionary for entity
 * linking and intent classification. Patient-specific entities come only from
 * the active persisted snapshot; generic terms are non-persona clinical terms.
 */

import type { PatientNluContext } from './types';
import type { PatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';
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
  // Structured medication rows win — the safety gate and entity linker must
  // see the same meds the system prompt and med-safety RAG see (which use
  // snapshot.medications), not only the legacy free-text field.
  const structuredMeds = (snapshot.medications ?? [])
    .map((m) => m.name?.trim())
    .filter((name): name is string => Boolean(name));
  const medications = [
    ...new Set([
      ...structuredMeds,
      ...medsList
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
    ]),
  ];

  const symptoms = snapshot.symptoms.map((s) => s.label);

  const knowledgeKeywords = [
    ...new Set([
      ...conditionNames,
      ...medications,
      ...GENERIC_CLINICAL_KEYWORDS,
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
