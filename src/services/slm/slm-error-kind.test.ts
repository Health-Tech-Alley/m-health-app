import { classifySlmLoadError, isSlmLoadError } from './slm-error-kind';

describe('classifySlmLoadError', () => {
  it('classifies memory pressure', () => {
    expect(classifySlmLoadError('not enough RAM to load the model')).toBe('memory');
    expect(classifySlmLoadError('mmap failed: contiguous allocation')).toBe('memory');
    expect(classifySlmLoadError('model needs 2.9 GB but device has less')).toBe('memory');
  });

  it('classifies missing model / native module', () => {
    expect(classifySlmLoadError('model not installed')).toBe('not_installed');
    expect(classifySlmLoadError('no native slm')).toBe('not_installed');
    expect(classifySlmLoadError('model unavailable')).toBe('not_installed');
  });

  it('classifies context overflow', () => {
    expect(classifySlmLoadError('context is full')).toBe('context_overflow');
    expect(classifySlmLoadError('context window exceeded')).toBe('context_overflow');
  });

  it('classifies generic load failures', () => {
    expect(classifySlmLoadError('failed to load model')).toBe('load_failure');
    expect(classifySlmLoadError('slm is not ready')).toBe('load_failure');
    expect(classifySlmLoadError('load attempts failed')).toBe('load_failure');
  });

  it('returns other for unrelated text / empty input', () => {
    expect(classifySlmLoadError('')).toBe('other');
    expect(classifySlmLoadError(null)).toBe('other');
    expect(classifySlmLoadError('caregiver typed anything')).toBe('other');
  });
});

describe('isSlmLoadError', () => {
  it('mirrors the old substring classification', () => {
    expect(isSlmLoadError('not enough memory')).toBe(true);
    expect(isSlmLoadError('model not installed')).toBe(true);
    expect(isSlmLoadError('context is full')).toBe(true);
    expect(isSlmLoadError('unable to load')).toBe(true);
    expect(isSlmLoadError('all good here')).toBe(false);
    expect(isSlmLoadError(null)).toBe(false);
  });
});
