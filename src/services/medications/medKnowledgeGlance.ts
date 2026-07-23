/**
 * Glanceable medication facts derived from knowledge_cache chunks
 * (DailyMed / OpenFDA / RxNorm / fixtures). Read-only — no snapshot changes.
 */

import { searchKnowledgeCache, type KnowledgeChunk } from '@/data';

export type MedKnowledgeGlance = {
  indication: string | null;
  sideEffects: string | null;
  warnings: string | null;
  other: string | null;
  sourceLabels: string[];
};

const INDICATION_RE =
  /\b(indicat|used for|treats?|treatment of|for the (treatment|management)|therapeutic)\b/i;
const SIDE_EFFECT_RE =
  /\b(side effect|adverse|common reactions?|may cause|nausea|dizziness|drowsiness|tremor|tachycardia|headache)\b/i;
const WARNING_RE =
  /\b(warning|precaution|contraindicat|do not|avoid|black box|serious|call (your )?(doctor|provider|911))\b/i;

function cleanSnippet(text: string, max = 220): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trim()}…`;
}

function sourceLabel(source: KnowledgeChunk['source']): string {
  switch (source) {
    case 'dailymed':
      return 'Drug label';
    case 'openfda':
      return 'OpenFDA';
    case 'rxnorm':
      return 'RxNorm';
    case 'medlineplus':
      return 'MedlinePlus';
    case 'pubmed':
      return 'PubMed';
    default:
      return source;
  }
}

function pickMatching(chunks: KnowledgeChunk[], pattern: RegExp): string | null {
  for (const chunk of chunks) {
    if (pattern.test(chunk.text)) {
      return cleanSnippet(chunk.text);
    }
  }
  return null;
}

/**
 * Best-effort glance facts for a medication name from the local knowledge cache.
 * Patient-scoped — never reads another profile's corpus.
 * Returns null when nothing useful is cached yet.
 */
export function getMedKnowledgeGlance(
  medicationName: string,
  patientId?: string | null,
): MedKnowledgeGlance | null {
  const name = medicationName.trim();
  if (!name || !patientId?.trim()) return null;

  // Prefer the leading token (generic/brand root) for broader cache hits.
  const root = name.split(/[\s(/,]/)[0] ?? name;
  const chunks = [
    ...searchKnowledgeCache(root, 12, patientId),
    ...(root !== name ? searchKnowledgeCache(name, 6, patientId) : []),
  ];

  // Dedup by chunkId, prefer med-ish sources.
  const seen = new Set<string>();
  const ranked = chunks
    .filter((c) => {
      if (seen.has(c.chunkId)) return false;
      seen.add(c.chunkId);
      return true;
    })
    .sort((a, b) => {
      const rank = (s: string) =>
        s === 'dailymed' ? 0 : s === 'openfda' ? 1 : s === 'rxnorm' ? 2 : s === 'medlineplus' ? 3 : 4;
      return rank(a.source) - rank(b.source);
    });

  if (ranked.length === 0) return null;

  const indication = pickMatching(ranked, INDICATION_RE);
  const sideEffects = pickMatching(ranked, SIDE_EFFECT_RE);
  const warnings = pickMatching(ranked, WARNING_RE);
  const other =
    !indication && !sideEffects && !warnings
      ? cleanSnippet(ranked[0].text)
      : null;

  if (!indication && !sideEffects && !warnings && !other) return null;

  const sourceLabels = Array.from(
    new Set(ranked.slice(0, 4).map((c) => sourceLabel(c.source))),
  );

  return {
    indication,
    sideEffects,
    warnings,
    other,
    sourceLabels,
  };
}
