/**
 * Terminology code maps + code-system OIDs.
 *
 * Covers the vitals LOINC/UCUM bindings, SNOMED CT activity codes for care
 * plan activities, and the code-system + C-CDA template OIDs used by the
 * serializers. Re-exported from `ccda/ccda-templates.ts` where shared.
 */

import type { HealthSampleType } from '../types';
import type { FhirCodeableConcept, FhirQuantity } from './types';

// ---------------------------------------------------------------------------
// Code-system OIDs
// ---------------------------------------------------------------------------

export const SNOMED_CT_OID = '2.16.840.1.113883.6.96';
export const ICD10_OID = '2.16.840.1.113883.6.90';
export const RXNORM_OID = '2.16.840.1.113883.6.88';
export const LOINC_OID = '2.16.840.1.113883.6.1';
export const UCUM_OID = '2.16.840.1.113883.5.143';

export const SNOMED_CT_URI = 'http://snomed.info/sct';
export const ICD10_URI = 'http://hl7.org/fhir/sid/icd-10';
export const RXNORM_URI = 'http://www.nlm.nih.gov/research/umls/rxnorm';
export const LOINC_URI = 'http://loinc.org';
export const UCUM_URI = 'http://unitsofmeasure.org';

// ---------------------------------------------------------------------------
// Vital signs: HealthSampleType → LOINC code + display + UCUM unit
// ---------------------------------------------------------------------------

export interface LoincVitalBinding {
  loinc: string;
  display: string;
  unit: string;
  ucumCode: string;
}

export const VITAL_LOINC_MAP: Record<HealthSampleType, LoincVitalBinding | null> = {
  spo2: { loinc: '59408-5', display: 'Oxygen saturation in Arterial blood', unit: '%', ucumCode: '%' },
  heart_rate: { loinc: '8867-4', display: 'Heart rate', unit: '/min', ucumCode: '/min' },
  respiratory_rate: { loinc: '9279-1', display: 'Respiratory rate', unit: '/min', ucumCode: '/min' },
  blood_pressure_systolic: { loinc: '8480-6', display: 'Systolic blood pressure', unit: 'mm[Hg]', ucumCode: 'mm[Hg]' },
  blood_pressure_diastolic: { loinc: '8462-4', display: 'Diastolic blood pressure', unit: 'mm[Hg]', ucumCode: 'mm[Hg]' },
  temperature: { loinc: '8310-5', display: 'Body temperature', unit: 'Cel', ucumCode: 'Cel' },
  weight: { loinc: '29463-7', display: 'Body weight', unit: 'kg', ucumCode: 'kg' },
  height: { loinc: '8302-2', display: 'Body height', unit: 'cm', ucumCode: 'cm' },
  bmi: { loinc: '39156-5', display: 'Body mass index (BMI)', unit: 'kg/m2', ucumCode: 'kg/m2' },
  blood_glucose: { loinc: '2339-0', display: 'Glucose in Blood', unit: 'mg/dL', ucumCode: 'mg/dL' },
  steps: { loinc: '55423-8', display: 'Step count', unit: '1', ucumCode: '1' },
  distance: null,
  flights_climbed: null,
  sleep: { loinc: '93832-8', display: 'Sleep duration', unit: 'h', ucumCode: 'h' },
  coughing: { loinc: '8716-3', display: 'Coughing', unit: '1', ucumCode: '1' },
  calories_burned: { loinc: '41981-2', display: 'Active energy burned', unit: 'kcal', ucumCode: 'kcal' },
  hrv_sdnn: { loinc: '80404-7', display: 'Heart rate variability', unit: 'ms', ucumCode: 'ms' },
  resting_heart_rate: { loinc: '40443-4', display: 'Resting heart rate', unit: '/min', ucumCode: '/min' },
  walking_steadiness: { loinc: '93667-9', display: 'Walking steadiness', unit: '%', ucumCode: '%' },
  walking_speed: { loinc: '41967-1', display: 'Walking speed', unit: 'm/s', ucumCode: 'm/s' },
  step_length: { loinc: '41968-9', display: 'Walking step length', unit: 'cm', ucumCode: 'cm' },
  walking_asymmetry: { loinc: '41969-7', display: 'Gait asymmetry', unit: '%', ucumCode: '%' },
  walking_double_support: { loinc: '41970-5', display: 'Double support time', unit: '%', ucumCode: '%' },
  vo2_max: { loinc: '38206-6', display: 'VO2 maximum', unit: 'ml/kg/min', ucumCode: 'ml/kg/min' },
  six_minute_walk_distance: { loinc: '41979-6', display: 'Six minute walk distance', unit: 'm', ucumCode: 'm' },
};

export const COUGHING_SNOMED = { code: '49727002', display: 'Cough (finding)' };

export function loincVitalCode(type: HealthSampleType): FhirCodeableConcept | null {
  const binding = VITAL_LOINC_MAP[type];
  if (!binding) return null;
  return {
    coding: [{ system: LOINC_URI, code: binding.loinc, display: binding.display }],
    text: binding.display,
  };
}

export function vitalValueQuantity(type: HealthSampleType, value: number, unit?: string): FhirQuantity {
  const binding = VITAL_LOINC_MAP[type];
  const resolvedUnit = unit ?? binding?.unit ?? '1';
  return {
    value,
    unit: resolvedUnit,
    system: UCUM_URI,
    code: binding?.ucumCode ?? resolvedUnit,
  };
}

// ---------------------------------------------------------------------------
// SNOMED CT activity codes for care plan activities
// ---------------------------------------------------------------------------

export const SNOMED_ACTIVITY = {
  medicationAdministration: { code: '440162008', display: 'Administration of medication (procedure)' },
  exerciseOrPt: { code: '229064006', display: 'Exercise therapy (procedure)' },
  vitalSignsMonitoring: { code: '61646002', display: 'Monitoring vital signs (procedure)' },
} as const;

export function snomedActivityCode(
  key: keyof typeof SNOMED_ACTIVITY,
): FhirCodeableConcept {
  const a = SNOMED_ACTIVITY[key];
  return {
    coding: [{ system: SNOMED_CT_URI, code: a.code, display: a.display }],
    text: a.display,
  };
}

// ---------------------------------------------------------------------------
// RxNorm helper (offline; medication name → display only, no cached code yet)
// ---------------------------------------------------------------------------

export function rxNormMedicationConcept(name: string): FhirCodeableConcept {
  return {
    coding: [{ system: RXNORM_URI, code: undefined, display: name }],
    text: name,
  };
}

export function icd10ConditionConcept(name: string, icd10?: string): FhirCodeableConcept {
  const coding = icd10
    ? [{ system: ICD10_URI, code: icd10, display: name }]
    : [{ system: SNOMED_CT_URI, code: undefined, display: name }];
  return { coding, text: name };
}
