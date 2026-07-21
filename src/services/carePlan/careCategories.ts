/**
 * Shared care-category lexicon (Care tab rework).
 *
 * Deterministic keyword → category mapping used to group UC4 priorities,
 * care-plan goals, care-team activities, and considerations into a small
 * set of plain-language buckets so the caregiver is not overwhelmed.
 *
 * Pure functions, no I/O — safe to use from service-layer derivations and
 * view models. Keep caregiver-facing labels free of engineering jargon.
 */

export type CareCategoryKey =
  | 'medication'
  | 'skin_pressure'
  | 'mobility_transfers'
  | 'breathing'
  | 'bowel_bladder'
  | 'feeding_hydration'
  | 'sleep_fatigue'
  | 'therapy'
  | 'pain_comfort'
  | 'responsiveness'
  | 'caregiver_support'
  | 'other';

export interface CareCategory {
  key: CareCategoryKey;
  /** Plain caregiver-facing label. */
  label: string;
  /** Lowercase substrings; first category with any match wins. */
  keywords: string[];
}

/**
 * Matching order is significant: more specific clinical areas are checked
 * before broader ones (e.g. "medication timing fatigue" lands in
 * medication, not sleep_fatigue).
 */
export const CARE_CATEGORIES: CareCategory[] = [
  {
    key: 'medication',
    label: 'Medication',
    keywords: [
      'medication', 'medicine', 'med ', 'dose', 'dosing', 'pill', 'tablet',
      'pharmacy', 'refill', 'prescription', 'baclofen', 'tizanidine',
      'levetiracetam', 'keppra', 'glycopyrrolate', 'oxybutynin', 'albuterol',
    ],
  },
  {
    key: 'skin_pressure',
    label: 'Skin & pressure',
    keywords: [
      'skin', 'pressure', 'seated', 'sitting', 'wheelchair', 'cushion',
      'reposition', 'brace', 'splint', 'redness', 'sore', 'ulcer',
    ],
  },
  {
    key: 'mobility_transfers',
    label: 'Mobility & transfers',
    keywords: [
      'transfer', 'mobility', 'walking', 'walk', 'gait', 'stand', 'standing',
      'lift', 'hoist', 'positioning', 'fall',
    ],
  },
  {
    key: 'breathing',
    label: 'Breathing',
    keywords: [
      'breath', 'respiratory', 'spo2', 'oxygen', 'cough', 'ventilator',
      'bipap', 'suction', 'airway',
    ],
  },
  {
    key: 'bowel_bladder',
    label: 'Bowel & bladder',
    keywords: [
      'bowel', 'bladder', 'constipation', 'urine', 'urinary', 'catheter',
      'diaper', 'toileting', 'stool', 'incontinence',
    ],
  },
  {
    key: 'feeding_hydration',
    label: 'Feeding & hydration',
    keywords: [
      'feeding', 'nutrition', 'hydration', 'swallow', 'dysphagia', 'meal',
      'fluid', 'drink', 'g-tube', 'gtube', 'tube feed', 'appetite', 'diet',
    ],
  },
  {
    key: 'sleep_fatigue',
    label: 'Sleep & fatigue',
    keywords: [
      'sleep', 'fatigue', 'tired', 'energy', 'night', 'rest', 'drowsy',
      'sleepy',
    ],
  },
  {
    key: 'therapy',
    label: 'Therapy & exercise',
    keywords: [
      'therapy', 'exercise', 'rehab', 'stretch', 'range of motion', 'rom',
      'physical therapy', 'occupational', 'speech therapy', ' pt ', ' ot ',
    ],
  },
  {
    key: 'pain_comfort',
    label: 'Pain & comfort',
    keywords: [
      'pain', 'comfort', 'discomfort', 'ache', 'spasm', 'tone', 'spasticity',
      'cramp',
    ],
  },
  {
    key: 'responsiveness',
    label: 'Responsiveness & behavior',
    keywords: [
      'responsive', 'consciousness', 'confusion', 'confused', 'alertness',
      'seizure', 'behavior', 'behaviour', 'mood', 'agitation', 'irritable',
    ],
  },
  {
    key: 'caregiver_support',
    label: 'Caregiver support',
    keywords: [
      'caregiver', 'support', 'stress', 'respite', 'backup', 'overwhelm',
      'burnout',
    ],
  },
  {
    key: 'other',
    label: 'Other',
    keywords: [],
  },
];

export const CARE_CATEGORY_ORDER: CareCategoryKey[] = CARE_CATEGORIES.map(
  (category) => category.key,
);

const BY_KEY = new Map(CARE_CATEGORIES.map((category) => [category.key, category]));

export function careCategoryLabel(key: CareCategoryKey): string {
  return BY_KEY.get(key)?.label ?? 'Other';
}

/**
 * Categorize free text (goal description, activity description, concern
 * text). First category with a keyword match wins; falls back to 'other'.
 */
export function categorizeCareText(text: string | null | undefined): CareCategoryKey {
  const haystack = ` ${(text ?? '').toLowerCase()} `;
  if (haystack.trim().length === 0) return 'other';
  for (const category of CARE_CATEGORIES) {
    for (const keyword of category.keywords) {
      if (haystack.includes(keyword)) return category.key;
    }
  }
  return 'other';
}

/**
 * UC4 template domains are already structured — map them directly instead
 * of keyword-matching card titles.
 */
const UC4_DOMAIN_TO_CATEGORY: Record<string, CareCategoryKey> = {
  medication_timing_context: 'medication',
  medication_adherence_context: 'medication',
  mobility_positioning: 'mobility_transfers',
  fall_context: 'mobility_transfers',
  skin_pressure_prevention_context: 'skin_pressure',
  bowel_bladder_hydration_context: 'bowel_bladder',
  breathing_context: 'breathing',
  responsiveness_context: 'responsiveness',
  caregiver_reported_event_context: 'responsiveness',
  rehab_therapy_context: 'therapy',
  provider_review: 'caregiver_support',
};

export function careCategoryForUc4Domain(domain: string | null | undefined): CareCategoryKey {
  if (!domain) return 'other';
  return UC4_DOMAIN_TO_CATEGORY[domain] ?? 'other';
}

/**
 * UC4 engine focus codes (patient.carePlanFocusCodes) — the only values the
 * rule registry evaluates. Derived from categorized patient context so the
 * engine's care-plan-focus rules can fire for every patient, not just rehab.
 */
const CATEGORY_TO_UC4_FOCUS_CODE: Partial<Record<CareCategoryKey, string>> = {
  skin_pressure: 'SKIN_PRESSURE',
  bowel_bladder: 'BOWEL_BLADDER',
  breathing: 'BREATHING_CONTEXT',
  responsiveness: 'RESPONSIVENESS_CONTEXT',
  therapy: 'REHAB_THERAPY',
};

export function uc4FocusCodeForCategory(key: CareCategoryKey): string | null {
  return CATEGORY_TO_UC4_FOCUS_CODE[key] ?? null;
}
