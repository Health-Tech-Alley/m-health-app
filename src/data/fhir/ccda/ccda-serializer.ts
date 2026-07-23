/**
 * C-CDA XML serializer.
 *
 * Converts FHIR resources into a Consolidated CDA (C-CDA) XML document. No
 * external XML library is used — a tiny tag-builder + escaper is sufficient
 * for the partial C-CDA compliance this app targets (see planning doc §8).
 *
 * The output is a single XML string suitable for writing to the export queue
 * (`fhir_resources.kind='export_queue'`) or for sharing with a provider.
 */

import type {
  FhirCarePlan,
  FhirCondition,
  FhirMedicationStatement,
  FhirObservation,
  FhirPatient,
  FhirPractitioner,
  FhirProvenance,
  FhirRelatedPerson,
} from '../types';
import {
  CDA_CONFIDENTIALITY_NORMAL,
  CDA_TYPE_ID_ROOT,
  CCD_FULL_LOINC,
  CCD_DOCUMENT_LOINC,
  CCD_TEMPLATE_EXTENSION,
  CCD_TEMPLATE_OID,
  ICD10_URI,
  LOINC_URI,
  RXNORM_URI,
  SECTIONS,
  SNOMED_CT_URI,
} from './ccda-templates';

const CDA_NS = 'urn:hl7-org:v3';

// ---------------------------------------------------------------------------
// Tiny XML builder
// ---------------------------------------------------------------------------

export function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface XmlAttr {
  [key: string]: string | undefined;
}

export function tag(
  name: string,
  attrs: XmlAttr | null,
  children?: string | string[],
): string {
  const attrStr = attrs
    ? Object.entries(attrs)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => ` ${k}="${esc(v)}"`)
        .join('')
    : '';
  const inner = Array.isArray(children) ? children.join('') : (children ?? '');
  if (inner === '') return `<${name}${attrStr}/>`;
  return `<${name}${attrStr}>${inner}</${name}>`;
}

function templateId(root: string, extension?: string): string {
  return tag('templateId', { root, extension });
}

function id(root: string, extension?: string): string {
  return tag('id', { root, extension });
}

function code(
  code: string,
  system: string,
  displayName: string,
  codeSystemName?: string,
): string {
  return tag('code', {
    code,
    codeSystem: system,
    codeSystemName,
    displayName,
  });
}

function valuePq(value: number | string, unit: string): string {
  return tag('value', { 'xsi:type': 'PQ', value: String(value), unit });
}

function effectiveTime(value?: string, opts?: { low?: string; high?: string }): string {
  if (opts && (opts.low || opts.high)) {
    return tag(
      'effectiveTime',
      null,
      [opts.low ? tag('low', { value: opts.low }) : '', opts.high ? tag('high', { value: opts.high }) : ''],
    );
  }
  return value ? tag('effectiveTime', { value }) : tag('effectiveTime', null);
}

function narrative(text: string): string {
  const paragraphs = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => tag('p', null, esc(l)));
  return tag(
    'text',
    null,
    paragraphs.length ? paragraphs.join('') : tag('p', null, '(none)'),
  );
}

// ---------------------------------------------------------------------------
// Header builders
// ---------------------------------------------------------------------------

function buildRecordTarget(patient: FhirPatient): string {
  const name = patient.name?.[0];
  const nameEl = name
    ? tag(
        'name',
        null,
        [
          ...(name.given ?? []).map((g) => tag('given', null, esc(g))),
          name.family ? tag('family', null, esc(name.family)) : '',
        ],
      )
    : '';
  const birthTime = patient.birthDate ? tag('birthTime', { value: patient.birthDate }) : '';
  const patientId = patient.identifier?.[0]?.value ?? patient.id;
  return tag(
    'recordTarget',
    null,
    tag(
      'patientRole',
      null,
      [
        id('2.16.840.1.113883.4.1', patientId),
        '',
        tag(
          'patient',
          null,
          [
            nameEl,
            tag('administrativeGenderCode', { code: patient.gender ?? 'unknown', codeSystem: '2.16.840.1.113883.5.1' }),
            birthTime,
          ].join(''),
        ),
      ].join(''),
    ),
  );
}

