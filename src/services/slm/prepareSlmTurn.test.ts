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

  it('appends extraSystemContext and can skip NLU with empty tools', async () => {
    const prepared = await prepareSlmTurn({
      userText: 'What exercise is most important?',
      snapshot: null,
      retriever: null,
      forceDeep: true,
      skipNlu: true,
      toolsOverride: [],
      extraSystemContext: 'UC3 THERAPY (record)\nExercises: Sit-to-stand practice',
      logTag: 'test-uc3',
    });

    expect(prepared.systemContext).toContain('UC3 THERAPY (record)');
    expect(prepared.systemContext).toContain('Sit-to-stand practice');
    expect(prepared.nluPacket).toBeNull();
    expect(prepared.userContent).toBe('What exercise is most important?');
  });
});

