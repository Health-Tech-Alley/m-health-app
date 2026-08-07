import { getPromptCopy } from './optional-feature-prompt-copy';

describe('OptionalFeaturePrompt copy', () => {
  it('shows the download copy for a genuinely missing model', () => {
    const copy = getPromptCopy('slm', false);
    expect(copy.title).toBe('Concierge is not downloaded yet');
    expect(copy.body).toContain('Download it from Models');
  });

  it('shows the dev-flag copy when simulate-missing is on', () => {
    const copy = getPromptCopy('slm', true);
    expect(copy.title).toBe('Concierge is hidden by a developer setting');
    expect(copy.body).toContain('Simulate missing Concierge / knowledge');
    expect(copy.body).toContain('turn the setting OFF');
    expect(copy.body).not.toContain('Download it from Models');
  });

  it('keeps the knowledge copy intact when not simulated', () => {
    const copy = getPromptCopy('knowledge', false);
    expect(copy.title).toBe('Clinical knowledge is not downloaded yet');
  });

  it('shows the dev-flag copy for the both requirement too', () => {
    const copy = getPromptCopy('both', true);
    expect(copy.title).toBe('Concierge is hidden by a developer setting');
  });
});
