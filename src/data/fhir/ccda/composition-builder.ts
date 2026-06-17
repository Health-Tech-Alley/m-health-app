/**
 * Builds a FHIR Composition that anchors a C-CDA document.
 *
 * The Composition describes the document type (CCD vs Summary of episode),
 * its author, subject, and the ordered sections with entry references. The
 * C-CDA serializer consumes this Composition as the structural backbone of
 * the exported XML.
 */

import { LOINC_URI } from '../codes';
import { toFhirId, toFhirReference } from '../identifiers';
import type {
  FhirCarePlan,
  FhirComposition,
  FhirCompositionSection,
  FhirCondition,
  FhirMedicationStatement,
  FhirObservation,
  FhirPatient,
  FhirReference,
} from '../types';
import {
  ASSESSMENT_PLAN_SECTION_LOINC,
  CARE_PLAN_SECTION_LOINC,
  CCD_DOCUMENT_LOINC,
  CCD_FULL_LOINC,
  MEDICATIONS_SECTION_LOINC,
  PROBLEMS_SECTION_LOINC,
  VITAL_SIGNS_SECTION_LOINC,
} from './ccda-templates';

export interface BuildCompositionParams {
  patient: FhirPatient;
  compositionType?: 'ccd' | 'summary';
  author: FhirReference;
  conditions: FhirCondition[];
  observations: FhirObservation[];
  medications: FhirMedicationStatement[];
  carePlan: FhirCarePlan;
  assessmentNotes?: string[];
  date?: string;
}

function section(
  title: string,
  loinc: string,
  entries: FhirReference[],
  narrative: string,
): FhirCompositionSection {
  return {
    title,
    code: {
      coding: [{ system: LOINC_URI, code: loinc }],
      text: title,
    },
    entry: entries.length ? entries : undefined,
    text: { status: 'generated', div: `<div xmlns="http://www.w3.org/1999/xhtml">${narrative}</div>` },
  };
}

export function buildFhirComposition(params: BuildCompositionParams): FhirComposition {
  const {
    patient,
    compositionType = 'ccd',
    author,
    conditions,
    observations,
    medications,
    carePlan,
    assessmentNotes = [],
    date,
  } = params;

  const typeCode = compositionType === 'ccd' ? CCD_FULL_LOINC : CCD_DOCUMENT_LOINC;
  const typeDisplay =
    compositionType === 'ccd' ? 'Continuity of Care Document' : 'Summary of episode note';

  const now = date ?? new Date().toISOString();

  const vitalEntries = observations.map((o) => ({
    reference: `Observation/${o.id}`,
  }));
  const problemEntries = conditions.map((c) => ({
    reference: `Condition/${c.id}`,
  }));
  const medEntries = medications.map((m) => ({
    reference: `MedicationStatement/${m.id}`,
  }));
  const carePlanEntries = [{ reference: `CarePlan/${carePlan.id}` }];

  const sections: FhirCompositionSection[] = [
    section(
      'Vital Signs',
      VITAL_SIGNS_SECTION_LOINC,
      vitalEntries,
      observations
        .map(
          (o) =>
            `<p>${o.code.text ?? 'Observation'}: ${o.valueQuantity?.value ?? ''} ${o.valueQuantity?.unit ?? ''} (${o.effectiveDateTime ?? ''})</p>`,
        )
        .join('') || '<p>No vital signs recorded.</p>',
    ),
    section(
      'Problems',
      PROBLEMS_SECTION_LOINC,
      problemEntries,
      conditions
        .map((c) => `<p>${c.code.text ?? 'Condition'}${c.onsetDateTime ? ` (onset ${c.onsetDateTime})` : ''}</p>`)
        .join('') || '<p>No active problems.</p>',
    ),
    section(
      'Medications',
      MEDICATIONS_SECTION_LOINC,
      medEntries,
      medications
        .map((m) => {
          const dose = m.dosage?.[0]?.text ?? '';
          return `<p>${m.medicationCodeableConcept.text}${dose ? ` — ${dose}` : ''}</p>`;
        })
        .join('') || '<p>No active medications.</p>',
    ),
    section(
      'Care Plan',
      CARE_PLAN_SECTION_LOINC,
      carePlanEntries,
      carePlan.note?.map((n) => `<p>${n.text}</p>`).join('') ||
        '<p>Active care plan on file.</p>',
    ),
    section(
      'Assessment and Plan',
      ASSESSMENT_PLAN_SECTION_LOINC,
      [],
      assessmentNotes.map((n) => `<p>${n}</p>`).join('') ||
        '<p>No assessment notes.</p>',
    ),
  ];

  return {
    resourceType: 'Composition',
    id: toFhirId(`composition-${patient.id}-${now}`, 'Composition'),
    meta: { versionId: '1', lastUpdated: now },
    status: 'final',
    type: {
      coding: [{ system: LOINC_URI, code: typeCode, display: typeDisplay }],
      text: typeDisplay,
    },
    subject: toFhirReference('Patient', patient.id),
    author: [author],
    date: now,
    title: typeDisplay,
    section: sections,
  };
}
