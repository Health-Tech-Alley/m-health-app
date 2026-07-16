import { effectiveNPredict } from './n-predict';

describe('effectiveNPredict', () => {
  it('returns -1 for unlimited (maxTokens: -1)', () => {
    expect(effectiveNPredict({ maxTokens: -1, reasoningFormat: 'auto' })).toBe(-1);
    expect(effectiveNPredict({ maxTokens: -1, reasoningFormat: 'none' })).toBe(-1);
  });

  it('adds headroom even when reasoningFormat is none', () => {
    expect(
      effectiveNPredict({
        maxTokens: 256,
        maxReasoningTokens: 192,
        reasoningFormat: 'none',
      }),
    ).toBe(448);
  });

  it('adds zero headroom when maxReasoningTokens is 0', () => {
    expect(
      effectiveNPredict({
        maxTokens: 256,
        maxReasoningTokens: 0,
        reasoningFormat: 'none',
      }),
    ).toBe(256);
  });

  it('adds headroom for auto mode', () => {
    expect(
      effectiveNPredict({
        maxTokens: 256,
        maxReasoningTokens: 128,
        reasoningFormat: 'auto',
      }),
    ).toBe(384);
  });

  it('uses default maxTokens 192 when options undefined', () => {
    expect(effectiveNPredict()).toBe(192);
    expect(effectiveNPredict({})).toBe(192);
  });

  it('caps negative headroom to 0', () => {
    expect(
      effectiveNPredict({
        maxTokens: 100,
        maxReasoningTokens: -10,
        reasoningFormat: 'none',
      }),
    ).toBe(100);
  });
});