function buildAuthor(
  authorRef: { display?: string; reference: string },
  time: string,
): string {
  const display = authorRef.display ?? authorRef.reference ?? 'Caregiver Concierge App';
  return tag(
    'author',
    null,
    [
      time ? tag('time', { value: time }) : '',
      tag(
        'assignedAuthor',
        null,
        [
          id('2.16.840.1.113883.4.6', 'CAREGIVER-CONCIERGE'),
          tag(
            'assignedPerson',
            null,
            tag('name', null, tag('given', null, esc(display))),
          ),
        ].join(''),
      ),
    ].join(''),
  );
}

function buildAuthenticator(
  provider?: FhirPractitioner,
  caregiver?: FhirRelatedPerson,
): string {
  const party = provider ?? caregiver;
  if (!party) return '';
  const name = party.name?.[0];
  const display = name?.text ?? name?.family ?? party.id;
  return tag(
    'authenticator',
    null,
    tag(
      'assignedEntity',
      null,
      [
        id('2.16.840.1.113883.4.6', party.id),
        tag(
          'assignedPerson',
          null,
          tag('name', null, esc(display)),
        ),
      ].join(''),
    ),
  );
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildVitalSignsSection(observations: FhirObservation[]): string {
  const entries = observations.map((o) => {
    const loinc = o.code.coding?.find((c) => c.system === LOINC_URI);
    const codeEl = loinc
      ? code(loinc.code ?? '', LOINC_URI, loinc.display ?? o.code.text ?? '', 'LOINC')
      : code('', '', o.code.text ?? 'Observation', '');
    const valueEl = o.valueQuantity
      ? valuePq(o.valueQuantity.value ?? '', o.valueQuantity.unit ?? '')
      : '';
    return tag(
      'entry',
      { typeCode: 'DRIV' },
      tag(
        'organizer',
        { classCode: 'CLUSTER', moodCode: 'EVN' },
        [
          templateId('2.16.840.1.113883.10.20.22.4.26', '2015-08-01'),
          id('2.16.840.1.113883.19', o.id),
          codeEl,
          tag('statusCode', { code: 'completed' }),
          effectiveTime(o.effectiveDateTime ?? ''),
          tag(
            'component',
            null,
            tag(
              'observation',
              { classCode: 'OBS', moodCode: 'EVN' },
              [
                templateId('2.16.840.1.113883.10.20.22.4.2', '2015-08-01'),
                id('2.16.840.1.113883.19', o.id),
                codeEl,
                tag('statusCode', { code: 'completed' }),
                effectiveTime(o.effectiveDateTime ?? ''),
                valueEl,
              ].join(''),
            ),
          ),
        ].join(''),
      ),
    );
  });

  const narrativeText = observations
    .map(
      (o) =>
        `${o.code.text ?? 'Observation'}: ${o.valueQuantity?.value ?? ''} ${o.valueQuantity?.unit ?? ''} @ ${o.effectiveDateTime ?? ''}`,
    )
    .join('\n');

  return buildSection(SECTIONS.vitalSigns, entries, narrativeText);
}

function buildProblemsSection(conditions: FhirCondition[]): string {
  const entries = conditions.map((c) => {
    const icd10 = c.code.coding?.find((cod) => cod.system === ICD10_URI);
    const snomed = c.code.coding?.find((cod) => cod.system === SNOMED_CT_URI);
    const sys = icd10 ? ICD10_URI : snomed ? SNOMED_CT_URI : '';
    const codeValue = icd10?.code ?? snomed?.code ?? '';
    const codeEl = codeValue
      ? code(codeValue, sys, c.code.text ?? '', icd10 ? 'ICD10' : 'SNOMED CT')
      : code('', '', c.code.text ?? 'Condition', '');
    return tag(
      'entry',
      { typeCode: 'DRIV' },
      tag(
        'act',
        { classCode: 'ACT', moodCode: 'EVN' },
        [
          templateId('2.16.840.1.113883.10.20.22.4.3', '2015-08-01'),
          id('2.16.840.1.113883.19', c.id),
          code('CONC', '2.16.840.1.113883.5.6', 'Problem', 'ActClass'),
          tag('statusCode', { code: 'active' }),
          effectiveTime(undefined, { low: c.onsetDateTime }),
          tag(
            'entryRelationship',
            { typeCode: 'SUBJ', inversionInd: 'false' },
            tag(
              'observation',
              { classCode: 'OBS', moodCode: 'EVN', negationInd: 'false' },
              [
                templateId('2.16.840.1.113883.10.20.22.4.4', '2015-08-01'),
                id('2.16.840.1.113883.19', `${c.id}-obs`),
                code('64572001', SNOMED_CT_URI, 'Condition', 'SNOMED CT'),
                tag('statusCode', { code: 'completed' }),
                codeEl,
              ].join(''),
            ),
          ),
        ].join(''),
      ),
    );
  });

  const narrativeText = conditions
    .map((c) => `${c.code.text ?? 'Condition'}${c.onsetDateTime ? ` (onset ${c.onsetDateTime})` : ''}`)
    .join('\n');

  return buildSection(SECTIONS.problems, entries, narrativeText);
}

function buildMedicationsSection(meds: FhirMedicationStatement[]): string {
  const entries = meds.map((m) => {
    const rxnorm = m.medicationCodeableConcept.coding?.find((c) => c.system === RXNORM_URI);
    const codeEl = rxnorm?.code
      ? code(rxnorm.code, RXNORM_URI, m.medicationCodeableConcept.text ?? '', 'RxNorm')
      : code('', '', m.medicationCodeableConcept.text ?? 'Medication', '');
    const dosageText = m.dosage?.[0]?.text ?? '';
    return tag(
      'entry',
      { typeCode: 'DRIV' },
      tag(
        'substanceAdministration',
        { classCode: 'SBADM', moodCode: 'EVN' },
        [
          templateId('2.16.840.1.113883.10.20.22.4.16', '2014-06-09'),
          id('2.16.840.1.113883.19', m.id),
          tag('statusCode', { code: m.status === 'active' ? 'active' : 'completed' }),
          effectiveTime(),
          tag(
            'consumable',
            null,
            tag(
              'manufacturedProduct',
              null,
              tag(
                'manufacturedLabeledDrug',
                null,
                [codeEl, tag('name', null, esc(m.medicationCodeableConcept.text))].join(''),
              ),
            ),
          ),
          dosageText
            ? tag(
                'entryRelationship',
                { typeCode: 'COMP' },
                tag(
                  'substanceAdministration',
                  { classCode: 'SBADM', moodCode: 'INT' },
                  [
                    templateId('2.16.840.1.113883.10.20.22.4.9'),
                    tag('text', null, esc(dosageText)),
                  ].join(''),
                ),
              )
            : '',
        ].join(''),
      ),
    );
  });

  const narrativeText = meds
    .map((m) => {
      const dose = m.dosage?.[0]?.text ?? '';
      return `${m.medicationCodeableConcept.text}${dose ? ` — ${dose}` : ''}`;
    })
    .join('\n');

  return buildSection(SECTIONS.medications, entries, narrativeText);
}

function buildCarePlanSection(
  carePlan: FhirCarePlan,
  conditions: FhirCondition[],
): string {
  const problemEntries = conditions.map((c) =>
    tag('act', { classCode: 'ACT', moodCode: 'EVN' }, [
      templateId('2.16.840.1.113883.10.20.22.4.3'),
      id('2.16.840.1.113883.19', c.id),
      code('CONC', '2.16.840.1.113883.5.6', 'Problem'),
      tag('statusCode', { code: 'active' }),
    ].join('')),
  );

  const goalEntries = (carePlan.goal ?? []).map((g, i) =>
    tag('observation', { classCode: 'OBS', moodCode: 'GOL' }, [
      templateId('2.16.840.1.113883.10.20.22.4.121'),
      id('2.16.840.1.113883.19', `${carePlan.id}-goal-${i}`),
      code('75320-2', LOINC_URI, 'Goal', 'LOINC'),
      tag('statusCode', { code: 'active' }),
      tag('value', { 'xsi:type': 'ST' }, esc(g.display ?? 'Goal')),
    ].join('')),
  );

  const instructionEntries = (carePlan.activity ?? []).map((a, i) =>
    tag('substanceAdministration', { classCode: 'SBADM', moodCode: 'RQO' }, [
      templateId('2.16.840.1.113883.10.20.22.4.42'),
      id('2.16.840.1.113883.19', `${carePlan.id}-act-${i}`),
      a.detail?.code?.coding?.[0]?.code
        ? code(
            a.detail.code.coding[0].code,
            a.detail.code.coding[0].system ?? SNOMED_CT_URI,
            a.detail.code.text ?? '',
            'SNOMED CT',
          )
        : '',
      tag('text', null, esc(a.detail?.description ?? '')),
    ].join('')),
  );

  const entry = tag(
    'entry',
    { typeCode: 'DRIV' },
    tag(
      'organizer',
      { classCode: 'CLUSTER', moodCode: 'EVN' },
      [
        templateId('2.16.840.1.113883.10.20.22.4.500'),
        id('2.16.840.1.113883.19', carePlan.id),
        code('18776-5', LOINC_URI, 'Care plan', 'LOINC'),
        tag('statusCode', { code: 'active' }),
        ...problemEntries.map((p) => tag('component', null, p)),
        ...goalEntries.map((g) => tag('component', null, g)),
        ...instructionEntries.map((i) => tag('component', null, i)),
      ].join(''),
    ),
  );

  const narrativeText = (carePlan.note ?? [])
    .map((n) => n.text)
    .join('\n');

  return buildSection(SECTIONS.carePlan, [entry], narrativeText);
}

function buildAssessmentSection(
  auditEntries: FhirProvenance[] = [],
  assessmentNotes: string[] = [],
): string {
  const lines = [
    ...assessmentNotes,
    ...auditEntries.map((p) => `[${p.recorded}] ${p.agent?.[0]?.role?.[0]?.text ?? 'actor'}: ${p.activity?.text ?? p.target?.[0]?.display ?? ''}`),
  ];
  return buildSection(SECTIONS.assessment, [], lines.join('\n'));
}

function buildSection(
  descriptor: { templateOid: string; templateExtension: string; loinc: string; title: string },
  entries: string[],
  narrativeText: string,
): string {
  const templateIds =
    descriptor.templateOid && descriptor.templateExtension
      ? templateId(descriptor.templateOid, descriptor.templateExtension)
      : '';
  return tag(
    'section',
    null,
    [
      templateIds,
      code(descriptor.loinc, LOINC_URI, descriptor.title, 'LOINC'),
      tag('title', null, esc(descriptor.title)),
      narrative(narrativeText),
      ...entries,
    ].join(''),
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildCcdDocumentParams {
  patient: FhirPatient;
  caregiver?: FhirRelatedPerson;
  provider?: FhirPractitioner;
  conditions: FhirCondition[];
  observations: FhirObservation[];
  medications: FhirMedicationStatement[];
  carePlan: FhirCarePlan;
  auditEntries?: FhirProvenance[];
  assessmentNotes?: string[];
  compositionType?: 'ccd' | 'summary';
  effectiveTime?: string;
}

export function buildCcdDocument(params: BuildCcdDocumentParams): string {
  const {
    patient,
    caregiver,
    provider,
    conditions,
    observations,
    medications,
    carePlan,
    auditEntries = [],
    assessmentNotes = [],
    compositionType = 'ccd',
    effectiveTime: recordTime,
  } = params;

  const now = recordTime ?? new Date().toISOString();
  const loincCode = compositionType === 'ccd' ? CCD_FULL_LOINC : CCD_DOCUMENT_LOINC;
  const loincDisplay =
    compositionType === 'ccd' ? 'Continuity of Care Document' : 'Summary of episode note';

  const authorRef = caregiver
    ? { reference: `RelatedPerson/${caregiver.id}`, display: caregiver.name?.[0]?.text ?? 'Caregiver' }
    : { reference: 'Device/caregiver-concierge', display: 'Caregiver Concierge App' };

  const header = [
    tag('typeId', { root: CDA_TYPE_ID_ROOT, extension: 'POCD_HD000040' }),
    templateId(CCD_TEMPLATE_OID, CCD_TEMPLATE_EXTENSION),
    id('2.16.840.1.113883.19', `ccd-${patient.id}-${now}`),
    code(loincCode, LOINC_URI, loincDisplay, 'LOINC'),
    tag('title', null, esc(loincDisplay)),
    effectiveTime(now),
    tag('confidentialityCode', { code: CDA_CONFIDENTIALITY_NORMAL, codeSystem: '2.16.840.1.113883.5.25' }),
    tag('languageCode', { code: 'en-US' }),
    buildRecordTarget(patient),
    buildAuthor(authorRef, now),
    buildAuthenticator(provider, caregiver),
  ].join('');

  const body = tag(
    'component',
    null,
    tag(
      'structuredBody',
      null,
      [
        buildVitalSignsSection(observations),
        buildProblemsSection(conditions),
        buildMedicationsSection(medications),
        buildCarePlanSection(carePlan, conditions),
        buildAssessmentSection(auditEntries, assessmentNotes),
      ].join(''),
    ),
  );

  const clinicalDocument = tag(
    'ClinicalDocument',
    { xmlns: CDA_NS, 'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance' },
    [header, body].join(''),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?xml-stylesheet type="text/xsl" href="ccda.xsl"?>',
    clinicalDocument,
  ].join('\n');
}
