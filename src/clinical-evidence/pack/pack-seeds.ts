/**
 * Device-wide pack seeds (doc 42).
 * Condition / lit layers keep a wide comorbidity baseline.
 * Medication layers (DailyMed, OpenFDA, DDI live, MedlinePlus drug pages)
 * use the active patient chart only — no global formulary install.
 */

export type PackIcdSeed = { code: string; label: string; match?: RegExp };

/** Wide ICD-10 / topic seeds for MedlinePlus + lit queries. */
export const PACK_ICD_SEEDS: PackIcdSeed[] = [
  { code: 'G80.0', label: 'Cerebral palsy', match: /cerebral\s*palsy|\bcp\b|gmfcs/i },
  { code: 'G80.1', label: 'Spastic diplegic cerebral palsy' },
  { code: 'Q05.9', label: 'Spina bifida', match: /spina\s*bifida|myelomeningocele/i },
  { code: 'G82.20', label: 'Paraplegia' },
  { code: 'G82.50', label: 'Quadriplegia' },
  { code: 'S06.9', label: 'Traumatic brain injury', match: /traumatic\s*brain|\btbi\b|brain injury/i },
  { code: 'I63.9', label: 'Stroke', match: /stroke|cva|cerebrovascular|hemipleg/i },
  { code: 'J44.9', label: 'COPD', match: /copd|emphysema|chronic obstructive/i },
  { code: 'J96.10', label: 'Chronic respiratory failure' },
  { code: 'G40.909', label: 'Epilepsy', match: /epilepsy|seizure/i },
  { code: 'R13.10', label: 'Dysphagia', match: /dysphagia|swallow/i },
  { code: 'J69.0', label: 'Aspiration pneumonia', match: /aspiration/i },
  { code: 'G47.33', label: 'Obstructive sleep apnea' },
  { code: 'M41.9', label: 'Scoliosis', match: /scoliosis/i },
  { code: 'M62.81', label: 'Muscle weakness' },
  { code: 'G81.90', label: 'Hemiplegia' },
  { code: 'N31.9', label: 'Neurogenic bladder', match: /neurogenic\s*bladder|incontinen/i },
  { code: 'K59.00', label: 'Constipation', match: /constipat/i },
  { code: 'L89.90', label: 'Pressure ulcer', match: /pressure|decubitus|bedsore/i },
  { code: 'E43', label: 'Severe malnutrition' },
  { code: 'R63.4', label: 'Abnormal weight loss' },
  { code: 'G93.40', label: 'Encephalopathy' },
  { code: 'Q03.9', label: 'Hydrocephalus', match: /hydrocephalus|shunt/i },
  { code: 'G25.9', label: 'Extrapyramidal movement disorder' },
  { code: 'M79.3', label: 'Panniculitis / soft tissue' },
  { code: 'J18.9', label: 'Pneumonia' },
  { code: 'N39.0', label: 'Urinary tract infection' },
  { code: 'E11.9', label: 'Type 2 diabetes mellitus' },
  { code: 'I10', label: 'Essential hypertension' },
  { code: 'E03.9', label: 'Hypothyroidism' },
  { code: 'F32.9', label: 'Major depressive disorder' },
  { code: 'G47.00', label: 'Insomnia' },
  { code: 'R06.02', label: 'Shortness of breath' },
  { code: 'R00.0', label: 'Tachycardia' },
  { code: 'K21.9', label: 'GERD', match: /gerd|reflux/i },
  { code: 'E55.9', label: 'Vitamin D deficiency' },
  { code: 'G35', label: 'Multiple sclerosis' },
  { code: 'G12.21', label: 'Amyotrophic lateral sclerosis' },
  { code: 'G71.0', label: 'Muscular dystrophy' },
  { code: 'Q90.9', label: 'Down syndrome' },
  { code: 'F84.0', label: 'Autistic disorder' },
  { code: 'Z99.11', label: 'Dependence on respirator' },
  { code: 'Z93.1', label: 'Gastrostomy status', match: /g-?tube|gastrostom/i },
  { code: 'Z99.3', label: 'Dependence on wheelchair' },
];

