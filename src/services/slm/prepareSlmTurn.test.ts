import { prepareSlmTurn } from './prepareSlmTurn';

describe('prepareSlmTurn', () => {
  it('returns system + user content without throwing when NLU is unavailable', async () => {
    const prepared = await prepareSlmTurn({
      userText: 'What should I watch for with SpO2 drops?',
      snapshot: null,
      retriever: null,
      forceDeep: true,
      allowDevelopmentNluFallback: true,
      nluTimeoutMs: 500,
      logTag: 'test',
    });

    expect(prepared.systemContext.length).toBeGreaterThan(20);
    expect(prepared.userContent).toContain('SpO2');
    expect(prepared.generation.reasoningFormat).toBe('auto');
    expect(Array.isArray(prepared.citationChunks)).toBe(true);
  });
});
