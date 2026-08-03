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

  it('forces DEEP for Bonsai even when FAST is requested (template always thinks)', () => {
    const fast = getConciergeGeneration('bonsai-8b-1bit', 'fast');
    expect(fast.maxTokens).toBe(-1);
    expect(fast.reasoningFormat).toBe('auto');
    expect(fast.temperature).toBe(0.7);
    expect(fast.topK).toBe(20);
  });
});
