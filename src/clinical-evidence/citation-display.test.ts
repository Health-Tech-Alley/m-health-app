import { formatAnswerWithFootnotes } from './citation-display';

describe('formatAnswerWithFootnotes', () => {
  const chunks = [
    { docId: 'a', source: 'pubmed', text: 'PubMed abstract about cerebral palsy management strategies and spasticity treatment.' },
    { docId: 'b', source: 'dailymed', text: 'Drug label for Baclofen: dosing, side effects include nausea, dizziness, and muscle weakness.' },
    { docId: 'c', source: 'patient-plan', text: 'Care plan note for Mike: GMFCS Level V, spastic quadriplegic CP.' },
  ];

  it('returns answer unchanged when no tags', () => {
    const result = formatAnswerWithFootnotes('Plain answer with no citations.', chunks);
    expect(result.displayText).toBe('Plain answer with no citations.');
    expect(result.sources).toEqual([]);
  });

  it('converts a single citation tag to a footnote', () => {
    const result = formatAnswerWithFootnotes(
      'Common side effects include nausea [Drug Label #2].',
      chunks,
    );
    expect(result.displayText).toContain('\u00B9');
    expect(result.displayText).not.toContain('[Drug Label #2]');
    expect(result.displayText).toContain('**Sources**');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].index).toBe(1);
    expect(result.sources[0].label).toBe('Drug label');
  });

  it('converts multiple citation tags to sequential footnotes', () => {
    const result = formatAnswerWithFootnotes(
      'Studies show benefit [PubMed #1]. Side effects include nausea [Drug Label #2].',
      chunks,
    );
    expect(result.displayText).not.toContain('[PubMed #1]');
    expect(result.displayText).not.toContain('[Drug Label #2]');
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0].label).toBe('Medical literature');
    expect(result.sources[1].label).toBe('Drug label');
  });

  it('deduplicates same source cited multiple times', () => {
    const result = formatAnswerWithFootnotes(
      'Baclofen helps spasticity [Drug Label #2]. It may cause nausea [Drug Label #2].',
      chunks,
    );
    expect(result.sources).toHaveLength(1);
    expect(result.displayText).not.toContain('[Drug Label #2]');
    const fn1 = result.displayText.indexOf('\u00B9');
    const fn2 = result.displayText.lastIndexOf('\u00B9');
    expect(fn1).not.toBe(fn2);
  });

  it('strips hallucinated tags (index out of range)', () => {
    const result = formatAnswerWithFootnotes(
      'Evidence from [PubMed #1] and [PubMed #99].',
      chunks,
    );
    expect(result.displayText).not.toContain('[PubMed #1]');
    expect(result.displayText).not.toContain('[PubMed #99]');
    expect(result.sources).toHaveLength(1);
  });

  it('handles empty answer', () => {
    const result = formatAnswerWithFootnotes('', chunks);
    expect(result.displayText).toBe('');
    expect(result.sources).toEqual([]);
  });

  it('uses caregiver-friendly labels', () => {
    const result = formatAnswerWithFootnotes(
      '[Care Plan #1]',
      [{ docId: 'c', source: 'patient-plan', text: 'Plan text.' }],
    );
    expect(result.sources[0].label).toBe('Care plan');
  });

  it('snippets are truncated to snippetChars', () => {
    const longText = 'A'.repeat(200);
    const result = formatAnswerWithFootnotes(
      '[PubMed #1]',
      [{ docId: 'x', source: 'pubmed', text: longText }],
      { snippetChars: 50 },
    );
    expect(result.sources[0].snippet.length).toBeLessThanOrEqual(53);
  });

  it('collapses multiple spaces', () => {
    const result = formatAnswerWithFootnotes(
      'Answer   with  spaces    [PubMed #1]',
      chunks,
    );
    expect(result.displayText).not.toContain('   ');
  });

  it('returns empty sources for unrecognized source label', () => {
    const result = formatAnswerWithFootnotes(
      '[UnknownSource #1]',
      [{ docId: 'u', source: 'unknown-source', text: 'Content.' }],
    );
    expect(result.sources[0].label).toBe('unknown-source');
  });
});
