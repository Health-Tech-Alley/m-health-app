/**
 * UMLS Metathesaurus client.
 *
 * Cross-walks between ICD-10, SNOMED CT, RxNorm, MeSH, LOINC, and CPT via
 * the UTS (UMLS Terminology Services) REST API. Per planning/26, this
 * supports the EHR-import code-normalization path: when the patient's
 * record uses a SNOMED code, we map it to a MeSH term for PubMed search
 * and an RxNorm concept for drug checks.
 *
 * Track A: ships with realistic fixtures for common condition / medication
 * code mappings. UMLS API key is required for live use; secure storage
 * integration is the next step (see planning/26 open question #3).
 *
 * See planning/26_clinical-data-sources-research.md §6.
 */

import type { KnowledgeChunk } from '@/data/types';
import { getUmlsApiKey } from '@/services/umls-token-store';
import { withRetry } from './rate-limiter';
import { isFixtureMode } from './fixture-mode';

const UMLS_BASE = 'https://uts-ws.nlm.nih.gov/rest';
const TIMEOUT_MS = 15_000;

export interface UmlsConceptMapping {
  /** The original code that was looked up, e.g. "G80.0" (ICD-10). */
  sourceCode: string;
  /** Source vocabulary: ICD10, SNOMED, RxNorm, MeSH, LOINC, CPT, etc. */
  sourceVocabulary: string;
  /** The canonical UMLS CUI. */
  umlsCui: string;
  /** Preferred term for the CUI. */
  preferredTerm: string;
  /** Related concepts in target vocabularies. */
  related: { vocabulary: string; code: string; term: string }[];
}

export interface UmlsSearchParams {
  code: string;
  vocabulary: 'ICD10' | 'SNOMED' | 'RxNorm' | 'MeSH' | 'LOINC' | 'CPT' | string;
}

/**
 * Look up a code in a source vocabulary and return its UMLS CUI + related
 * concepts. This is the cross-walk the doc promises.
 */
export async function lookupUmls(params: UmlsSearchParams): Promise<UmlsConceptMapping | null> {
  if (isFixtureMode()) {
    return fixtureLookup(params);
  }
  const { code, vocabulary } = params;
  const apiKey = await getUmlsApiKey();
  if (!apiKey) {
    // UMLS genuinely requires an API key (UTS returns 401 without one).
    // Skip silently — the caller treats null as "no cross-walk available."
    return null;
  }

  // UTS REST API: source-asserted concept lookup by code.
  //   GET /content/current/source/{SAB}/{code}?apiKey=...
  // Returns `{result: {ui, name, concept: ".../CUI/<CUI>"}}`.
  // The previous code used `/content/current/CUI/search` which is NOT a
  // valid UTS endpoint — it returns 404 for every code (the bug this fixes).
  const vocabPath = encodeURIComponent(vocabulary);
  const codePath = encodeURIComponent(code);
  const lookupUrl = new URL(`${UMLS_BASE}/content/current/source/${vocabPath}/${codePath}`);
  lookupUrl.searchParams.set('apiKey', apiKey);

  let response: Response;
  try {
    response = await fetchWithTimeout(lookupUrl.toString());
  } catch (err: any) {
    // 404 here means the code isn't in UMLS under this vocabulary; treat
    // as "no cross-walk" rather than a hard error so the bundler continues.
    if (err?.message?.includes('UMLS request failed: 404')) return null;
    throw err;
  }
  const json = await response.json();
  const result = json?.result;
  if (!result) return null;

  // Extract the CUI from the `concept` link (a URL whose last path
  // segment is the CUI, e.g. .../CUI/C0024117).
  const conceptUrl: string | undefined = result.concept ?? result.Concept;
  const umlsCui = conceptUrl ? conceptUrl.split('/').filter(Boolean).pop() : undefined;
  if (!umlsCui) return null;

  const preferredTerm: string = result.name ?? result.ui ?? code;

  // Fetch related concepts (MeSH, SNOMED, RxNorm) by reading the CUI's
  // atoms. Each atom carries `rootSource` (the vocabulary) + `code` +
  // `name`. Dedupe by vocabulary:code so we don't repeat identical atoms.
  const related: { vocabulary: string; code: string; term: string }[] = [];
  try {
    const atomsUrl = new URL(`${UMLS_BASE}/content/current/CUI/${umlsCui}/atoms`);
    atomsUrl.searchParams.set('apiKey', apiKey);
    const atomsResp = await fetchWithTimeout(atomsUrl.toString());
    const atomsJson = await atomsResp.json();
    const atoms: any[] = atomsJson?.result ?? [];
    const seen = new Set<string>();
    for (const a of atoms) {
      const vocab = a.rootSource ?? a.source;
      const c = a.code ?? a.ui;
      const t = a.name;
      if (!vocab || !c || !t) continue;
      const key = `${vocab}:${c}`;
      if (seen.has(key)) continue;
      seen.add(key);
      related.push({ vocabulary: vocab, code: c, term: t });
    }
  } catch {
    // Atoms fetch is best-effort — the CUI itself is the primary deliverable.
    // Leave `related` empty (the orchestrator's MeSH enrichment silently degrades).
  }

  return {
    sourceCode: code,
    sourceVocabulary: vocabulary,
    umlsCui,
    preferredTerm,
    related,
  };
}

