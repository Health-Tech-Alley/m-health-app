import {
  formatPossessive,
  getFirstName,
  NOT_AVAILABLE,
  NOT_PROVIDED,
  UNKNOWN_PATIENT,
} from './patientDisplay';

describe('formatPossessive', () => {
  it('adds ’s for names not ending in s/z', () => {
    expect(formatPossessive('Mike')).toBe('Mike\u2019s');
    expect(formatPossessive('Elena')).toBe('Elena\u2019s');
  });

  it('adds trailing apostrophe only for names ending in s/z', () => {
    expect(formatPossessive('James')).toBe('James\u2019');
    expect(formatPossessive('Luis')).toBe('Luis\u2019');
    expect(formatPossessive('Alex')).toBe('Alex\u2019s');
  });

  it('leaves sentinel labels unchanged', () => {
    expect(formatPossessive(UNKNOWN_PATIENT)).toBe(UNKNOWN_PATIENT);
    expect(formatPossessive(NOT_PROVIDED)).toBe(NOT_PROVIDED);
    expect(formatPossessive(NOT_AVAILABLE)).toBe(NOT_AVAILABLE);
    expect(formatPossessive('')).toBe('');
  });
});

describe('getFirstName', () => {
  it('returns the first token', () => {
    expect(getFirstName('James Okafor')).toBe('James');
    expect(getFirstName('Mike')).toBe('Mike');
  });
});
