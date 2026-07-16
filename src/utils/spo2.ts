/**
 * SpO2 unit helpers.
 *
 * Canonical on the event bus and in patient thresholds: **0–100 percent**.
 * Some sensors/fixtures historically emit fraction (0–1). Normalize before
 * threshold compare or display.
 */

/** Convert fraction SpO2 (0–1] to percent; leave percent values unchanged. */
export function normalizeSpo2Percent(value: number): number {
  if (!Number.isFinite(value)) return value;
  return value > 0 && value <= 1 ? value * 100 : value;
}

/** True when the vital type is SpO2 (any casing/alias). */
export function isSpo2VitalType(vitalType: string): boolean {
  const t = vitalType.toLowerCase();
  return t === 'spo2' || t === 'blood_oxygen' || t === 'oxygen_saturation';
}

/**
 * Normalize a vitals value for threshold checks. Only SpO2 is unit-converted;
 * other vitals pass through unchanged.
 */
export function normalizeVitalForThreshold(vitalType: string, value: number): number {
  return isSpo2VitalType(vitalType) ? normalizeSpo2Percent(value) : value;
}
