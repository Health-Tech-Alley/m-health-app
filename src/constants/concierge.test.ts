import { CONCIERGE_GENERATION_DEEP, CONCIERGE_GENERATION_FAST, getConciergeGeneration } from './concierge';

describe('getConciergeGeneration', () => {
  it('returns the shared constants for the default Gemma model', () => {
    expect(getConciergeGeneration('gemma-4-e2b', 'deep')).toBe(CONCIERGE_GENERATION_DEEP);
    expect(getConciergeGeneration('gemma-4-e2b', 'fast')).toBe(CONCIERGE_GENERATION_FAST);
    expect(getConciergeGeneration(null, 'deep')).toBe(CONCIERGE_GENERATION_DEEP);
  });

  it('applies the Bonsai 8B sampling profile while keeping FAST/DEEP semantics', () => {
    const deep = getConciergeGeneration('bonsai-8b-1bit', 'deep');
    expect(deep.maxTokens).toBe(-1);
    expect(deep.reasoningFormat).toBe('auto');
    expect(deep.temperature).toBe(0.7);
    expect(deep.topK).toBe(20);
    expect(deep.topP).toBe(0.95);
  });

  it('gives Bonsai a no-think FAST profile with unlimited answer budget', () => {
    const fast = getConciergeGeneration('bonsai-8b-1bit', 'fast');
    expect(fast.maxTokens).toBe(-1);
    expect(fast.maxReasoningTokens).toBe(0);
    expect(fast.reasoningFormat).toBe('none');
    expect(fast.temperature).toBe(0.7);
    expect(fast.topK).toBe(20);
  });

  it('gives LFM2.5 a no-think FAST profile with unlimited answer budget', () => {
    const fast = getConciergeGeneration('lfm2-5-2-6b', 'fast');
    expect(fast.maxTokens).toBe(-1);
    expect(fast.maxReasoningTokens).toBe(0);
    expect(fast.reasoningFormat).toBe('none');
    expect(fast.temperature).toBe(0.1);
    expect(fast.topK).toBe(50);
  });

  it('gives LFM2.5 an unlimited DEEP profile with low-temp sampling', () => {
    const deep = getConciergeGeneration('lfm2-5-2-6b', 'deep');
    expect(deep.maxTokens).toBe(-1);
    expect(deep.maxReasoningTokens).toBe(0);
    expect(deep.reasoningFormat).toBe('auto');
    expect(deep.temperature).toBe(0.1);
    expect(deep.topK).toBe(50);
  });
});
