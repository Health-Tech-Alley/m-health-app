/**
 * C-CDA template OIDs + LOINC section codes + code-system OIDs.
 *
 * Re-exports the code-system OIDs from `../codes.ts` so the serializer has a
 * single import surface for C-CDA-specific constants.
 */

export {
  ICD10_OID,
  LOINC_OID,
  RXNORM_OID,
  SNOMED_CT_OID,
  UCUM_OID,
  ICD10_URI,
  LOINC_URI,
  RXNORM_URI,
  SNOMED_CT_URI,
  UCUM_URI,
} from '../codes';

// ---------------------------------------------------------------------------
// C-CDA document template OIDs
// ---------------------------------------------------------------------------

export const CCD_TEMPLATE_OID = '2.16.840.1.113883.10.20.22.1.1';
export const CCD_TEMPLATE_EXTENSION = '2015-08-01';

export const CARE_PLAN_TEMPLATE_OID = '2.16.840.1.113883.10.20.22.2.10';
export const CARE_PLAN_TEMPLATE_EXTENSION = '2015-08-01';

export const VITAL_SIGNS_TEMPLATE_OID = '2.16.840.1.113883.10.20.22.2.4.1';
export const VITAL_SIGNS_TEMPLATE_EXTENSION = '2015-08-01';

export const PROBLEMS_TEMPLATE_OID = '2.16.840.1.113883.10.20.22.2.5.1';
export const PROBLEMS_TEMPLATE_EXTENSION = '2015-08-01';

export const MEDICATIONS_TEMPLATE_OID = '2.16.840.1.113883.10.20.22.2.1.1';
export const MEDICATIONS_TEMPLATE_EXTENSION = '2014-06-09';

// ---------------------------------------------------------------------------
// LOINC section codes (C-CDA section types)
// ---------------------------------------------------------------------------

export const CCD_DOCUMENT_LOINC = '34133-9'; // Summary of episode note
export const CCD_FULL_LOINC = '11488-4'; // Continuity of Care Document
export const VITAL_SIGNS_SECTION_LOINC = '8716-3';
export const PROBLEMS_SECTION_LOINC = '11450-4';
export const MEDICATIONS_SECTION_LOINC = '10160-0';
export const CARE_PLAN_SECTION_LOINC = '18776-5';
export const ASSESSMENT_PLAN_SECTION_LOINC = '51847-2';
export const DEMOGRAPHICS_SECTION_LOINC = '29762-2';

// ---------------------------------------------------------------------------
// CDA structural OIDs
// ---------------------------------------------------------------------------

export const CDA_TYPE_ID_ROOT = '2.16.840.1.113883.1.3';
export const CDA_CONFIDENTIALITY_NORMAL = 'N';

export interface CcdaSectionDescriptor {
  templateOid: string;
  templateExtension: string;
  loinc: string;
  title: string;
}

export const SECTIONS = {
  vitalSigns: {
    templateOid: VITAL_SIGNS_TEMPLATE_OID,
    templateExtension: VITAL_SIGNS_TEMPLATE_EXTENSION,
    loinc: VITAL_SIGNS_SECTION_LOINC,
    title: 'Vital Signs',
  },
  problems: {
    templateOid: PROBLEMS_TEMPLATE_OID,
    templateExtension: PROBLEMS_TEMPLATE_EXTENSION,
    loinc: PROBLEMS_SECTION_LOINC,
    title: 'Problems',
  },
  medications: {
    templateOid: MEDICATIONS_TEMPLATE_OID,
    templateExtension: MEDICATIONS_TEMPLATE_EXTENSION,
    loinc: MEDICATIONS_SECTION_LOINC,
    title: 'Medications',
  },
  carePlan: {
    templateOid: CARE_PLAN_TEMPLATE_OID,
    templateExtension: CARE_PLAN_TEMPLATE_EXTENSION,
    loinc: CARE_PLAN_SECTION_LOINC,
    title: 'Care Plan',
  },
  assessment: {
    templateOid: '',
    templateExtension: '',
    loinc: ASSESSMENT_PLAN_SECTION_LOINC,
    title: 'Assessment and Plan',
  },
} as const;
