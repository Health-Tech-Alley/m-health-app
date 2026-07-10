/**
 * Shared clinical-knowledge retrieval helper for SLM screens.
 *
 * Provides a lightweight way to inject pre-bundled knowledge-cache chunks
 * (PubMed abstracts, MedlinePlus topics, RxNorm/DailyMed/OpenFDA data) into
 * SLM prompts as cited context.
 *
 * Detection is intentionally *structural*, not a long list of hard-coded
 * phrases: token overlap with patient conditions/meds, question shape, and
 * clinical domain signals. Retrieval uses multi-token OR search so full
 * sentences still hit the cache (a single LIKE '%whole sentence%' almost
 * never matches).
 *
 * Used by:
 *   - ML Care Analysis SLM (condition + anomaly type + top features)
 *   - Safety considerations SlmInsightSheet (condition + safety note)
 *   - Assistant tab (opt-in clinical intent detection)
 */

import { searchKnowledgeCache, type KnowledgeChunk } from '@/data';
import type { FusedRetriever } from '@/knowledge/types';

export interface RetrievedCitation {
  docId: string;
  source: string;
  text: string;
}

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'then',
  'so',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'with',
  'without',
  'about',
  'from',
  'by',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'doing',
  'have',
  'has',
  'had',
  'having',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'he',
  'she',
  'they',
  'them',
  'their',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'what',
  'which',
  'who',
  'whom',
  'when',
  'where',
  'why',
  'how',
  'can',
  'could',
  'should',
  'would',
  'will',
  'may',
  'might',
  'must',
  'please',
  'tell',
  'give',
  'get',
  'need',
  'know',
  'like',
  'just',
  'also',
  'very',
  'more',
  'some',
  'any',
  'all',
  'not',
  'no',
  'yes',
  'her',
  'his',
  'him',
]);

/** Common medical abbreviations → expansions for matching patient conditions. */
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
  mi: ['myocardial infarction', 'heart attack'],
  cva: ['cerebrovascular accident', 'stroke'],
  uti: ['urinary tract infection'],
  ad: ['autonomic dysreflexia'],
};

/**
 * Domain stems that suggest clinical information-seeking (not exhaustive
 * phrases). Matched as whole tokens or prefixes so we don't hard-code every
 * topic that might appear in the knowledge cache.
 */
const CLINICAL_TOKEN_STEMS = [
  'symptom',
  'side',
  'adverse',
  'react',
  'treat',
  'therap',
  'medic',
  'drug',
  'dose',
  'dosing',
  'overdose',
  'toxic',
  'allerg',
  'diagnos',
  'prognos',
  'complic',
  'risk',
  'prevent',
  'manage',
  'monitor',
  'follow',
  'warn',
  'precaution',
  'contraindic',
  'interact',
  'evidence',
  'literatur',
  'guideline',
  'study',
  'studies',
  'pubmed',
  'clinical',
  'caregiver',
  'exacerbat',
  'flare',
  'emergenc',
  'oxygen',
  'spo2',
  'respirat',
  'breath',
  'bladder',
  'bowel',
  'autonomic',
  'dysreflex',
  'neurogenic',
  'seizure',
  'infection',
  'fever',
  'pain',
  'mobility',
  'rehab',
  'stroke',
  'pulm',
  'cardio',
  'neural',
  'spinal',
  'bifida',
  'copd',
];

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
 * Tokenize free text into content tokens (lowercase, strip punctuation,
 * drop stopwords and very short tokens).
 */
