/**
 * Patient NLU context builder.
 *
 * Converts a PatientRecordSnapshot into a lightweight dictionary for entity
 * linking and intent classification. Patient-specific entities come only from
 * the active persisted snapshot; generic terms are non-persona clinical terms.
 */

import type { PatientNluContext } from './types';
import type { PatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';

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
  };
}
