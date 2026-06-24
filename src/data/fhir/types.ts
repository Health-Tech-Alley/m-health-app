/**
 * Partial FHIR R4 resource TypeScript interfaces.
 *
 * Only the fields the Caregiver Concierge app actually uses are modeled.
 * These are derived readers over typed SQLite rows (see the mappers in
 * this directory). They are intentionally not full FHIR R4 — they are the
 * minimal conformant shape needed for C-CDA export and SLM context.
 */

export type FhirResourceType =
  | 'Patient'
  | 'RelatedPerson'
  | 'Practitioner'
  | 'Condition'
  | 'Observation'
  | 'MedicationRequest'
  | 'MedicationStatement'
  | 'Goal'
  | 'CarePlan'
  | 'Consent'
  | 'Provenance'
  | 'Composition'
  | 'Bundle';

export interface FhirReference {
  reference: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding: FhirCoding[];
  text?: string;
}

export interface FhirCoding {
  system?: string;
  version?: string;
  code?: string;
  display?: string;
  userSelected?: boolean;
}

export interface FhirQuantity {
  value?: number;
  comparator?: '<' | '<=' | '>=' | '>';
  unit?: string;
  system?: string;
  code?: string;
}

export interface FhirExtension {
  url: string;
  valueString?: string;
}

export interface FhirPeriod {
  start?: string;
  end?: string;
}

export interface FhirTiming {
  repeat?: {
    frequency?: number;
    period?: number;
    periodUnit?: 's' | 'min' | 'h' | 'd' | 'wk' | 'mo' | 'a';
    when?: string[];
  };
  code?: FhirCodeableConcept;
}

export interface FhirHumanName {
  use?: 'usual' | 'official' | 'temp' | 'nickname' | 'anonymous' | 'old' | 'maiden';
  text?: string;
  family?: string;
  given?: string[];
}

export interface FhirContactPoint {
  system?: 'phone' | 'fax' | 'email' | 'pager' | 'url' | 'sms' | 'other';
  value?: string;
  use?: 'home' | 'work' | 'temp' | 'old' | 'mobile';
}

