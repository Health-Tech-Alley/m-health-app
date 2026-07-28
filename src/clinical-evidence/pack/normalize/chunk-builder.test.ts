/**
 * Regression: section children of one document must produce DISTINCT pack row
 * ids (previously all collapsed onto `pack:<layer>:<externalId>`, silently
 * losing most sections on INSERT OR REPLACE).
 */

import type { KnowledgeChunk } from '@/data/types';

import { knowledgeChunksToPackRows } from './chunk-builder';

function longAbstract(chunkId: string, pmid: string, chars: number): KnowledgeChunk {
  // Sentence-like filler so the section chunker splits it.
  const sentence = 'Caregiver home monitoring improves safety for complex disability. ';
  const text = sentence.repeat(Math.ceil(chars / sentence.length)).slice(0, chars);
  return {
    chunkId,
    externalId: chunkId,
    source: 'pubmed',
    text,
    retrievedAt: new Date().toISOString(),
    useCount: 0,
    metadataJson: JSON.stringify({ pmid }),
  };
}

describe('knowledgeChunksToPackRows', () => {
  it('gives section children distinct row ids', () => {
    const rows = knowledgeChunksToPackRows(
      [longAbstract('PMID-123', '123', 2400)],
      'lit_lite',
      '1.0.0',
    );
    expect(rows.length).toBeGreaterThan(1);
    const ids = rows.map((r) => r.chunkId);
    expect(new Set(ids).size).toBe(rows.length);
    for (const id of ids) {
      expect(id.startsWith('pack:lit_lite:PMID-123')).toBe(true);
    }
  });

  it('keeps parent metadata (pmid) on section children', () => {
    const rows = knowledgeChunksToPackRows(
      [longAbstract('PMID-123', '123', 2400)],
      'lit_lite',
      '1.0.0',
    );
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) {
      const meta = JSON.parse(r.metadataJson ?? '{}') as Record<string, unknown>;
      expect(meta.pmid).toBe('123');
      expect(meta.parentDocId).toBe('PMID-123');
    }
  });

  it('short chunks stay a single row', () => {
    const chunk: KnowledgeChunk = {
      chunkId: 'PMID-9',
      externalId: 'PMID-9',
      source: 'pubmed',
      text: 'Short abstract digest.',
      retrievedAt: new Date().toISOString(),
      useCount: 0,
    };
    const rows = knowledgeChunksToPackRows([chunk], 'lit_lite', '1.0.0');
    expect(rows.length).toBe(1);
    expect(rows[0].chunkId).toBe('pack:lit_lite:PMID-9');
  });
});
