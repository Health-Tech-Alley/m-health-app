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

const MAX_RELATED_CONTEXT_LABELS = 4;

function toSuperscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUPERSCRIPTS[Number(d)] ?? d)
    .join('');
}

function caregiverLabelForSource(source: string): string {
  return CAREGIVER_LABELS[source] ?? citationSourceLabel(source);
}

/**
 * Normalize list markers and collapse horizontal whitespace only.
 * Preserves newlines so markdown bullet lists still parse.
 */
export function normalizeAnswerWhitespace(text: string): string {
  return text
    .replace(/^[ \t]*[•*][ \t]+/gm, '- ')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function relatedContextLabels(chunks: RetrievedCitation[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const c of chunks) {
    const label = caregiverLabelForSource(c.source);
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length >= MAX_RELATED_CONTEXT_LABELS) break;
  }
  return labels;
}

export type FootnoteFormatResult = {
  displayText: string;
  sources: { index: number; label: string; snippet: string; tag: string }[];
};

/**
 * Map SLM citation tags to inline footnotes + Sources footer.
 * Only maps tags that match known 1-based indices in `chunks`.
 * Unknown tags are stripped.
 *
 * When chunks were retrieved but the answer has no valid tags, append a soft
 * "Related context available" footer (no fake footnote numbers).
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
      const label = caregiverLabelForSource(c.source);
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

  let displayText = normalizeAnswerWhitespace(body);

  if (sources.length > 0) {
    const footer = [
      '',
      '**Sources**',
      ...sources.map((s) => `${s.index}. ${s.label} \u2014 ${s.snippet}`),
    ].join('\n');
    displayText = `${displayText}\n${footer}`;
  } else if (chunks.length > 0 && displayText.length > 0) {
    const labels = relatedContextLabels(chunks);
    if (labels.length > 0) {
      displayText = `${displayText}\n\nRelated context available (not cited in this answer): ${labels.join(', ')}.`;
    }
  }

  return { displayText, sources };
}