/** Condition name strings for lit_lite / Orphanet / filtering. */
export const PACK_CONDITION_NAMES: string[] = [
  'cerebral palsy',
  'spina bifida',
  'traumatic brain injury',
  'stroke',
  'COPD',
  'epilepsy',
  'dysphagia',
  'aspiration pneumonia',
  'neurogenic bladder',
  'pressure injury',
  'scoliosis',
  'hydrocephalus',
  'chronic respiratory failure',
  'gastrostomy',
  'autonomic dysreflexia',
  'spasticity',
  'muscular dystrophy',
  'post-stroke rehabilitation',
];

// Extra lit query phrases beyond condition names (caregiver / home-care angle).
export const PACK_LIT_EXTRA_QUERIES: string[] = [
  'caregiver cerebral palsy home care',
  'GMFCS level V respiratory',
  'spina bifida autonomic dysreflexia',
  'neurogenic bladder intermittent catheterization',
  'post stroke dysphagia aspiration',
  'TBI seizure prophylaxis caregiver',
  'COPD exacerbation action plan home',
  'pressure injury wheelchair cushion',
  'gastrostomy tube complications home',
  'home mechanical ventilation caregiver',
  'spasticity baclofen intrathecal',
  'pediatric palliative complex disability',
  'emergency information form disability',
  'aspiration pneumonia prevention disability',
  'caregiver burden severe disability',
];

export function mergeConditionSeeds(patientConditions: string[] = []): string[] {
  const out = new Set<string>();
  for (const c of PACK_CONDITION_NAMES) out.add(c);
  for (const c of patientConditions) {
    const t = c.trim();
    if (t) out.add(t);
  }
  return [...out];
}

/**
 * Active chart medications only (deduped, lowercased).
 * Used by meds_base / openfda / ddi live / MedlinePlus drug pages.
 * Unknown drugs are filled later via on-demand overlay fetch.
 */
export function mergeMedicationSeeds(patientMeds: string[] = []): string[] {
  const out = new Set<string>();
  for (const m of patientMeds) {
    const t = m.trim().toLowerCase();
    if (t) out.add(t);
  }
  return [...out];
}

/** Stable fingerprint of active med names for pack med-layer refresh. */
export function buildMedicationSeedsFingerprint(patientMeds: string[] = []): string {
  return mergeMedicationSeeds(patientMeds).sort().join('\u0001');
}

/** Resolve ICD seeds: always full pack list (global pack), boost patient matches first. */
export function resolvePackIcdSeeds(patientConditions: string[] = []): PackIcdSeed[] {
  const patientHits: PackIcdSeed[] = [];
  for (const c of patientConditions) {
    for (const seed of PACK_ICD_SEEDS) {
      if (seed.match?.test(c)) patientHits.push(seed);
    }
  }
  const seen = new Set<string>();
  const ordered: PackIcdSeed[] = [];
  for (const s of [...patientHits, ...PACK_ICD_SEEDS]) {
    if (seen.has(s.code)) continue;
    seen.add(s.code);
    ordered.push(s);
  }
  return ordered;
}

/** Minimum chunks expected per content layer — below this, re-fetch even if cached. */
export const PACK_LAYER_MIN_CHUNKS: Partial<Record<string, number>> = {
  spine: 8,
  cpg: 8,
  medlineplus: 20,
  orphanet: 3,
  public_health: 4,
  // Patient-scoped med layers: empty chart is valid (0 chunks).
  meds_base: 0,
  // Curated practical pairs alone satisfy ddi floor when offline.
  ddi: 8,
  openfda: 0,
  dme: 4,
  lit_lite: 200,
  sdoh: 0,
};
