import { normalizeSpo2Percent, normalizeVitalForThreshold } from './spo2';

describe('normalizeSpo2Percent', () => {
  it('converts fraction to percent', () => {
    expect(normalizeSpo2Percent(0.86)).toBe(86);
    expect(normalizeSpo2Percent(1)).toBe(100);
  });

  it('leaves percent values unchanged', () => {
    expect(normalizeSpo2Percent(86)).toBe(86);
    expect(normalizeSpo2Percent(97.5)).toBe(97.5);
  });

  it('normalizes only spo2 vital types for thresholds', () => {
    expect(normalizeVitalForThreshold('spo2', 0.88)).toBe(88);
    expect(normalizeVitalForThreshold('heart_rate', 0.88)).toBe(0.88);
  });
});
