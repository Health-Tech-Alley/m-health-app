/**
 * Shared clinical-knowledge retrieval helper for SLM screens.
 *
 * Provides a lightweight way to inject pre-bundled knowledge-cache chunks
 * (PubMed abstracts, MedlinePlus topics, RxNorm/DailyMed/OpenFDA data) into
 * SLM prompts as cited context. Uses `searchKnowledgeCache` (LIKE-based,
 * synchronous, no BM25 index needed) so it works from any screen without
 * constructing a full CachedFusedRetriever.
 *
 * Used by:
 *   - ML Care Analysis SLM (condition + anomaly type + top features)
 *   - Safety considerations SlmInsightSheet (condition + safety note)
 *   - Assistant tab (opt-in: condition/med keyword detection)
 */

import { searchKnowledgeCache, type KnowledgeChunk } from '@/data';
import type { FusedRetriever } from '@/knowledge/types';

export interface RetrievedCitation {
  docId: string;
  source: string;
  text: string;
}

/**
 * Retrieve up to `limit` knowledge-cache chunks matching the given query
 * terms. Returns them as cited chunks ready for prompt injection.
 */
export function retrieveClinicalChunks(
  query: string,
  limit = 5,
): RetrievedCitation[] {
  if (!query.trim()) return [];
  try {
    const chunks = searchKnowledgeCache(query, limit);
    return chunks.map((c: KnowledgeChunk) => ({
      docId: c.chunkId,
      source: c.source,
      text: c.text,
    }));
  } catch {
    return [];
  }
}

const SOURCE_LABELS: Record<string, string> = {
  pubmed: 'PubMed',
  medlineplus: 'MedlinePlus',
  dailymed: 'Drug Label',
  openfda: 'FDA Safety',
  clinicaltrials: 'Clinical Trial',
  orphanet: 'Rare Disease',
  umls: 'UMLS',
  'cdc-places': 'SDOH',
  semmeddb: 'SemMedDB',
  hedis: 'HEDIS',
  synthetic: 'Reference',
  'patient-plan': 'Care Plan',
  rxnorm: 'RxNorm',
};

/**
 * Format retrieved chunks as a prompt block the SLM can cite. Returns a string
 * suitable for injection into the system or user prompt.
 *
 * Example output:
 *   CLINICAL KNOWLEDGE (cited — use [Source] to reference)
 *   [PubMed] Abstract text...
 *   [MedlinePlus] Health topic summary...
 *   [FDA Safety] Adverse event report...
 */
export function formatCitationsForPrompt(citations: RetrievedCitation[]): string {
  if (citations.length === 0) return '';
  const lines = ['CLINICAL KNOWLEDGE (cited — use [Source] to reference)'];
  for (const c of citations) {
    const maxLen = 1500;
    const text = c.text.length > maxLen ? c.text.slice(0, maxLen) + '…' : c.text;
    const label = SOURCE_LABELS[c.source] ?? c.source;
    lines.push(`[${label}] ${text}`);
  }
  return lines.join('\n');
}

/**
 * Build a retrieval query from a condition + contextual terms (anomaly type,
 * features, safety note, etc.). Joens them into a single search string.
 */
export function buildRetrievalQuery(
  condition: string | undefined,
  ...contextTerms: string[]
): string {
  const parts = [condition, ...contextTerms].filter((p): p is string =>
    Boolean(p?.trim()),
  );
  return parts.join(' ');
}

/**
 * Extract the drug name from a medication string.
 * Medication strings are typically formatted as "{Drug Name} {dosage} {form} {frequency}"
 * e.g., "Prednisone 10mg tablet daily" → "Prednisone"
 */
function extractDrugName(medication: string): string {
  // Split on the first occurrence of a number followed by a unit (dosage pattern)
  const parts = medication.split(/\s+(?=\d+(?:mg|mcg|g|ml|unit|units|iu))/i);
  return parts[0].trim();
}

