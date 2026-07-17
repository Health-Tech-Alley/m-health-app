import { citationSourceLabel, formatCitationTag } from './retrieval-helper';
import type { RetrievedCitation } from './retrieval-helper';

const TAG_RE = /\[([^\]]+?)\s*#(\d+)\]/g;

const SUPERSCRIPTS = '\u2070\u00B9\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079';

const CAREGIVER_LABELS: Record<string, string> = {
  pubmed: 'Medical literature',
  medlineplus: 'Health topic summary',
  rxnorm: 'Drug information',
  dailymed: 'Drug label',
  openfda: 'Drug safety data',
  clinicaltrials: 'Clinical trial data',
  clinicaltrialsgov: 'Clinical trial data',
  orphanet: 'Rare disease guidance',
  orphadata: 'Rare disease guidance',
  umls: 'Medical terminology',
  'cdc-places': 'Community health data',
  cdc_places: 'Community health data',
  semmeddb: 'Medical relationships',
  semmed: 'Medical relationships',
  synthetic: 'Development fixture',
  'local-fixture': 'Sample guidance',
  'patient-plan': 'Care plan',
  'care-plan': 'Care plan',
  'patient-record': 'Patient record',
  hedis: 'Quality measure',
};

function toSuperscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUPERSCRIPTS[Number(d)] ?? d)
    .join('');
}

export type FootnoteFormatResult = {
  displayText: string;
  sources: { index: number; label: string; snippet: string; tag: string }[];
};

/**
 * Map SLM citation tags to inline footnotes + Sources footer.
 * Only maps tags that match known 1-based indices in `chunks`.
 * Unknown tags are stripped.
 */
export function formatAnswerWithFootnotes(
  answer: string,
  chunks: RetrievedCitation[],
  opts?: { snippetChars?: number },
): FootnoteFormatResult {
  const snippetChars = opts?.snippetChars ?? 80;
  const byIndex = new Map<number, RetrievedCitation>();
  chunks.forEach((c, i) => byIndex.set(i + 1, c));

  let nextFootnote = 1;
  const indexToFootnote = new Map<number, number>();

  const body = answer.replace(TAG_RE, (_full, _label: string, numStr: string) => {
    const srcIndex = parseInt(numStr, 10);
    if (!Number.isFinite(srcIndex) || !byIndex.has(srcIndex)) {
      return '';
    }
    if (!indexToFootnote.has(srcIndex)) {
      indexToFootnote.set(srcIndex, nextFootnote++);
    }
    const fn = indexToFootnote.get(srcIndex)!;
    return toSuperscript(fn);
  });

  const sources = [...indexToFootnote.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([srcIndex, fn]) => {
      const c = byIndex.get(srcIndex)!;
      const rawLabel = citationSourceLabel(c.source);
      const label = CAREGIVER_LABELS[c.source] ?? rawLabel;
      const snippet =
        c.text.length > snippetChars
          ? c.text.slice(0, snippetChars).trimEnd() + '\u2026'
          : c.text;
      return {
        index: fn,
        label,
        snippet,
        tag: formatCitationTag(c.source, srcIndex),
      };
    });

  let displayText = body.replace(/\s{2,}/g, ' ').trim();
  if (sources.length > 0) {
    const footer = [
      '',
      '**Sources**',
      ...sources.map((s) => `${s.index}. ${s.label} \u2014 ${s.snippet}`),
    ].join('\n');
    displayText = `${displayText}\n${footer}`;
  }

  return { displayText, sources };
}
