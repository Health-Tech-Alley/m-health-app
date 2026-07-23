import {
  buildChatRetrievalQuery,
  extractContentTokens,
  formatCitationTag,
  formatCitationsForPrompt,
  messageHasClinicalKeywords,
} from './retrieval-helper';

describe('formatCitationTag / formatCitationsForPrompt', () => {
  it('tags sources with 1-based index', () => {
    expect(formatCitationTag('pubmed', 1)).toBe('[PubMed #1]');
    expect(formatCitationTag('patient-plan', 3)).toBe('[Care Plan #3]');
    expect(formatCitationTag('dailymed', 2)).toBe('[Drug Label #2]');
  });

  it('includes care-plan section and PMID detail when available', () => {
    expect(
      formatCitationTag(
        { docId: 'p1', source: 'adcp_plan', text: 'Goal text', sectionHeading: 'Goals' },
        1,
      ),
    ).toBe('[Care Plan · Goals #1]');
    expect(
      formatCitationTag(
        { docId: 'pmid-31415926', source: 'pubmed', text: 'Abstract', sourceId: 'PMID:31415926' },
        2,
      ),
    ).toBe('[PubMed · PMID 31415926 #2]');
  });

  it('formats prompt block with indexed tags', () => {
    const block = formatCitationsForPrompt([
      { docId: 'a', source: 'pubmed', text: 'Abstract one.' },
      { docId: 'b', source: 'patient-plan', text: 'Plan note.', sectionHeading: 'Therapy contract' },
    ]);
    expect(block).toContain('[PubMed #1] Abstract one.');
    expect(block).toContain('[Care Plan · Therapy contract #2] Plan note.');
    expect(block).toContain('exact tag');
  });
});

describe('messageHasClinicalKeywords (structural)', () => {
  const spinaConditions = [
    'Spina bifida',
    'Neurogenic bladder',
    'Neurogenic bowel',
    'Recurrent urinary tract infection',
  ];
  const copdConditions = ['COPD', 'Traumatic brain injury'];

  it('fires on Spina Bifida education questions', () => {
    expect(
      messageHasClinicalKeywords(
        'What should I watch for with Spina Bifida autonomic dysreflexia? Cite sources.',
        spinaConditions,
        [],
      ),
    ).toBe(true);
  });

  it('fires on partial multi-word condition tokens (spina + bifida)', () => {
    expect(
      messageHasClinicalKeywords(
        'bladder and bowel red flags for spina bifida caregivers',
        spinaConditions,
        [],
      ),
    ).toBe(true);
  });

  it('fires on question + clinical stem without exact condition string', () => {
    expect(
      messageHasClinicalKeywords(
        'What are warning signs of autonomic dysreflexia and fever?',
        spinaConditions,
        [],
      ),
    ).toBe(true);
  });

  it('fires on COPD abbreviation with matching condition', () => {
    expect(
      messageHasClinicalKeywords(
        'What are GOLD SpO2 targets for COPD?',
        copdConditions,
        ['Tiotropium daily'],
      ),
    ).toBe(true);
  });

  it('fires on drug name from med list', () => {
    expect(
      messageHasClinicalKeywords(
        'What side effects should I watch for with Tiotropium?',
        copdConditions,
        ['Tiotropium 18mcg inhaler daily'],
      ),
    ).toBe(true);
  });

  it('does not fire on pure scheduling without clinical domain', () => {
    expect(
      messageHasClinicalKeywords(
        'What time is her appointment tomorrow?',
        spinaConditions,
        [],
      ),
    ).toBe(false);
  });

  it('fires on cite/evidence language', () => {
    expect(
      messageHasClinicalKeywords(
        'Please cite evidence about mobility support at home',
        spinaConditions,
        [],
      ),
    ).toBe(true);
  });
});

describe('buildChatRetrievalQuery', () => {
  it('includes distinctive tokens from message and conditions', () => {
    const q = buildChatRetrievalQuery(
      'autonomic dysreflexia red flags',
      ['Spina bifida', 'Neurogenic bladder'],
      [],
    );
    const tokens = q.split(/\s+/);
    expect(tokens).toEqual(
      expect.arrayContaining(['autonomic', 'dysreflexia', 'spina', 'bifida']),
    );
    // Should not be one giant unsplit sentence
    expect(tokens.length).toBeGreaterThan(3);
  });
});

describe('extractContentTokens', () => {
  it('drops stopwords and short tokens', () => {
    expect(extractContentTokens('What should I watch for with Spina Bifida?')).toEqual(
      expect.arrayContaining(['watch', 'spina', 'bifida']),
    );
    expect(extractContentTokens('What should I watch for with Spina Bifida?')).not.toContain(
      'what',
    );
  });
});
