/**
 * Intelligent section chunker for knowledge_cache rows.
 *
 * Splits long documents into section-aware children (~600 chars each)
 * for better embedding and retrieval. Short documents are left whole.
 *
 * planning/35 §5.
 */

export const SHORT_MAX_CHARS = 800;
export const TARGET_CHARS = 600;
export const MAX_CHARS = 900;
export const OVERLAP_CHARS = 80;
export const MIN_CHARS = 200;

export type ChunkInput = {
  text: string;
  documentType?: string;
  lengthTier?: string;
  sectionHeading?: string;
  parentDocId: string;
};

export type SectionChunk = {
  chunkId: string;
  text: string;
  parentDocId: string;
  sectionHeading?: string;
  lengthTier: 'short' | 'medium';
};

/**
 * Sentence-boundary splitter with clinical abbreviation awareness.
 */
const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr',
  'mg', 'mcg', 'ml', 'kg', 'lb', 'ft', 'in', 'mm', 'cm',
  'bp', 'hr', 'rr', 'spo2', 'cp', 'sb', 'tbi', 'copd',
  'icd', 'fda', 'nih', 'nlm', 'cdc', 'who',
]);

function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace or end.
  const raw = text.split(/(?<=[.!?])\s+/);
  const merged: string[] = [];
  for (const s of raw) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    // Check if previous sentence ends with an abbreviation
    if (merged.length > 0) {
      const prev = merged[merged.length - 1];
      const lastWord = prev.split(/\s+/).pop()?.replace(/[.!?]$/, '').toLowerCase() ?? '';
      if (ABBREVIATIONS.has(lastWord)) {
        merged[merged.length - 1] = prev + ' ' + trimmed;
        continue;
      }
    }
    merged.push(trimmed);
  }
  return merged;
}

/**
 * Split on markdown headings or SPL-style section headers.
 */
function splitOnHeadings(text: string): { heading?: string; body: string }[] {
  // Match markdown headings (## Heading) or bold labels (**Label:**)
  const headingRegex = /^(?:#{1,4}\s+(.+)|\*\*(.+?)(?::\*\*|\*\*:))/gm;
  const sections: { heading?: string; body: string }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const body = text.slice(lastIndex, match.index).trim();
      if (body) {
        sections.push({ body });
      }
    }
    const heading = (match[1] ?? match[2] ?? '').trim();
    lastIndex = match.index + match[0].length;
    sections.push({ heading, body: '' });
  }

  // Remaining text
  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    if (sections.length > 0 && sections[sections.length - 1].body === '') {
      sections[sections.length - 1].body = remaining;
    } else {
      sections.push({ body: remaining });
    }
  }

  // Merge heading-only sections with their body
  const result: { heading?: string; body: string }[] = [];
  for (const s of sections) {
    if (!s.body && s.heading) continue; // skip empty
    if (s.heading && result.length > 0 && !result[result.length - 1].heading) {
      // Attach heading to previous bodyless section
      result[result.length - 1].heading = s.heading;
      result[result.length - 1].body = s.body;
    } else {
      result.push(s);
    }
  }

  return result.length > 0 ? result : [{ body: text }];
}

/**
 * Greedy sentence packing with overlap.
 */
function packSentences(
  sentences: string[],
  _target: number,
  max: number,
  overlap: number,
  min: number,
): string[] {
  const packs: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > max && current) {
      packs.push(current);
      // Overlap: last N chars of previous pack, word-aligned
      const tail = current.slice(-overlap);
      const wordAligned = tail.includes(' ') ? tail.slice(tail.indexOf(' ') + 1) : tail;
      current = wordAligned ? `${wordAligned} ${sentence}` : sentence;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) packs.push(current);

  // Drop tiny fragments by merging into previous
  const merged: string[] = [];
  for (const pack of packs) {
    if (pack.length < min && merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${pack}`;
    } else {
      merged.push(pack);
    }
  }

  return merged;
}

/**
 * Section-chunk a document into children.
 *
 * Returns the original as a single chunk if short enough,
 * or splits into section-aware children with parentDocId linkage.
 */
export function sectionChunk(input: ChunkInput): SectionChunk[] {
  const { text, parentDocId, sectionHeading } = input;

  // Short documents: keep whole
  if (text.length <= SHORT_MAX_CHARS) {
    return [
      {
        chunkId: parentDocId,
        text,
        parentDocId,
        sectionHeading,
        lengthTier: 'short',
      },
    ];
  }

  // Try heading-based split first
  const headingSections = splitOnHeadings(text);
  const hasMultipleSections = headingSections.length > 1 && headingSections.some((s) => s.heading);

  let rawChunks: { heading?: string; body: string }[];

  if (hasMultipleSections) {
    rawChunks = headingSections;
  } else {
    // Sentence-boundary packing for long abstracts/reviews
    const sentences = splitSentences(text);
    const packed = packSentences(sentences, TARGET_CHARS, MAX_CHARS, OVERLAP_CHARS, MIN_CHARS);
    rawChunks = packed.map((body) => ({ heading: sectionHeading, body }));
  }

  // Build children
  const children: SectionChunk[] = [];
  let idx = 0;

  for (const section of rawChunks) {
    const body = section.body.trim();
    if (!body) continue;

    // If this section is still too long, re-pack it
    if (body.length > MAX_CHARS) {
      const sentences = splitSentences(body);
      const packed = packSentences(sentences, TARGET_CHARS, MAX_CHARS, OVERLAP_CHARS, MIN_CHARS);
      for (const pack of packed) {
        children.push({
          chunkId: `${parentDocId}#s${idx}`,
          text: section.heading ? `${section.heading}: ${pack}` : pack,
          parentDocId,
          sectionHeading: section.heading ?? sectionHeading,
          lengthTier: pack.length > SHORT_MAX_CHARS ? 'medium' : 'short',
        });
        idx++;
      }
    } else {
      children.push({
        chunkId: `${parentDocId}#s${idx}`,
        text: section.heading ? `${section.heading}: ${body}` : body,
        parentDocId,
        sectionHeading: section.heading ?? sectionHeading,
        lengthTier: body.length > SHORT_MAX_CHARS ? 'medium' : 'short',
      });
      idx++;
    }
  }

  return children.length > 0
    ? children
    : [{ chunkId: parentDocId, text, parentDocId, sectionHeading, lengthTier: 'short' }];
}

/**
 * Merge retrieved section chunks by parentDocId.
 * Score = max(child scores). Keeps the best child + optional neighbors.
 */
export function mergeByParent<T extends { docId: string; score: number; text: string }>(
  chunks: T[],
  maxPerParent: number = 1,
): T[] {
  const groups = new Map<string, T[]>();
  for (const chunk of chunks) {
    // Parent ID is everything before #s
    const parentId = chunk.docId.includes('#s')
      ? chunk.docId.slice(0, chunk.docId.indexOf('#s'))
      : chunk.docId;
    const group = groups.get(parentId) ?? [];
    group.push(chunk);
    groups.set(parentId, group);
  }

  const result: T[] = [];
  for (const [, group] of groups) {
    // Sort by score descending
    group.sort((a, b) => b.score - a.score);
    // Take top N per parent
    for (let i = 0; i < Math.min(maxPerParent, group.length); i++) {
      result.push(group[i]);
    }
  }

  // Re-sort by score
  result.sort((a, b) => b.score - a.score);
  return result;
}
