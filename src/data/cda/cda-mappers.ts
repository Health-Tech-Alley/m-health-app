/**
 * CDA JSON → app-domain mappers — planning/33 §7–§10.
 *
 * Pure functions that transform a CDA JSON document section into the app's
 * typed objects (`PatientCondition`, `Medication`, `HealthSample`,
 * `KnowledgeChunk`, `CarePlanActivity`, etc.). The importer is responsible
 * for persistence + dedup; the mappers are stateless.
 *
 * Each mapper returns the typed object(s) **without** writing to the DB.
 * This keeps them testable and lets the importer layer dedup / audit /
 * transaction logic on top.
 */

import type {
  HealthSample,
  HealthSampleType,
  KnowledgeChunk,
  PatientCondition,
  PatientLongitudinalObservation,
} from '@/data/types';
import { isRealSnomedCode, lookupSnomedToIcd10 } from './snomed-icd10-map';
import type {
  CdaCarePlanItem,
  CdaEntry,
  CdaFunctionalStatusItem,
  CdaJsonDoc,
  CdaNarrativeSection,
  CdaValue,
  CdaVitalOrganizer,
} from './cda-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick the first non-empty string from a list of candidate fields. */
function firstNonEmpty(...candidates: (string | null | undefined)[]): string | undefined {
  for (const c of candidates) {
    if (c && String(c).trim().length > 0) return String(c).trim();
  }
  return undefined;
}

/** Coerce a CDA PQ value (string | number) to a finite number, or null. */
function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Make a stable, content-derived id slug for dedup / chunk ids. */
function slugify(input: string, max = 60): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
}

