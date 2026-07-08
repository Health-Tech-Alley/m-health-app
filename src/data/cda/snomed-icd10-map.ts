/**
 * Static SNOMED CT → ICD-10 cross-walk for the planning/33
 * CDA dataset. The dataset has 16 unique SNOMED condition codes + 1
 * allergy code; this map covers all of them with a coarse ICD-10
 * approximation.
 *
 * Strategy:
 *   - Plan D3 (b) — static curated map for the demo. The full UMLS
 *     cross-walk is a fallback (see umls-token-store); for the
 *     dataset this covers 100% of the observed conditions.
 *   - Unknown SNOMED codes fall through to `lookupSnomedToIcd10` which
 *     returns `{ icd10: null, label: null }`. The importer still writes
 *     the SNOMED code to `patient_conditions.snomed_code` so nothing is
 *     lost.
 *   - The 6-digit codes (`108351`, `133782`, `161955`) in the conditions
 *     array are CPT codes leaked through the CDA parser, NOT real SNOMED
 *     conditions. The importer filters these via the
 *     `isRealConditionCode` check.
 *
 * Sources for the cross-walk:
 *   - SNOMED CT → ICD-10CM Map (NLM UMLS, public)
 *   - WHO ICD-10 classification
 *
 * NOTE: This map is intentionally conservative. ICD-10 is less granular
 * than SNOMED CT (multiple SNOMEDs can map to one ICD-10). The reverse
 * direction (ICD-10 → SNOMED) is not unique.
 */

export interface SnomedIcd10Entry {
  icd10: string;
  label: string;
  category: string;
}

export const SNOMED_TO_ICD10: Record<string, SnomedIcd10Entry> = {
  // Spastic quadriplegic cerebral palsy — primary diagnosis
  '48721008': {
    icd10: 'G80.0',
    label: 'Spastic quadriplegic cerebral palsy',
    category: 'Neurologic / Mobility',
  },
  // Spastic CP variants
  '55607006': {
    icd10: 'G80.1',
    label: 'Spastic diplegic cerebral palsy',
    category: 'Neurologic / Mobility',
  },
  // GERD with esophagitis
  '49261000087108': {
    icd10: 'K21.0',
    label: 'GERD with esophagitis',
    category: 'Gastrointestinal',
  },
  // Migraine
  '235595009': {
    icd10: 'G43.909',
    label: 'Migraine, unspecified, not intractable, without status migrainosus',
    category: 'Neurologic',
  },
  // Asthma, unspecified
  '302914006': {
    icd10: 'J45.909',
    label: 'Asthma, unspecified, uncomplicated',
    category: 'Respiratory',
  },
  // Venous insufficiency
  '128053003': {
    icd10: 'I87.2',
    label: 'Venous insufficiency (chronic, peripheral)',
    category: 'Cardiac',
  },
  // Constipation
  '16761005': {
    icd10: 'K59.0',
    label: 'Constipation',
    category: 'Gastrointestinal',
  },
  // Dysphagia
  '49218002': {
    icd10: 'R13.10',
    label: 'Dysphagia, unspecified',
    category: 'Neurologic',
  },
  // Orthostatic hypotension
  '230773005': {
    icd10: 'I95.1',
    label: 'Orthostatic hypotension',
    category: 'Cardiac',
  },
  // Comorbidity codes seen in the dataset
  '88611000119100': {
    icd10: 'E11.9',
    label: 'Type 2 diabetes mellitus without complications',
    category: 'Metabolic',
  },
  '59151000119109': {
    icd10: 'I10',
    label: 'Essential (primary) hypertension',
    category: 'Cardiac',
  },
  '11827861000119109': {
    icd10: 'E78.5',
    label: 'Hyperlipidemia, unspecified',
    category: 'Metabolic',
  },
  '305491000119102': {
    icd10: 'N18.9',
    label: 'Chronic kidney disease, unspecified',
    category: 'Renal',
  },
  // Allergy
  '419199007': {
    icd10: 'T78.40',
    label: 'Allergy, unspecified',
    category: 'Allergy / Immunology',
  },
};

/**
 * Look up a SNOMED code in the static map. Returns `null` for both icd10
 * and label when the code is unknown — callers should keep the SNOMED
 * code on the row even when the cross-walk misses.
 */
export function lookupSnomedToIcd10(snomedCode: string): SnomedIcd10Entry | null {
  if (!snomedCode) return null;
  return SNOMED_TO_ICD10[snomedCode] ?? null;
}

/**
 * Real SNOMED CT codes are ≥7 digits (the shortest valid SNOMED code in
 * clinical use is 7 digits; 6-digit numeric codes in CDA problem lists
 * are usually CPT codes leaked through the parser). Returns true for
 * codes that look like real SNOMED identifiers, false for CPT / status
 * codes / unit codes.
 */
export function isRealSnomedCode(code: string | null | undefined): boolean {
  if (!code) return false;
  // Exclude the CDA "Active" / "Resolved" status pseudo-codes
  if (code === '55561003' || code === '73425007') return false;
  // Real SNOMED CT identifiers are 6-18 digits, but 6-digit codes in
  // this dataset are CPT codes (108351, 133782, 161955) that leaked
  // through the parser. Require ≥7 digits.
  return /^\d{7,18}$/.test(code);
}
