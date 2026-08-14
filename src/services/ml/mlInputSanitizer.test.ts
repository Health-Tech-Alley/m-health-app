import {
  CUMULATIVE_CAPS,
  CUMULATIVE_WINDOW_MS,
  deriveSleepQuality,
  sanitizeVitalValue,
  sumWindowValues,
} from './mlInputSanitizer';

describe('sanitizeVitalValue', () => {
  it('drops implausible SpO2 values (0, >100)', () => {
    expect(sanitizeVitalValue('spo2', 0)).toBeNull();
    expect(sanitizeVitalValue('spo2', 94)).toBe(94);
    expect(sanitizeVitalValue('spo2', 101)).toBeNull();
  });

  it('drops HRV values <= 0 and out-of-range', () => {
    expect(sanitizeVitalValue('hrv_sdnn', 0)).toBeNull();
    expect(sanitizeVitalValue('hrv_sdnn', -5)).toBeNull();
    expect(sanitizeVitalValue('hrv_sdnn', 55)).toBe(55);
    expect(sanitizeVitalValue('hrv_sdnn', 999)).toBeNull();
  });

  it('accepts normal heart rate / glucose / temperature values', () => {
    expect(sanitizeVitalValue('heart_rate', 72)).toBe(72);
    expect(sanitizeVitalValue('blood_glucose', 95)).toBe(95);
    expect(sanitizeVitalValue('temperature', 37.0)).toBe(37.0);
  });

  it('handles Fahrenheit temperature units', () => {
    expect(sanitizeVitalValue('temperature', 98.6, 'F')).toBe(98.6);
    expect(sanitizeVitalValue('temperature', 98.6, 'C')).toBeNull();
  });

  it('treats non-finite values as implausible', () => {
    expect(sanitizeVitalValue('heart_rate', Number.NaN)).toBeNull();
    expect(sanitizeVitalValue('heart_rate', Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('deriveSleepQuality', () => {
  it('returns a 0-1 score (AE scale), not 0-100', () => {
    expect(deriveSleepQuality(9)).toBe(1);
    expect(deriveSleepQuality(7.5)).toBe(0.83);
    expect(deriveSleepQuality(4.5)).toBe(0.5);
    expect(deriveSleepQuality(0)).toBe(0);
    expect(deriveSleepQuality(-1)).toBe(0);
  });
});

describe('sumWindowValues', () => {
  const base = Date.parse('2026-08-10T12:00:00.000Z');
  const samples = [
    { recordedAt: new Date(base - 60 * 60 * 1000).toISOString(), value: 500 },
    { recordedAt: new Date(base - 30 * 60 * 1000).toISOString(), value: 0 }, // ignored
    { recordedAt: new Date(base - 5 * 60 * 1000).toISOString(), value: 300 },
  ];

  it('sums positive values inside the window', () => {
    expect(sumWindowValues(samples, base, CUMULATIVE_WINDOW_MS)).toBe(800);
  });

  it('excludes samples older than the window', () => {
    const old = {
      recordedAt: new Date(base - 48 * 60 * 60 * 1000).toISOString(),
      value: 9000,
    };
    expect(sumWindowValues([...samples, old], base, CUMULATIVE_WINDOW_MS)).toBe(800);
  });

  it('excludes samples recorded after the event timestamp', () => {
    const future = {
      recordedAt: new Date(base + 60 * 60 * 1000).toISOString(),
      value: 1000,
    };
    expect(sumWindowValues([...samples, future], base, CUMULATIVE_WINDOW_MS)).toBe(800);
  });
});

describe('CUMULATIVE_CAPS', () => {
  it('defines generous daily caps for counters', () => {
    expect(CUMULATIVE_CAPS.steps).toBe(250000);
    expect(CUMULATIVE_CAPS.calories_burned).toBe(60000);
  });
});
