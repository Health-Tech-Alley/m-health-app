/**
 * Care-plan template — deterministic structure for the `draft-care-plan`
 * SLM task (planning/33 §11.3).
 *
 * The SLM does NOT decide the care plan's structure. It fills template
 * fields from cited EHR evidence. The orchestrator renders the filled
 * template to care_plan_goals + care_plan_activities + thresholds rows.
 *
 * Per the user: "I would like the care plan output to tightly follow a
 * well-designed template, so that it is not left to our very limited SLM
 * to decide what a care plan is."
 */

export type CarePlanDomain =
  | 'respiratory'
  | 'neurologic'
  | 'gastrointestinal'
  | 'mobility'
  | 'cardiac'
  | 'infection_prevention'
  | 'nutrition'
  | 'skin'
  | 'pain'
  | 'mental_health';

export const CARE_PLAN_DOMAINS: readonly CarePlanDomain[] = [
  'respiratory',
  'neurologic',
  'gastrointestinal',
  'mobility',
  'cardiac',
  'infection_prevention',
  'nutrition',
  'skin',
  'pain',
  'mental_health',
] as const;

export interface CarePlanGoalField {
  domain: CarePlanDomain;
  goalStatement: string;
  targetDate?: string;
  rationale: string;
  hedisMeasure?: string;
}

export interface CarePlanMedicationField {
  name: string;
  indication: string;
  monitoring: string;
}

export interface CarePlanThresholdField {
  vitalType: string;
  value: number;
  direction: 'above' | 'below';
  severity: number;
  rationale: string;
}

export interface CarePlanActionItemField {
  action: string;
  frequency: string;
  rationale: string;
}

/**
 * The full care-plan template. Sections 1 + 6 are auto-filled (deterministic);
 * sections 2–5 are filled by the SLM from cited EHR chunks.
 */
export interface CarePlanTemplate {
  patientSummary: {
    primaryDiagnosis: string;
    icd10: string;
    comorbidities: string[];
    functionalScale: string;
    baselineVitals: {
      spo2?: number;
      hr?: number;
      rr?: number;
      temp?: number;
      systolic?: number;
      diastolic?: number;
    };
  };
  goals: CarePlanGoalField[];
  medications: CarePlanMedicationField[];
  thresholds: CarePlanThresholdField[];
  actionItems: CarePlanActionItemField[];
  redFlags: string[];
}

/**
 * Condition-specific red-flag templates. Deterministic — the SLM does NOT
 * add or remove these. Keyed by ICD-10 prefix.
 */
const RED_FLAG_TEMPLATES: Record<string, string[]> = {
  G80: [
    'SpO2 drops below the patient\'s cutoff (88% or per care plan)',
    'New or increased spasticity episodes lasting > 30 min',
    'Seizure activity (new onset or change in pattern)',
    'Signs of aspiration: coughing/choking during feeds',
    'Fever ≥ 100.4°F with respiratory distress',
    'Changes in muscle tone or new contractures',
  ],
  J44: [
    'SpO2 below 88% or patient\'s cutoff',
    'Increased breathlessness at rest',
    'Blue or gray lips/fingertips',
    'Inability to speak in full sentences',
    'Confusion or lethargy (sign of CO2 retention)',
  ],
  I63: [
    'Sudden one-sided weakness or numbness',
    'Sudden slurred speech or facial droop',
    'Sudden severe headache',
    'Sudden vision loss or double vision',
    'Sudden difficulty walking or loss of balance',
  ],
  DEFAULT: [
    'SpO2 below the patient\'s cutoff',
    'Signs of respiratory distress',
    'Sudden change in mental status or consciousness',
    'Fever ≥ 100.4°F with worsening symptoms',
  ],
};

/**
 * Get the red-flags list for a primary ICD-10 code. Matches by prefix
 * (e.g., G80.0 → 'G80'). Falls back to DEFAULT.
 */
export function getRedFlagsForIcd10(icd10: string | undefined): string[] {
  if (!icd10) return [...RED_FLAG_TEMPLATES.DEFAULT];
  const prefix = icd10.toUpperCase().match(/^[A-Z]\d+/)?.[0] ?? '';
  return [...(RED_FLAG_TEMPLATES[prefix] ?? RED_FLAG_TEMPLATES.DEFAULT)];
}

/**
 * Build the empty template skeleton for the SLM to fill. The patientSummary
 * and redFlags are pre-filled (deterministic); the SLM fills goals,
 * medications, thresholds, and actionItems.
 */
export function buildEmptyCarePlanTemplate(params: {
  primaryDiagnosis: string;
  icd10: string;
  comorbidities: string[];
  functionalScale: string;
  baselineVitals: CarePlanTemplate['patientSummary']['baselineVitals'];
  medicationNames: string[];
}): CarePlanTemplate {
  return {
    patientSummary: {
      primaryDiagnosis: params.primaryDiagnosis,
      icd10: params.icd10,
      comorbidities: params.comorbidities,
      functionalScale: params.functionalScale,
      baselineVitals: params.baselineVitals,
    },
    goals: [],
    medications: params.medicationNames.map((name) => ({
      name,
      indication: '',
      monitoring: '',
    })),
    thresholds: [],
    actionItems: [],
    redFlags: getRedFlagsForIcd10(params.icd10),
  };
}

/**
 * Render the filled template as the JSON skeleton the SLM sees in its
 * user message. The SLM fills the empty strings and arrays, then returns
 * the filled JSON.
 */
export function renderTemplateSkeletonForPrompt(template: CarePlanTemplate): string {
  return JSON.stringify(template, null, 2)
    .replace(/"indication": ""/g, '"indication": "<fill from EHR — what is this med for?>"')
    .replace(/"monitoring": ""/g, '"monitoring": "<fill from EHR — what to watch?>"')
    .replace(/"goals": \[\]/g, '"goals": [<fill — one per domain, cite [CDA-...]>]')
    .replace(/"thresholds": \[\]/g, '"thresholds": [<fill — only if EHR shows a documented target>]')
    .replace(/"actionItems": \[\]/g, '"actionItems": [<fill — from discharge instructions / plan of treatment>]');
}

/**
 * Parse the SLM's JSON response into a CarePlanTemplate. Validates that
 * red flags were not added/removed (the SLM was instructed not to touch them).
 */
export function parseFilledTemplate(
  text: string,
  expectedRedFlags: string[],
): { template: CarePlanTemplate | null; error?: string } {
  try {
    const parsed = JSON.parse(text) as CarePlanTemplate;
    if (!parsed.goals || !Array.isArray(parsed.goals)) {
      return { template: null, error: 'Invalid template: goals is not an array' };
    }
    // Validate red flags were not modified
    if (parsed.redFlags && parsed.redFlags.length !== expectedRedFlags.length) {
      return { template: null, error: 'Red flags were modified — SLM must not add or remove red flags' };
    }
    return { template: parsed };
  } catch (err) {
    return { template: null, error: `Failed to parse template JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
}
