/**
 * Complex Event Processing (CEP) pattern matcher.
 *
 * Pure function over a sliding window of recent events. Runs *before* the
 * Alert ML model and *before* any SLM call. It is deterministic and cheap.
 */

import type { OrchestrationEvent } from './events';

export type CepRule = {
  name: string;
  /** Returns true when the pattern matches. */
  match: (window: OrchestrationEvent[]) => boolean;
  /** Action to emit when matched. */
  action: (window: OrchestrationEvent[]) => CepAction | null;
};

export type CepAction =
  | { type: 'drop'; reason: string }
  | { type: 'promote_to_alert_ml'; sampleId: string; patientId: string; reason: string }
  | { type: 'emergency_fast_path'; patientId: string; reason: string };

const WINDOW_SIZE = 50;

export class CepEngine {
  private window: OrchestrationEvent[] = [];
  private rules: CepRule[] = [];

  constructor(rules: CepRule[] = DEFAULT_RULES) {
    this.rules = rules;
  }

  ingest(event: OrchestrationEvent): CepAction | null {
    this.window.push(event);
    if (this.window.length > WINDOW_SIZE) {
      this.window.shift();
    }

    for (const rule of this.rules) {
      if (rule.match(this.window)) {
        return rule.action(this.window);
      }
    }
    return null;
  }

  getWindow(): readonly OrchestrationEvent[] {
    return this.window;
  }
}

function isVitalsSample(e: OrchestrationEvent): e is Extract<OrchestrationEvent, { type: 'vitals_sample' }> {
  return e.type === 'vitals_sample';
}

function isSpo2Sample(e: OrchestrationEvent): e is Extract<OrchestrationEvent, { type: 'vitals_sample' }> {
  return isVitalsSample(e) && e.sampleType === 'spo2';
}

/**
 * Soften noise suppression: only drop when the last N samples of the *same*
 * type are nearly identical (no meaningful change). Do not abort mixed-type
 * batches (SpO2+HR+RR) or clear trends — those must reach threshold + ML.
 *
 * SpO2 values are treated as 0–100 percent (canonical on the bus).
 */
export const DEFAULT_RULES: CepRule[] = [
  {
    name: 'suppress_noisy_single_reading',
    match: (window) => {
      const samples = window.filter(isVitalsSample);
      if (samples.length < 4) return false;
      const last = samples.slice(-4);
      const sameType = last.every((s) => s.sampleType === last[0].sampleType);
      if (!sameType) return false;
      // Nearly-flat series of the same type → sensor noise; skip ML for this tick.
      const values = last.map((s) => s.value);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const isSpo2 = last[0].sampleType === 'spo2';
      // SpO2 percent: <0.5 pt change; other vitals: <1 unit change.
      const flatThreshold = isSpo2 ? 0.5 : 1;
      return max - min < flatThreshold;
    },
    action: () => ({ type: 'drop', reason: 'flat single-type noise' }),
  },
  {
    name: 'promote_spo2_drop',
    match: (window) => {
      const samples = window.filter(isSpo2Sample);
      if (samples.length < 2) return false;
      const last = samples.slice(-2);
      // SpO2 is percent: a 3-point drop (e.g. 94 → 91).
      return last[1].value < last[0].value - 3;
    },
    action: (window) => {
      const last = window.filter(isSpo2Sample).slice(-1)[0];
      return {
        type: 'promote_to_alert_ml',
        sampleId: last.sampleId,
        patientId: last.patientId,
        reason: 'SpO2 dropped 3% or more',
      };
    },
  },
];

export function createDefaultCepEngine(): CepEngine {
  return new CepEngine(DEFAULT_RULES);
}