/**
 * Common medical abbreviations and their expansions.
 * Used to match user queries against clinical condition names.
 */
const MEDICAL_ABBREVIATIONS: Record<string, string[]> = {
  copd: ['chronic obstructive pulmonary disease', 'chronic obstructive'],
  tbi: ['traumatic brain injury', 'brain injury'],
  cp: ['cerebral palsy'],
  sb: ['spina bifida'],
  htn: ['hypertension', 'high blood pressure'],
  dm: ['diabetes mellitus', 'diabetes'],
  chf: ['congestive heart failure', 'heart failure'],
  afib: ['atrial fibrillation'],
  ckd: ['chronic kidney disease', 'kidney disease'],
  cad: ['coronary artery disease'],
  pvd: ['peripheral vascular disease'],
  dvt: ['deep vein thrombosis'],
  pe: ['pulmonary embolism'],
  mi: ['myocardial infarction', 'heart attack'],
  cva: ['cerebrovascular accident', 'stroke'],
};

/**
 * General clinical terms that suggest the user wants clinical knowledge.
 * These trigger retrieval even without specific condition/medication names.
 */
const CLINICAL_CONTEXT_TERMS = [
  'side effect',
  'side effects',
  'adverse effect',
  'adverse effects',
  'reaction',
  'reactions',
  'symptom',
  'symptoms',
  'treatment',
  'treatments',
  'therapy',
  'therapies',
  'medication',
  'medications',
  'drug interaction',
  'drug interactions',
  'contraindication',
  'contraindications',
  'warning',
  'warnings',
  'precaution',
  'precautions',
  'dosage',
  'dose',
  'dosing',
  'overdose',
  'toxicity',
  'allergy',
  'allergies',
  'allergic reaction',
  'diagnosis',
  'prognosis',
  'complication',
  'complications',
  'risk factor',
  'risk factors',
  'prevention',
  'management',
  'monitoring',
  'follow-up',
  'follow up',
];

/**
 * Check whether a free-text user message contains any of the patient's
 * condition or medication names — used by the Assistant tab to decide whether
 * to trigger retrieval (opt-in, to avoid latency on non-clinical questions).
 *
 * Also checks for:
 * - Common medical abbreviations (COPD, TBI, etc.)
 * - General clinical context terms (symptom, side effect, treatment, etc.)
 */
export function messageHasClinicalKeywords(
  message: string,
  conditions: string[],
  medications: string[],
): boolean {
  const lower = message.toLowerCase();

  // Check for exact condition name matches
  if (conditions.some((c) => lower.includes(c.toLowerCase()))) {
    return true;
  }

  // Check for medication name matches (extract drug name from full string)
  if (
    medications.some((m) => {
      const drugName = extractDrugName(m);
      return lower.includes(drugName.toLowerCase());
    })
  ) {
    return true;
  }

  // Check for medical abbreviations that match conditions
  for (const [abbr, expansions] of Object.entries(MEDICAL_ABBREVIATIONS)) {
    if (lower.includes(abbr)) {
      // Check if any expansion matches a condition
      for (const expansion of expansions) {
        if (conditions.some((c) => c.toLowerCase().includes(expansion))) {
          return true;
        }
      }
    }
  }

  // Check for general clinical context terms
  if (CLINICAL_CONTEXT_TERMS.some((term) => lower.includes(term))) {
    return true;
  }

  return false;
}

export async function retrieveClinicalChunksViaBm25(
  retriever: FusedRetriever | null,
  query: string,
  limit = 5,
): Promise<RetrievedCitation[]> {
  if (!retriever || !query.trim()) return retrieveClinicalChunks(query, limit);
  try {
    const result = await retriever.retrieve({ intent: query, conditions: [], activeMeds: [] });
    return result.chunks.slice(0, limit).map((c) => ({
      docId: c.docId,
      source: String(c.source),
      text: c.text,
    }));
  } catch {
    return retrieveClinicalChunks(query, limit);
  }
}
