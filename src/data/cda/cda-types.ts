/**
 * CDA JSON document types — planning/33 §1.2.
 *
 * The de-identified CDA dataset (`planning/standardized_json/`) is the
 * standardized JSON form of C-CDA XML documents, all for the same patient.
 * Conditions / encounters / meds are SNOMED CT coded; vitals are PQ
 * (physical quantity) organizers with unit-based disambiguation; narrative
 * sections preserve the original rich-text blocks.
 *
 * These types are intentionally permissive (lots of optional fields) — the
 * raw CDA format has many empty/optional elements depending on the
 * authoring EHR, and the importer must gracefully skip missing pieces
 * rather than throw.
 *
 * See planning/33_cda-ehr-import-slm-ml-integration.md for the full schema
 * walkthrough and example document.
 */

export type CdaCodeSystem =
  // SNOMED CT (conditions, encounters, allergies)
  | '2.16.840.1.113883.6.96'
  // LOINC (sections, vitals organizers, labs)
  | '2.16.840.1.113883.6.1'
  // HL7 ActCode (IMMUNIZ, AMB, etc.)
  | '2.16.840.1.113883.5.4'
  // HL7 ActClass (CONC, etc.)
  | '2.16.840.1.113883.5.6'
  // HL7 ObservationInterpretation
  | '2.16.840.1.113883.5.83'
  // HL7 Confidentiality
  | '2.16.840.1.113883.5.25'
  | (string & {});

export interface CdaCoding {
  code?: string | null;
  code_system?: string | null;
  code_system_name?: string | null;
  display_name?: string | null;
}

export interface CdaEffectiveTime {
  value?: string | null;
  low?: string | null;
  high?: string | null;
}

export interface CdaValue {
  xsi_type?: string | null;
  value?: string | number | null;
  unit?: string | null;
  code?: string | null;
  code_system?: string | null;
  display_name?: string | null;
  text?: string | null;
}

export type CdaEntryType =
  | 'act'
  | 'organizer'
  | 'substanceAdministration'
  | 'encounter'
  | 'observation'
  | 'procedure'
  | string;

export interface CdaEntry {
  entry_type: CdaEntryType;
  code?: CdaCoding;
  status?: string | null;
  effective_time?: CdaEffectiveTime;
  value?: CdaValue | string | number | null;
  values?: CdaValue[];
  text?: string | null;
  source_section_title?: string | null;
  source_section_code?: CdaCoding;
}

export interface CdaVitalOrganizer extends CdaEntry {
  entry_type: 'organizer';
  values: CdaValue[];
}

export interface CdaNarrativeDerived {
  source: string;
  source_section_title?: string;
  name?: string;
  value?: string;
  time?: string;
}

export interface CdaVitals {
  structured?: CdaVitalOrganizer[];
  narrative_derived?: CdaNarrativeDerived[];
}

export interface CdaTable {
  headers: string[];
  rows: Record<string, string>[];
}

export interface CdaNarrativeSection {
  title?: string;
  code?: CdaCoding;
  narrative_text?: string;
  tables?: CdaTable[];
  question_answer_rows?: unknown[];
  entry_count?: number;
}

export interface CdaCarePlanItem {
  source_section_title?: string;
  source_section_code?: CdaCoding;
  narrative_text?: string;
  tables?: CdaTable[];
  question_answer_rows?: unknown[];
}

export interface CdaFunctionalStatusItem {
  source_section_title?: string;
  source_section_code?: CdaCoding;
  narrative_text?: string;
  tables?: CdaTable[];
  question_answer_rows?: unknown[];
}

export interface CdaPatient {
  ids?: { root?: string; extension?: string }[];
  sex?: CdaCoding;
  birth_time?: string | null;
  name_text?: string;
  address_text?: string;
  telecom?: { value?: string; use?: string }[];
}

export interface CdaSchemaRef {
  name: string;
  version: string;
}

export interface CdaConversion {
  status?: string;
  warnings?: string[];
}

export interface CdaJsonDoc {
  schema: CdaSchemaRef;
  source_file: string;
  source_stem: string;
  document: {
    title?: string;
    code?: CdaCoding;
    effective_time?: string | CdaEffectiveTime;
    id?: { root?: string; extension?: string | null };
    confidentiality_code?: CdaCoding;
    language_code?: string;
  };
  patient: CdaPatient;
  authors?: unknown[];
  custodians?: unknown[];
  encounters?: CdaEntry[];
  conditions?: CdaEntry[];
  medications?: CdaEntry[];
  allergies?: CdaEntry[];
  procedures?: CdaEntry[];
  immunizations?: CdaEntry[];
  vitals?: CdaVitals;
  labs?: CdaEntry[];
  functional_status?: CdaFunctionalStatusItem[];
  assessments?: CdaEntry[];
  care_plan?: CdaCarePlanItem[];
  narrative_sections?: CdaNarrativeSection[];
  conversion?: CdaConversion;
}
