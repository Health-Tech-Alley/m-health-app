/**
 * Keyword emergency screen — runs BEFORE any Care classification (planning/40).
 * On hit: static emergency card path; never classify, never SLM.
 */

const NEGATION_GUARDS: RegExp[] = [
  /\b(is|are|was|were|seems?|looks?)\s+(breathing|respirating)\s+(fine|ok|okay|normal|well|good)\b/i,
  /\bno\s+(chest\s+)?pain\b/i,
  /\bnot\s+(choking|seizing|unresponsive|blue)\b/i,
  /\bbreathing\s+exercises?\b/i,
  /\bbreathing\s+(is\s+)?(fine|ok|okay|normal)\b/i,
];

const RED_PHRASES: string[] = [
  'not breathing',
  "isn't breathing",
  'isnt breathing',
  'stopped breathing',
  'can\'t breathe',
  'cannot breathe',
  'turning blue',
  'turned blue',
  'unresponsive',
  'won\'t wake up',
  'will not wake',
  'no pulse',
  'chest pain and crushing',
  'severe chest pain',
  'choking and can\'t',
  'active seizure lasting',
  'having a seizure',
  'having a seizure right now',
  'seizure right now',
  'call 911 now',
  'needs 911',
  'going to er now',
  'cyanotic',
  'agonal breathing',
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function screenForEmergency(rawText: string): {
  hit: boolean;
  matchedPhrase?: string;
} {
  const text = normalize(rawText);
  if (!text) return { hit: false };
  if (NEGATION_GUARDS.some((re) => re.test(text))) {
    return { hit: false };
  }
  for (const phrase of RED_PHRASES) {
    if (text.includes(phrase)) {
      return { hit: true, matchedPhrase: phrase };
    }
  }
  return { hit: false };
}
