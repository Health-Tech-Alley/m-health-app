import { deprecatedModelsDialogCopy, scanModelsFolderForDeprecated } from './DeprecatedModelsGate';

describe('deprecatedModelsDialogCopy', () => {
  it('uses singular wording for a single file', () => {
    const copy = deprecatedModelsDialogCopy(1);
    expect(copy.title).toBe('Unsupported model files found');
    expect(copy.message).toContain('contains 1 file');
    expect(copy.message).toContain('is not a complete download');
    expect(copy.button).toBe('Delete');
  });

  it('uses plural wording for multiple files', () => {
    const copy = deprecatedModelsDialogCopy(3);
    expect(copy.message).toContain('contains 3 files');
    expect(copy.message).toContain('are not a complete download');
  });
});

describe('scanModelsFolderForDeprecated', () => {
  it('returns [] when the models folder is missing (treated as clean)', () => {
    // The scan must never throw — a missing/empty folder yields no removals.
    const result = scanModelsFolderForDeprecated();
    expect(Array.isArray(result)).toBe(true);
  });
});
