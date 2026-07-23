import { stripControlTokens } from './stripControlTokens';

describe('stripControlTokens', () => {
  it('returns plain text unchanged', () => {
    const text = 'This is a normal answer.';
    expect(stripControlTokens(text)).toEqual({
      thinking: null,
      answer: text,
    });
  });

  it('extracts thinking tags', () => {
    const text = '<thinking>reasoning here</thinking>final answer here';
    expect(stripControlTokens(text)).toEqual({
      thinking: 'reasoning here',
      answer: 'final answer here',
    });
  });

  it('strips stray control tokens', () => {
    const text = 'Hello <|end|> world';
    expect(stripControlTokens(text)).toEqual({
      thinking: null,
      answer: 'Hello  world',
    });
  });

  it('parses harmony channel final/answer', () => {
    const text = '<|channel|>thinking\nstep 1\nstep 2<|channel|>final\nThe answer.';
    const result = stripControlTokens(text);
    expect(result.thinking).toContain('step 1');
    expect(result.answer).toBe('The answer.');
  });
});