export function extractContentTokens(text: string): string[] {
  if (!text?.trim()) return [];
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9\s%-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const t of raw) {
    if (t.length < 3 && !/^\d/.test(t)) continue;
    if (STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * Extract the drug name from a medication string.
 * e.g., "Prednisone 10mg tablet daily" → "Prednisone"
 */
function extractDrugName(medication: string): string {
  const parts = medication.split(/\s+(?=\d+(?:mg|mcg|g|ml|unit|units|iu))/i);
  return parts[0].trim();
}

function tokensFromLabels(labels: string[]): string[] {
  const set = new Set<string>();
  for (const label of labels) {
    for (const t of extractContentTokens(label)) set.add(t);
    // Multi-word conditions: also keep bigrams lightly via individual tokens
  }
  return [...set];
}

function messageMentionsLabel(messageLower: string, label: string): boolean {
  const l = label.toLowerCase().trim();
  if (!l) return false;
  if (messageLower.includes(l)) return true;
  // Partial multi-word: all significant tokens appear somewhere
  const labelTokens = extractContentTokens(l);
  if (labelTokens.length === 0) return false;
  if (labelTokens.length === 1) {
    return messageLower.includes(labelTokens[0]);
  }
  // Require at least 2 distinctive tokens for multi-word conditions
  // (e.g. "spina" + "bifida", or "neurogenic" + "bladder")
  const hits = labelTokens.filter((t) => messageLower.includes(t));
  return hits.length >= Math.min(2, labelTokens.length);
}

function tokenMatchesClinicalStem(token: string): boolean {
  return CLINICAL_TOKEN_STEMS.some(
    (stem) => token === stem || token.startsWith(stem) || stem.startsWith(token),
  );
}

/**
 * Structural clinical-intent detector.
 *
 * Triggers retrieval when the message looks like a clinical question *or*
 * overlaps the patient's conditions/meds — without requiring every possible
 * phrase to be hard-coded.
 */
export function messageHasClinicalKeywords(
  message: string,
  conditions: string[],
  medications: string[],
): boolean {
  const lower = message.toLowerCase().trim();
  if (!lower) return false;

  // 1) Exact / partial condition mention
  if (conditions.some((c) => messageMentionsLabel(lower, c))) {
    return true;
  }

  // 2) Medication / drug name mention
  if (
    medications.some((m) => {
      const drugName = extractDrugName(m);
      return messageMentionsLabel(lower, drugName) || messageMentionsLabel(lower, m);
    })
  ) {
    return true;
  }

  // 3) Abbreviations that expand to a known patient condition
  for (const [abbr, expansions] of Object.entries(MEDICAL_ABBREVIATIONS)) {
    if (!new RegExp(`\\b${abbr}\\b`, 'i').test(lower)) continue;
    for (const expansion of expansions) {
      if (conditions.some((c) => c.toLowerCase().includes(expansion))) {
        return true;
      }
      // Also fire if the user typed the abbreviation and we have any conditions
      // (e.g. "SB" with Spina bifida patient) — already covered by expansion match.
    }
    // User typed a known clinical abbreviation even if conditions list is empty
    // (still likely wants clinical knowledge)
    if (conditions.length === 0) return true;
  }

  const tokens = extractContentTokens(lower);

  // 4) Token overlap with condition / med vocabulary (generic, not phrase-based)
  const clinicalVocab = new Set([
    ...tokensFromLabels(conditions),
    ...tokensFromLabels(medications.map(extractDrugName)),
  ]);
  if (tokens.some((t) => clinicalVocab.has(t))) {
    return true;
  }

  // 5) Structural: question form + clinical domain stem
  const looksLikeQuestion =
    /\?/.test(message) ||
    /^(what|when|where|why|how|should|can|could|would|is|are|do|does|did)\b/i.test(
      lower,
    ) ||
    /\b(tell me|explain|describe|help me understand|what about|look for|watch for|cite|evidence|source)\b/i.test(
      lower,
    );

  const clinicalStemHits = tokens.filter(tokenMatchesClinicalStem).length;
  if (looksLikeQuestion && clinicalStemHits >= 1) {
    return true;
  }

  // 6) Strong clinical domain density without question mark
  //    (e.g. "autonomic dysreflexia red flags spina bifida caregivers")
  if (clinicalStemHits >= 2) {
    return true;
  }

  // 7) Explicit citation / knowledge-seeking language
  if (
    /\b(cite|citation|citations|evidence|literature|guideline|guidelines|pubmed|medline|study|studies|research)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Build a multi-token retrieval query: message content tokens + patient
 * condition tokens. Prefer shorter distinctive tokens for LIKE search.
 */
export function buildChatRetrievalQuery(
  message: string,
  conditions: string[],
  medications: string[],
): string {
  const msgTokens = extractContentTokens(message);
  const conditionTokens = tokensFromLabels(conditions);
  const medTokens = tokensFromLabels(medications.map(extractDrugName));

  // Prioritize message tokens that also appear in clinical vocab, then
  // remaining message tokens, then condition tokens for grounding.
  const clinicalVocab = new Set([...conditionTokens, ...medTokens]);
  const prioritized: string[] = [];
  const seen = new Set<string>();

  const push = (t: string) => {
    if (!t || seen.has(t)) return;
    seen.add(t);
    prioritized.push(t);
  };

  for (const t of msgTokens) {
    if (clinicalVocab.has(t) || tokenMatchesClinicalStem(t)) push(t);
  }
  for (const t of msgTokens) push(t);
  for (const t of conditionTokens) push(t);
  for (const t of medTokens.slice(0, 6)) push(t);

  // Cap so we don't explode the SQL OR clause
  return prioritized.slice(0, 16).join(' ');
}

/**
 * Retrieve up to `limit` knowledge-cache chunks matching the given query
 * terms. Multi-token queries use OR matching (any token), not a single
 * full-string LIKE which almost never hits.
 */
export function retrieveClinicalChunks(
  query: string,
  limit = 5,
): RetrievedCitation[] {
  if (!query.trim()) return [];
  try {
    const tokens = extractContentTokens(query);
    // If the query is already short, search as-is; else multi-token OR search.
    const chunks =
      tokens.length <= 1
        ? searchKnowledgeCache(query.trim(), limit)
        : searchKnowledgeCacheMultiToken(tokens, limit);
    return chunks.map((c: KnowledgeChunk) => ({
      docId: c.chunkId,
      source: c.source,
      text: c.text,
    }));
  } catch {
    return [];
  }
}

/**
 * Multi-token OR search over knowledge_cache. Ranks by number of distinct
 * token hits so Spina Bifida queries don't require the entire sentence to
 * appear in a chunk.
 */
function searchKnowledgeCacheMultiToken(
  tokens: string[],
  limit: number,
): KnowledgeChunk[] {
  const unique = [...new Set(tokens)].filter((t) => t.length >= 3).slice(0, 12);
  if (unique.length === 0) return [];

  // Collect candidates per token, score by hit count.
  const scores = new Map<string, { chunk: KnowledgeChunk; score: number }>();
  for (const token of unique) {
    let hits: KnowledgeChunk[] = [];
    try {
      hits = searchKnowledgeCache(token, Math.max(limit * 3, 15));
    } catch {
      continue;
    }
    for (const chunk of hits) {
      const prev = scores.get(chunk.chunkId);
      if (prev) {
        prev.score += 1;
      } else {
        scores.set(chunk.chunkId, { chunk, score: 1 });
      }
    }
  }

  return [...scores.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.chunk.useCount ?? 0) - (a.chunk.useCount ?? 0);
    })
    .slice(0, limit)
    .map((e) => e.chunk);
}

/**
 * Format retrieved chunks as a prompt block the SLM can cite.
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
 * Build a retrieval query from a condition + contextual terms.
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

export async function retrieveClinicalChunksViaBm25(
  retriever: FusedRetriever | null,
  query: string,
  limit = 5,
): Promise<RetrievedCitation[]> {
  if (!retriever || !query.trim()) return retrieveClinicalChunks(query, limit);
  try {
    const result = await retriever.retrieve({
      intent: query,
      conditions: [],
      activeMeds: [],
    });
    const fromRetriever = result.chunks.slice(0, limit).map((c) => ({
      docId: c.docId,
      source: String(c.source),
      text: c.text,
    }));
    // If fused retriever returns nothing, fall back to multi-token cache search
    if (fromRetriever.length === 0) {
      return retrieveClinicalChunks(query, limit);
    }
    return fromRetriever;
  } catch {
    return retrieveClinicalChunks(query, limit);
  }
}
