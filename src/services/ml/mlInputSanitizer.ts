/**
 * ML input sanitization helpers (doc 26 Workstream A).
 *
 * Raw wearable samples are sanitized before they reach the UC2 autoencoder:
 * implausible values become "missing" (so the imputation path fills normal
 * defaults instead of the AE scoring garbage like 0-valued SpO2), and
 * cumulative counters (steps / calories) are aggregated over a rolling 24h
 * window so the AE sees daily-scale magnitudes (its training distribution)
 * instead of single 0-valued segments.
 *
 * Note: repeat-alert suppression is owned by the model layer (alert
 * hysteresis, src/ml-models) — this module intentionally does NOT dedupe.
 */

import type { HealthSampleType } from '@/data';

/** Plausibility ranges per HealthSampleType (inclusive). */
const PLAUSIBILITY: Partial<
  Record<HealthSampleType, { min: number; max: number }>
> = {
  spo2: { min: 30, max: 100 },
  heart_rate: { min: 20, max: 240 },
  respiratory_rate: { min: 4, max: 60 },
  blood_pressure_systolic: { min: 50, max: 250 },
  blood_pressure_diastolic: { min: 30, max: 150 },
  temperature: { min: 30, max: 43 }, // Celsius (Fahrenheit handled separately)
  blood_glucose: { min: 20, max: 600 },
  hrv_sdnn: { min: 1, max: 300 }, // SDNN <= 0 is implausible
  steps: { min: 0, max: 50000 },
  distance: { min: 0, max: 50000 },
  flights_climbed: { min: 0, max: 200 },
  calories_burned: { min: 0, max: 20000 },
  sleep: { min: 0, max: 24 },
  walking_steadiness: { min: 0, max: 100 },
  walking_speed: { min: 0.2, max: 3.5 },
  step_length: { min: 15, max: 150 },
  walking_asymmetry: { min: 0, max: 60 },
  walking_double_support: { min: 0, max: 60 },
  vo2_max: { min: 5, max: 80 },
  six_minute_walk_distance: { min: 10, max: 1500 },
  weight: { min: 1, max: 400 },
  height: { min: 30, max: 250 },
  coughing: { min: 0, max: 500 },
};

const FAHRENHEIT_UNITS = new Set(['f', 'fahrenheit', '°f', 'deg f', 'degree f']);

/**
 * Returns the value when it is plausible for the vital type, or `null` when
 * implausible (callers treat `null` as "missing" → imputation).
 */
export function sanitizeVitalValue(
  type: HealthSampleType,
  value: number,
  unit?: string,
): number | null {
  if (!Number.isFinite(value)) return null;

  let range = PLAUSIBILITY[type];
  if (type === 'temperature' && range) {
    const u = unit?.trim().toLowerCase() ?? '';
    range = FAHRENHEIT_UNITS.has(u) ? { min: 86, max: 110 } : { min: 30, max: 43 };
  }
  if (!range) return value;
  if (value < range.min || value > range.max) return null;
  return value;
}

/**
 * Sleep-quality score on the UC2 AE's 0–1 scale (9h of sleep maps to 1.0).
 * Note: the AE feature and scaler use 0–1; a 0–100 score would be ~100x
 * out-of-distribution and guarantee false anomalies.
 */
export function deriveSleepQuality(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, Math.min(1, Math.round((value / 9) * 100) / 100));
}

/** Rolling window for cumulative counters (24h). */
export const CUMULATIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Generous daily caps for aggregated counters (beyond these → treat as missing). */
export const CUMULATIVE_CAPS: Partial<Record<HealthSampleType, number>> = {
  steps: 250000,
  calories_burned: 60000,
};

/**
 * Sum sample values recorded within `[timestamp - windowMs, timestamp]`.
 * Non-finite and non-positive values are excluded.
 */
export function sumWindowValues(
  samples: { recordedAt: string; value: number }[],
  timestamp: number,
  windowMs = CUMULATIVE_WINDOW_MS,
): number {
  const start = timestamp - windowMs;
  let total = 0;
  for (const sample of samples) {
    const t = Date.parse(sample.recordedAt);
    if (!Number.isFinite(t) || t < start || t > timestamp) continue;
    if (Number.isFinite(sample.value) && sample.value > 0) {
      total += sample.value;
    }
  }
  return total;
}