export interface FhirAddress {
  use?: 'home' | 'work' | 'temp' | 'old' | 'billing';
  text?: string;
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface FhirIdentifier {
  use?: 'usual' | 'official' | 'temp' | 'secondary' | 'old';
  system?: string;
  value?: string;
}

export interface FhirMeta {
  versionId?: string;
  lastUpdated?: string;
  profile?: string[];
}

export interface FhirPatient {
  resourceType: 'Patient';
  id: string;
  meta?: FhirMeta;
  identifier?: FhirIdentifier[];
  name: FhirHumanName[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
  address?: FhirAddress[];
  telecom?: FhirContactPoint[];
  extension?: FhirExtension[];
}

export interface FhirRelatedPerson {
  resourceType: 'RelatedPerson';
  id: string;
  meta?: FhirMeta;
  patient: FhirReference;
  relationship?: FhirCodeableConcept[];
  name?: FhirHumanName[];
  telecom?: FhirContactPoint[];
}

export interface FhirPractitioner {
  resourceType: 'Practitioner';
  id: string;
  meta?: FhirMeta;
  identifier?: FhirIdentifier[];
  name: FhirHumanName[];
  telecom?: FhirContactPoint[];
}

export interface FhirCondition {
  resourceType: 'Condition';
  id: string;
  meta?: FhirMeta;
  clinicalStatus: FhirCodeableConcept;
  code: FhirCodeableConcept;
  subject: FhirReference;
  onsetDateTime?: string;
}

export interface FhirObservationReferenceRange {
  low?: FhirQuantity;
  high?: FhirQuantity;
  type?: FhirCodeableConcept;
}

export interface FhirObservation {
  resourceType: 'Observation';
  id: string;
  meta?: FhirMeta;
  status: 'registered' | 'preliminary' | 'final' | 'amended' | 'corrected' | 'cancelled' | 'entered-in-error' | 'unknown';
  category?: FhirCodeableConcept[];
  code: FhirCodeableConcept;
  subject: FhirReference;
  effectiveDateTime?: string;
  valueQuantity?: FhirQuantity;
  referenceRange?: FhirObservationReferenceRange[];
}

export interface FhirDosage {
  sequence?: number;
  text?: string;
  timing?: FhirTiming;
  route?: FhirCodeableConcept;
  doseAndRate?: {
    type?: FhirCodeableConcept;
    doseQuantity?: FhirQuantity;
  }[];
}

export interface FhirMedicationStatement {
  resourceType: 'MedicationStatement';
  id: string;
  meta?: FhirMeta;
  status: 'active' | 'completed' | 'entered-in-error' | 'intended' | 'stopped' | 'on-hold' | 'unknown' | 'not-taken';
  medicationCodeableConcept: FhirCodeableConcept;
  subject: FhirReference;
  effectivePeriod?: FhirPeriod;
  dosage?: FhirDosage[];
  note?: { text: string }[];
}

export interface FhirMedicationRequest {
  resourceType: 'MedicationRequest';
  id: string;
  status?: 'active' | 'on-hold' | 'cancelled' | 'completed' | 'entered-in-error' | 'stopped' | 'draft' | 'unknown';
  medicationCodeableConcept?: FhirCodeableConcept;
  subject?: FhirReference;
  dosageInstruction?: FhirDosage[];
}

export interface FhirGoalTarget {
  measure?: FhirCodeableConcept;
  detailString?: string;
  detailQuantity?: FhirQuantity;
  dueDate?: string;
}

export interface FhirGoal {
  resourceType: 'Goal';
  id: string;
  meta?: FhirMeta;
  lifecycleStatus: 'proposed' | 'planned' | 'accepted' | 'active' | 'on-hold' | 'completed' | 'cancelled' | 'entered-in-error' | 'rejected';
  description: FhirCodeableConcept;
  subject: FhirReference;
  target?: FhirGoalTarget[];
}

export interface FhirCarePlanActivityDetail {
  code?: FhirCodeableConcept;
  status?: 'unknown' | 'scheduled' | 'in-progress' | 'on-hold' | 'completed' | 'cancelled' | 'not-started';
  scheduledTiming?: FhirTiming;
  scheduledString?: string;
  reference?: FhirReference;
  description?: string;
}

export interface FhirCarePlanActivity {
  detail?: FhirCarePlanActivityDetail;
  reference?: FhirReference;
}

export interface FhirCarePlan {
  resourceType: 'CarePlan';
  id: string;
  meta?: FhirMeta;
  status: 'draft' | 'active' | 'on-hold' | 'revoked' | 'completed' | 'entered-in-error' | 'unknown';
  intent: 'proposal' | 'plan' | 'order' | 'option';
  subject: FhirReference;
  addresses?: FhirReference[];
  goal?: FhirReference[];
  activity?: FhirCarePlanActivity[];
  contributor?: FhirReference[];
  note?: { text: string }[];
}

export interface FhirConsentProvision {
  type?: 'permit' | 'deny';
  period?: FhirPeriod;
}

export interface FhirConsent {
  resourceType: 'Consent';
  id: string;
  meta?: FhirMeta;
  status: 'draft' | 'active' | 'inactive' | 'not-done' | 'entered-in-error' | 'unknown';
  scope: FhirCodeableConcept;
  patient: FhirReference;
  provision?: FhirConsentProvision[];
}

export interface FhirProvenanceAgent {
  who: FhirReference;
  role?: FhirCodeableConcept[];
}

export interface FhirProvenance {
  resourceType: 'Provenance';
  id: string;
  meta?: FhirMeta;
  target: FhirReference[];
  recorded: string;
  activity?: FhirCodeableConcept;
  agent: FhirProvenanceAgent[];
}

export interface FhirCompositionSection {
  title: string;
  code: FhirCodeableConcept;
  entry?: FhirReference[];
  text?: { status: 'generated' | 'extensions' | 'additional' | 'empty'; div: string };
}

export interface FhirComposition {
  resourceType: 'Composition';
  id: string;
  meta?: FhirMeta;
  status: 'preliminary' | 'final' | 'amended' | 'entered-in-error';
  type: FhirCodeableConcept;
  subject: FhirReference;
  author: FhirReference[];
  date: string;
  title: string;
  section: FhirCompositionSection[];
}

export interface FhirBundleEntry {
  fullUrl?: string;
  resource?: unknown;
}

export interface FhirBundle {
  resourceType: 'Bundle';
  id?: string;
  type: 'document' | 'message' | 'transaction' | 'batch' | 'history' | 'searchset' | 'collection';
  timestamp?: string;
  entry: FhirBundleEntry[];
}