/** Combine effective_time.value / low / high into a single ISO-ish string. */
function effectiveTimeToIso(et?: { value?: string | null; low?: string | null; high?: string | null } | string | null): string {
  if (!et) return new Date(0).toISOString();
  if (typeof et === 'string') {
    // "2026" → "2026-01-01T00:00:00Z"; "[DATE IN 2026]" → keep
    if (/^\d{4}$/.test(et)) return `${et}-01-01T00:00:00.000Z`;
    return et;
  }
  const raw = et.value ?? et.low ?? et.high;
  if (!raw) return new Date(0).toISOString();
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01T00:00:00.000Z`;
  return raw;
}

// ---------------------------------------------------------------------------
// Conditions → patient_conditions (planning/33 §7 + §9.3)
// ---------------------------------------------------------------------------

/** Pull the SNOMED-coded condition value out of a CDA act entry. */
export function extractSnomedCode(entry: CdaEntry): string | null {
  for (const v of entry.values ?? []) {
    if (v?.code && isRealSnomedCode(String(v.code))) return String(v.code);
  }
  return null;
}

/**
 * Pull the human-readable display name out of a CDA act entry.
 *
 * Order of preference:
 *   1. `values[].display_name` when the code is a real SNOMED identifier
 *      (filters out the "Active" / "Resolved" status pseudo-codes).
 *   2. `values[].text` (often contains the human-readable name in
 *      encounter diagnoses).
 *   3. The cleaned `text` field (last resort — often noisy).
 *
 * Returns `null` if no useful name is present; callers should fall back
 * to a curated label (e.g. from the SNOMED→ICD-10 map) in that case.
 */
export function extractDisplayText(entry: CdaEntry, snomedHint?: string | null): string | null {
  // Prefer the SNOMED-coded value's display_name or text
  for (const v of entry.values ?? []) {
    const isRealSnomed = v?.code && /^\d{7,18}$/.test(String(v.code)) && v.code !== '55561003';
    const isTargetCode = !snomedHint || String(v.code) === snomedHint;
    if (isRealSnomed && isTargetCode) {
      if (v.display_name && v.display_name.trim().length > 0) return v.display_name.trim();
      if (v.text && v.text.trim().length > 0) return v.text.trim();
    }
  }
  // Fall back to any other value's display_name
  for (const v of entry.values ?? []) {
    if (v?.display_name && v.display_name.trim().length > 0) return v.display_name.trim();
  }
  // Last resort: the `text` field after cleaning redactions
  if (entry.text && entry.text.trim().length > 0) {
    const cleaned = entry.text
      .replace(/\[(ADDRESS|PROVIDER|PHONE|REDACTED|ID|DATE|ZIP|LOCATION) REDACTED\]/gi, '')
      .replace(/\[ID REDACTED\]/g, '')
      .replace(/Organization Redacted/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    // Reject entries that are mostly redactions / provider text — these
    // are not useful as condition names.
    if (cleaned.length > 0 && !/^Critical Care|Provider|Organization/.test(cleaned)) {
      return cleaned;
    }
  }
  return null;
}

/** True if the entry is a real SNOMED condition (filters CPT/unit/status). */
export function isRealConditionEntry(entry: CdaEntry): boolean {
  return extractSnomedCode(entry) !== null;
}

/**
 * Build a stable condition_id for dedup across docs. The plan calls for
 * `(patientId, icd10)` grouping; we additionally fall back to SNOMED when
 * no ICD-10 cross-walk exists. The id is content-derived so re-imports
 * are idempotent.
 */
export function makeConditionId(patientId: string, snomed: string | null, icd10: string | null): string {
  const key = icd10 ?? snomed ?? 'unknown';
  return `cond-${patientId}-${slugify(key)}`;
}

/** Map a CDA condition entry → patient_conditions row. */
export function mapCdaConditionToPatientCondition(
  entry: CdaEntry,
  patientId: string,
  sourceDocId: string,
  isPrimary: boolean,
): PatientCondition | null {
  if (!isRealConditionEntry(entry)) return null;
  const snomed = extractSnomedCode(entry);
  if (!snomed) return null;
  const display = extractDisplayText(entry, snomed);
  const mapping = lookupSnomedToIcd10(snomed);
  // Prefer the curated SNOMED→ICD-10 map label, then the CDA display
  // text, then a generic fallback. The map label is canonical and not
  // subject to the CDA parser noise.
  const name = mapping?.label ?? display ?? `SNOMED ${snomed}`;
  const onsetRaw = entry.effective_time?.low ?? entry.effective_time?.value ?? null;
  const onsetDate = onsetRaw && /^\d{4}$/.test(onsetRaw) ? `${onsetRaw}-01-01` : onsetRaw;
  return {
    conditionId: makeConditionId(patientId, snomed, mapping?.icd10 ?? null),
    patientId,
    name,
    icd10: mapping?.icd10 ?? undefined,
    snomedCode: snomed,
    onsetDate: onsetDate ?? undefined,
    category: mapping?.category ?? 'Other',
    isPrimary,
    // CDA-imported conditions are confirmed (they came from the medical
    // record, not from MedlinePlus suggestions). The Caregiver can
    // dismiss them later via the existing UI.
    source: 'ccda_import',
    sourceDocId,
    retrievedAt: new Date().toISOString(),
    needsReview: false,
  };
}

// ---------------------------------------------------------------------------
// Medications → medications (planning/33 §8.2)
// ---------------------------------------------------------------------------

const KNOWN_DRUG_TOKENS = [
  // Common CP / post-stroke / general adult drug names observed in the
  // EHR case + a representative set of SNOMED-coded drugs.
  'baclofen', 'levetiracetam', 'omeprazole', 'polyethylene', 'glycol',
  'pantoprazole', 'lansoprazole', 'ondansetron', 'gabapentin', 'sertraline',
  'fluoxetine', 'escitalopram', 'amitriptyline', 'lorazepam', 'clonazepam',
  'diazepam', 'risperidone', 'aripiprazole', 'quetiapine', 'haloperidol',
  'benztropine', 'trihexyphenidyl', 'tizanidine', 'dantrolene',
  'hydromorphone', 'dilaudid', 'morphine', 'oxycodone', 'acetaminophen',
  'ibuprofen', 'naproxen', 'aspirin', 'warfarin', 'apixaban', 'rivaroxaban',
  'metoprolol', 'atenolol', 'carvedilol', 'lisinopril', 'losartan',
  'amlodipine', 'hydrochlorothiazide', 'furosemide', 'spironolactone',
  'simvastatin', 'atorvastatin', 'rosuvastatin', 'metformin', 'glipizide',
  'insulin', 'levothyroxine', 'albuterol', 'fluticasone', 'montelukast',
  'budesonide', 'ipratropium', 'tiotropium', 'azithromycin',
  'amoxicillin', 'ciprofloxacin', 'cephalexin', 'doxycycline',
  'tramadol', 'cyclobenzaprine', 'melatonin', 'diphenhydramine',
  'isolyte', 'plasma-lyte', 'saline', 'dextrose',
  'contrast', 'propofol', 'midazolam', 'fentanyl', 'ketamine',
  'rocuronium', 'succinylcholine', 'prochlorperazine',
  // Topical preparations
  'capsaicin', 'lidocaine', 'silver', 'sulfadiazine', 'mupirocin',
  'hydrocortisone', 'triamcinolone', 'clobetasol', 'betamethasone',
  // Eye drops
  'artificial', 'tears', 'erythromycin', 'ointment', 'neomycin',
  // Common supplements / OTC
  'multivitamin', 'vitamin', 'calcium', 'cholecalciferol',
  'ferrous', 'sulfate', 'tylenol', 'motrin',
];

/**
 * Try to extract a clean drug name from the noisy CDA `text` field. The
 * CDA med text varies wildly in this dataset:
 *   - Real drugs:     "Oral HYDROmorphone (DILAUDID) injection 0.5 mg Severe pain (7-10)"
 *   - Encounter noise: "Oral [ADDRESS REDACTED] [PROVIDER REDACTED] Organization Redacted ..."
 *   - Bare routes:    "Oral"
 *   - Department markers: "Oral Family Medicine ..."
 *
 * Returns `null` when the text is too noisy to extract a confident drug
 * name — the importer then skips the entry, avoiding the pile-up of
 * meaningless "Oral" / "Topical" / "Family Medicine" rows.
 */
export function extractDrugName(entry: CdaEntry): string | null {
  const text = entry.text ?? '';

  // Strip redactions
  const cleaned = text
    .replace(/\[(ADDRESS|PROVIDER|PHONE|REDACTED|ID|DATE|ZIP|LOCATION) REDACTED\]/gi, '')
    .replace(/\[ID REDACTED\]/g, '')
    .replace(/Organization Redacted/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Strategy 1: match against a known-drug token list (the most
  // accurate signal we have for this dataset)
  for (const token of KNOWN_DRUG_TOKENS) {
    const idx = cleaned.toLowerCase().indexOf(token.toLowerCase());
    if (idx !== -1) {
      // Pull the surrounding word boundary
      const wordMatch = cleaned
        .slice(Math.max(0, idx - 2))
        .match(/[A-Za-z][A-Za-z\-]{2,}/);
      if (wordMatch) {
        return wordMatch[0].charAt(0).toUpperCase() + wordMatch[0].slice(1);
      }
      return token.charAt(0).toUpperCase() + token.slice(1);
    }
  }

  // Strategy 2: bare route or department name → not a real medication
  const departmentNoise = [
    'family medicine', 'gastroenterology', 'plastic surgery',
    'anesthesiology', 'imaging', 'pharmacist', 'internal medicine',
    'cardiology', 'neurology', 'pulmonology', 'orthopedics',
    'dermatology', 'endocrinology', 'hematology', 'nephrology',
    'oncology', 'psychiatry', 'radiology', 'rheumatology',
    'urology', 'otolaryngology', 'ophthalmology',
  ];
  const lowerCleaned = cleaned.toLowerCase();
  if (departmentNoise.some((d) => lowerCleaned.includes(d))) return null;
  if (/^(Oral|Subcutaneous|Intravenous|Topical|Intramuscular|Sublingual|Buccal|Rectal|Inhaled|Nasal|Ophthalmic|Auricular)\s*$/i.test(cleaned)) {
    return null; // bare route with no drug
  }

  // Strategy 3: a real drug line often starts with a known route
  // ("Oral HYDROmorphone", "Subcutaneous Heparin", ...) — the SECOND
  // capitalized token is the drug.
  const routeMatch = cleaned.match(
    /^(Oral|Subcutaneous|Intravenous|Topical|Intramuscular|Sublingual|Buccal|Rectal|Inhaled|Nasal|Ophthalmic|Auricular)\s+([A-Z][A-Za-z\-]{2,})/,
  );
  if (routeMatch) {
    const candidate = routeMatch[2];
    // Reject department-marker second words
    if (departmentNoise.some((d) => candidate.toLowerCase().includes(d.split(' ')[0]))) return null;
    return candidate;
  }

  // Strategy 4: take the first 60 chars of cleaned text as a label
  // (last resort — only if we have a real drug-looking string).
  if (cleaned.length >= 5) {
    return cleaned.slice(0, 60).trim();
  }
  return null;
}

/** Stable medication_id for dedup across docs. */
export function makeMedicationId(patientId: string, name: string): string {
  return `med-${patientId}-${slugify(name)}`;
}

export interface MappedMedication {
  medicationId: string;
  patientId: string;
  name: string;
  dosage?: string | null;
  frequency?: string | null;
  route?: string | null;
  indication?: string | null;
  active: boolean;
  source: 'ccda_import';
}

export function mapCdaMedication(
  entry: CdaEntry,
  patientId: string,
  _sourceDocId: string,
): MappedMedication | null {
  const name = extractDrugName(entry);
  if (!name) return null;
  // Heuristic: drop obviously non-drug department markers. The route
  // + 1st word pattern catches many of these (e.g. "Oral Family
  // Medicine"); the noise filter below excludes them when the word is
  // a known department / clinical service term.
  const lower = name.toLowerCase();
  const departmentNoise = [
    'family medicine', 'gastroenterology', 'plastic surgery',
    'anesthesiology', 'imaging', 'pharmacist', 'internal medicine',
    'cardiology', 'neurology', 'pulmonology', 'orthopedics',
    'dermatology', 'endocrinology', 'hematology', 'nephrology',
    'oncology', 'psychiatry', 'radiology', 'rheumatology',
    'urology', 'otolaryngology', 'ophthalmology',
  ];
  if (departmentNoise.some((d) => lower.includes(d))) return null;
  // Cap to the first 30 chars to keep `name` clean
  const cleanName = name.length > 30 ? name.slice(0, 30).trim() : name;
  const route = firstNonEmpty(
    (entry.text ?? '').match(/^(Oral|Subcutaneous|Intravenous|Topical|Intramuscular|Sublingual|Buccal|Rectal|Inhaled|Nasal|Ophthalmic|Auricular)/i)?.[0],
  ) ?? null;
  return {
    medicationId: makeMedicationId(patientId, cleanName),
    patientId,
    name: cleanName,
    dosage: null,
    frequency: null,
    route,
    indication: entry.source_section_title ?? null,
    active: entry.status === 'active' || !entry.status,
    source: 'ccda_import',
  };
}

// ---------------------------------------------------------------------------
// Vitals → health_samples (planning/33 §9.2)
// ---------------------------------------------------------------------------

type VitalType = HealthSampleType;

/** Map one CDA vital organizer → 0..N health_samples. */
export function mapCdaVitalOrganizer(
  org: CdaVitalOrganizer,
  patientId: string,
  sourceDocId: string,
): HealthSample[] {
  const samples: HealthSample[] = [];
  const recordedAt = effectiveTimeToIso(org.effective_time);
  const values = org.values ?? [];
  const now = new Date().toISOString();
  let bpIndex = 0;
  let rateIndex = 0;
  let heightSeen = false;
  let counter = 0;

  for (const v of values as CdaValue[]) {
    if (!v || v.xsi_type !== 'PQ') continue;
    const value = toNumber(v.value);
    if (value == null) continue;
    let type: VitalType | null = null;
    if (v.unit === 'mm[Hg]') {
      type = bpIndex === 0 ? 'blood_pressure_systolic' : 'blood_pressure_diastolic';
      bpIndex++;
    } else if (v.unit === '/min') {
      type = rateIndex === 0 ? 'heart_rate' : 'respiratory_rate';
      rateIndex++;
    } else if (v.unit === '%') {
      type = 'spo2';
    } else if (v.unit === 'Cel') {
      type = 'temperature';
    } else if (v.unit === 'kg' && !heightSeen) {
      type = 'weight';
    } else if (v.unit === 'kg/m2') {
      // BMI — we don't have a dedicated health_samples type, drop it.
      // It's not used by the AE feature vector; if a future use-case
      // needs BMI we can extend the HealthSampleType union.
      continue;
    } else if (v.unit === 'cm') {
      type = 'height';
      heightSeen = true;
    }
    if (!type) continue;
    counter++;
    const sampleId = `vs-${sourceDocId}-${type}-${recordedAt.slice(0, 10)}-${counter}`;
    samples.push({
      sampleId,
      patientId,
      source: 'fhir', // CDA-derived vitals share the FHIR ingestion pipeline
      type,
      value,
      unit: v.unit ?? '',
      recordedAt,
      receivedAt: now,
      sourceDocId,
    });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Narrative sections → knowledge_cache chunks (planning/33 §9.1, D4)
// ---------------------------------------------------------------------------

/** Cap a single chunk to a reasonable prompt-injection size. */
const MAX_CHUNK_CHARS = 5000;

function makeChunkId(sourceDocId: string, sectionTitle: string): string {
  return `CDA-${sourceDocId}-${slugify(sectionTitle)}`;
}

/**
 * Combine a narrative_sections, care_plan, and functional_status item
 * into a single knowledge_cache chunk. The chunk is BM25-indexed and
 * citable from the SLM.
 */
export function mapCdaSectionToKnowledgeChunk(
  item: { source_section_title?: string | null; source_section_code?: { code?: string | null; code_system?: string | null } | null; narrative_text?: string | null },
  sourceDocId: string,
  patientId: string,
): KnowledgeChunk | null {
  const title = firstNonEmpty(item.source_section_title) ?? 'Untitled';
  const rawText = (item.narrative_text ?? '').trim();
  if (rawText.length < 20) return null; // skip empty / pure-noise
  const text = rawText.length > MAX_CHUNK_CHARS
    ? `${rawText.slice(0, MAX_CHUNK_CHARS)}…`
    : rawText;
  const lengthTier: 'short' | 'medium' | 'long' = text.length > 2000 ? 'long' : text.length > 500 ? 'medium' : 'short';
  return {
    chunkId: makeChunkId(sourceDocId, title),
    source: 'synthetic', // close enough — T1 router will retrieve by content
    text: `[${title}]\n${text}`,
    conditions: 'EHR',
    retrievedAt: new Date().toISOString(),
    useCount: 0,
    documentType: 'guideline', // treat as a deep doc tier (T3) per D4
    lengthTier,
    sectionHeading: title,
    metadataJson: JSON.stringify({
      docId: sourceDocId,
      sectionCode: item.source_section_code?.code ?? null,
      sectionCodeSystem: item.source_section_code?.code_system ?? null,
      patientId,
      kind: 'cda_narrative',
    }),
  };
}

/** Map a CDA document's narrative sections, care_plan, and functional_status
 *  → knowledge_cache chunks. Dedup is handled by the importer (stable
 *  chunkId → idempotent upsert). */
export function mapCdaDocToKnowledgeChunks(
  cda: CdaJsonDoc,
  patientId: string,
  sourceDocId: string,
): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  const narrative = cda.narrative_sections ?? [];
  for (const section of narrative as CdaNarrativeSection[]) {
    const chunk = mapCdaSectionToKnowledgeChunk(
      {
        source_section_title: section.title,
        source_section_code: section.code,
        narrative_text: section.narrative_text,
      },
      sourceDocId,
      patientId,
    );
    if (chunk) chunks.push(chunk);
  }
  const carePlan = cda.care_plan ?? [];
  for (const item of carePlan as CdaCarePlanItem[]) {
    const chunk = mapCdaSectionToKnowledgeChunk(item, sourceDocId, patientId);
    if (chunk) chunks.push(chunk);
  }
  const fs = cda.functional_status ?? [];
  for (const item of fs as CdaFunctionalStatusItem[]) {
    const chunk = mapCdaSectionToKnowledgeChunk(item, sourceDocId, patientId);
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Care plan narrative → care_plan + care_plan_activities (planning/33 §10)
// ---------------------------------------------------------------------------

/**
 * Map a CDA care_plan narrative section → a list of `CarePlanActivity`
 * rows. We use the narrative_text as a single activity per section (the
 * narrative is too free-form to split into discrete activities). The
 * importer then writes these under a single `care_plans` row.
 */
export function mapCdaCarePlanSectionToActivities(
  item: CdaCarePlanItem,
  planId: string,
  sequence: number,
): { activityId: string; planId: string; status?: string | null; description?: string | null; sequence: number }[] {
  const text = (item.narrative_text ?? '').trim();
  if (text.length < 20) return [];
  const title = firstNonEmpty(item.source_section_title) ?? 'Plan of Treatment';
  return [
    {
      activityId: `${planId}-act-${sequence}`,
      planId,
      status: 'active',
      description: `${title}: ${text.slice(0, MAX_CHUNK_CHARS)}`,
      sequence,
    },
  ];
}

// ---------------------------------------------------------------------------
// Functional status → patient_longitudinal_observations (planning/33 §10.3)
// ---------------------------------------------------------------------------

/**
 * Functional status sections often contain Q&A rows that capture pain
 * scores, behavioral assessments, etc. We extract numeric pain scores
 * when present and write them as `pain_score` longitudinal
 * observations. The narrative itself is captured as a
 * `text_value` on a single `functional_status` observation.
 */
export interface MappedLongitudinalObservation {
  observationId: string;
  measurementType: PatientLongitudinalObservation['measurementType'];
  recordedAt: string;
  numericValue?: number | null;
  textValue?: string | null;
  unit?: string | null;
  sourceSystem?: string | null;
  sourceCode: string;
  sourceType: 'fhir';
}

export function mapCdaFunctionalStatusToObservations(
  item: CdaFunctionalStatusItem,
  sourceDocId: string,
  patientId: string,
  recordedAt: string,
): MappedLongitudinalObservation[] {
  const out: MappedLongitudinalObservation[] = [];
  // The Q&A tables are noisy (repetitive rows). Pull a single
  // representative pain score if we can find one.
  const tables = item.tables ?? [];
  let painScore: number | null = null;
  for (const t of tables) {
    for (const row of t.rows ?? []) {
      const keys = Object.keys(row);
      const painKey = keys.find((k) => /pain/i.test(k));
      if (painKey) {
        const v = toNumber(row[painKey]);
        if (v != null) {
          painScore = v;
          break;
        }
      }
    }
    if (painScore != null) break;
  }
  const baseId = `${sourceDocId}-${slugify(item.source_section_title ?? 'functional', 30)}`;
  if (painScore != null) {
    out.push({
      observationId: `${baseId}-pain-${recordedAt.slice(0, 10)}`,
      measurementType: 'pain_score',
      recordedAt,
      numericValue: painScore,
      textValue: null,
      unit: '0-10',
      sourceSystem: 'SNOMED CT',
      sourceCode: '225908003', // Pain score (observable entity)
      sourceType: 'fhir',
    });
  }
  // Always persist the narrative text as a free-text observation so the
  // SLM can cite it via the longitudinal block.
  const narrative = (item.narrative_text ?? '').trim();
  if (narrative.length >= 20) {
    out.push({
      observationId: `${baseId}-narrative`,
      measurementType: 'pain_score', // bucket for the functional status
      recordedAt,
      numericValue: null,
      textValue: narrative.slice(0, MAX_CHUNK_CHARS),
      unit: null,
      sourceSystem: 'SNOMED CT',
      sourceCode: '47420-5', // Functional Status (LOINC section code)
      sourceType: 'fhir',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Encounter → appointments (lightweight)
// ---------------------------------------------------------------------------

/**
 * Map a CDA encounter → a lightweight appointment row. Only used for
 * ED/AMB visits that are date-stampable. This feeds the More → Schedule
 * tab and the ED-utilization prediction (Aim 1, doc 21).
 */
export interface MappedEncounter {
  appointmentId: string;
  patientId: string;
  type: string;
  provider?: string | null;
  date: string; // yyyy-mm-dd
  time?: string | null;
  location?: string | null;
  reason?: string | null;
  reminder?: string | null;
  status: 'completed';
  sourceDocId: string;
}

export function mapCdaEncounterToAppointment(
  encounter: CdaEntry,
  sourceDocId: string,
  patientId: string,
): MappedEncounter | null {
  const date = effectiveTimeToIso(encounter.effective_time).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const code = encounter.code?.code ?? 'unknown';
  const typeMap: Record<string, string> = {
    AMB: 'Ambulatory',
    ED: 'Emergency',
    IMP: 'Inpatient',
    ACUTE: 'Acute Care',
    HH: 'Home Health',
  };
  const type = typeMap[code] ?? encounter.code?.display_name ?? code;
  // Reason is a SNOMED value in the encounter
  let reason: string | null = null;
  for (const v of encounter.values ?? []) {
    if (v?.code && isRealSnomedCode(String(v.code))) {
      const txt = firstNonEmpty(v.display_name, v.text) ?? `SNOMED ${v.code}`;
      if (!reason) reason = txt;
    }
  }
  return {
    appointmentId: `apt-${sourceDocId}`,
    patientId,
    type,
    provider: null,
    date,
    time: null,
    location: null,
    reason,
    reminder: null,
    status: 'completed',
    sourceDocId,
  };
}
