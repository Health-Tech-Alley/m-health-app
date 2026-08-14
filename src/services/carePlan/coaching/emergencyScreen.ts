/**
 * Keyword emergency screen — runs BEFORE any Care classification.
 * On hit: static emergency card path; never classify, never SLM.
 *
 * Deterministic by design (no NLU/ML in this gate). Phrases live in
 * src/nlu/lexicons/emergency-lexicon.ts and are matched longest-first
 * with token boundaries, so paraphrases hit without substring
 * false positives ("not breathing" no longer matches "knot breathing").
 */

import {
  EMERGENCY_NEGATION_GUARDS,
  EMERGENCY_SIGNALS,
} from '@/nlu/lexicons/emergency-lexicon';

/** Flattened phrases with their owning signal, longest first. */
const MATCHABLE = EMERGENCY_SIGNALS.flatMap((signal) =>
  signal.phrases.map((phrase) => ({ phrase, label: signal.label })),
).sort((a, b) => b.phrase.length - a.phrase.length);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[']/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-boundary match: the phrase must sit between non-alphanumeric chars. */
function mentionsPhrase(textNorm: string, phrase: string): boolean {
  const normalizedPhrase = normalize(phrase);
  if (!normalizedPhrase) return false;
  const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(textNorm);
}

export function screenForEmergency(rawText: string): {
  hit: boolean;
  matchedPhrase?: string;
} {
  const text = normalize(rawText);
  if (!text) return { hit: false };
  if (EMERGENCY_NEGATION_GUARDS.some((re) => re.test(text))) {
    return { hit: false };
  }
  for (const { phrase, label } of MATCHABLE) {
    if (mentionsPhrase(text, phrase)) {
      return { hit: true, matchedPhrase: label };
    }
  }
  return { hit: false };
}