/**
 * Convert a UMLS mapping into a knowledge cache chunk.
 */
export function umlsToChunks(mapping: UmlsConceptMapping | null): KnowledgeChunk[] {
  if (!mapping) return [];
  const now = new Date().toISOString();
  const relatedText = mapping.related.length > 0
    ? `\nRelated: ${mapping.related.map((r) => `${r.vocabulary}:${r.code} = ${r.term}`).join('; ')}`
    : '';
  return [
    {
      chunkId: `UMLS-${mapping.umlsCui}`,
      source: 'umls',
      text: `${mapping.sourceVocabulary}:${mapping.sourceCode} \u2192 UMLS CUI ${mapping.umlsCui} (${mapping.preferredTerm}).${relatedText}`,
      retrievedAt: now,
      useCount: 0,
      metadataJson: JSON.stringify({ cui: mapping.umlsCui, vocabulary: mapping.sourceVocabulary }),
    },
  ];
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`UMLS request failed: ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }, { maxRetries: 2, baseDelayMs: 1500, maxDelayMs: 8000 });
}

// ---------- Fixtures (Track A) ----------

const FIXTURES: Record<string, UmlsConceptMapping> = {
  'G80.0': {
    sourceCode: 'G80.0',
    sourceVocabulary: 'ICD10',
    umlsCui: 'C0002756',
    preferredTerm: 'Cerebral palsy, spastic quadriplegic',
    related: [
      { vocabulary: 'SNOMED', code: '128188000', term: 'Spastic quadriplegic cerebral palsy' },
      { vocabulary: 'MeSH', code: 'D002547', term: 'Cerebral Palsy' },
    ],
  },
  'G80.9': {
    sourceCode: 'G80.9',
    sourceVocabulary: 'ICD10',
    umlsCui: 'C0002759',
    preferredTerm: 'Cerebral palsy, unspecified',
    related: [
      { vocabulary: 'SNOMED', code: '128199003', term: 'Cerebral palsy' },
      { vocabulary: 'MeSH', code: 'D002547', term: 'Cerebral Palsy' },
    ],
  },
  'J44.9': {
    sourceCode: 'J44.9',
    sourceVocabulary: 'ICD10',
    umlsCui: 'C0024117',
    preferredTerm: 'Chronic obstructive pulmonary disease, unspecified',
    related: [
      { vocabulary: 'SNOMED', code: '13645005', term: 'Chronic obstructive pulmonary disease' },
      { vocabulary: 'MeSH', code: 'D029424', term: 'Pulmonary Disease, Chronic Obstructive' },
    ],
  },
  'S06.9': {
    sourceCode: 'S06.9',
    sourceVocabulary: 'ICD10',
    umlsCui: 'C0018944',
    preferredTerm: 'Unspecified intracranial injury',
    related: [
      { vocabulary: 'SNOMED', code: '127295002', term: 'Traumatic brain injury' },
      { vocabulary: 'MeSH', code: 'D020197', term: 'Brain Injuries' },
    ],
  },
  'Q05.9': {
    sourceCode: 'Q05.9',
    sourceVocabulary: 'ICD10',
    umlsCui: 'C0030080',
    preferredTerm: 'Spina bifida, unspecified',
    related: [
      { vocabulary: 'SNOMED', code: '67531005', term: 'Spina bifida' },
      { vocabulary: 'MeSH', code: 'D013131', term: 'Spinal Dysraphism' },
    ],
  },
  'I63.9': {
    sourceCode: 'I63.9',
    sourceVocabulary: 'ICD10',
    umlsCui: 'C0038454',
    preferredTerm: 'Cerebral infarction, unspecified',
    related: [
      { vocabulary: 'SNOMED', code: '230690007', term: 'Cerebral infarction' },
      { vocabulary: 'MeSH', code: 'D020521', term: 'Stroke' },
    ],
  },
};

function fixtureLookup(params: UmlsSearchParams): UmlsConceptMapping | null {
  if (params.vocabulary === 'ICD10') {
    return FIXTURES[params.code] ?? null;
  }
  // For other vocabularies, search by preferred-term match.
  const lc = params.code.toLowerCase();
  return (
    Object.values(FIXTURES).find((m) =>
      m.related.some((r) => r.vocabulary === params.vocabulary && r.code.toLowerCase() === lc),
    ) ?? null
  );
}
