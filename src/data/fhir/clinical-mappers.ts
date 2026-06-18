/**
 * Clinical mappers: Condition, Observation, MedicationStatement.
 *
 * Pure functions that map typed SQLite rows to FHIR R4 resources. The code
 * bindings (LOINC, UCUM, ICD-10, SNOMED, RxNorm) come from `./codes.ts`.
 */

import type {
  HealthSample,
  Medication,
  PatientCondition,
} from '../types';
import {
  COUGHING_SNOMED,
  icd10ConditionConcept,
  loincVitalCode,
  rxNormMedicationConcept,
  vitalValueQuantity,
  SNOMED_CT_URI,
} from './codes';
import { toFhirId, toFhirReference } from './identifiers';
import type {
  FhirCodeableConcept,
  FhirCondition,
  FhirMedicationStatement,
  FhirObservation,
} from './types';

export function toFhirCondition(condition: PatientCondition): FhirCondition {
  return {
    resourceType: 'Condition',
    id: toFhirId(condition.conditionId, 'Condition'),
    meta: { versionId: '1' },
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: 'active',
          display: 'Active',
        },
      ],
      text: 'Active',
    },
    code: icd10ConditionConcept(condition.name, condition.icd10),
    subject: toFhirReference('Patient', condition.patientId),
    onsetDateTime: condition.onsetDate,
  };
}

export function toFhirObservation(sample: HealthSample): FhirObservation {
  let code: FhirCodeableConcept;
  if (sample.type === 'coughing') {
    code = {
      coding: [
        { system: SNOMED_CT_URI, code: COUGHING_SNOMED.code, display: COUGHING_SNOMED.display },
      ],
      text: COUGHING_SNOMED.display,
    };
  } else {
    const loinc = loincVitalCode(sample.type);
    code = loinc ?? {
      coding: [],
      text: sample.type,
    };
  }

  const observation: FhirObservation = {
    resourceType: 'Observation',
    id: toFhirId(sample.sampleId, 'Observation'),
    meta: { versionId: '1' },
    status: 'final',
    category: sample.type.startsWith('blood_pressure')
      ? [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'vital-signs',
                display: 'Vital Signs',
              },
            ],
            text: 'Vital Signs',
          },
        ]
      : undefined,
    code,
    subject: toFhirReference('Patient', sample.patientId),
    effectiveDateTime: sample.recordedAt,
    valueQuantity: vitalValueQuantity(sample.type, sample.value, sample.unit),
  };

  return observation;
}

export function toFhirMedicationStatement(med: Medication): FhirMedicationStatement {
  const dosage = [];
  if (med.dosage || med.frequency || med.route) {
    dosage.push({
      sequence: 1,
      text: [med.dosage, med.frequency, med.route].filter(Boolean).join(' · ') || undefined,
      route: med.route
        ? {
            coding: [{ system: SNOMED_CT_URI, display: med.route }],
            text: med.route,
          }
        : undefined,
    });
  }

  const statement: FhirMedicationStatement = {
    resourceType: 'MedicationStatement',
    id: toFhirId(med.medicationId, 'MedicationStatement'),
    meta: { versionId: '1' },
    status: med.active ? 'active' : 'completed',
    medicationCodeableConcept: rxNormMedicationConcept(med.name),
    subject: toFhirReference('Patient', med.patientId),
    dosage,
    note: med.indication ? [{ text: `Indication: ${med.indication}` }] : undefined,
  };

  return statement;
}
