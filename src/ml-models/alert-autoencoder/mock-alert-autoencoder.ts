/**
 * Mock Alert ML model for Track A / Expo Go.
 *
 * Returns deterministic anomaly scores based on simple clinical heuristics so
 * the orchestrator path can be tested without loading a native TFLite model.
 */

import type { AlertMlModel } from './alert-ml-interface';
import type { CoreVitals, ExtendedVitals, MLResult } from './types';

export class MockAlertAutoencoder implements AlertMlModel {
  readonly threshold = 1.13;
  private loaded = false;

  get isLoaded(): boolean {
    return this.loaded;
  }

  async load(): Promise<void> {
    this.loaded = true;
  }

  async release(): Promise<void> {
    this.loaded = false;
  }

  async runInference(core: CoreVitals, extended: ExtendedVitals, _timestamp?: Date): Promise<MLResult> {
    // Deterministic heuristic score: red flags push the score above threshold.
    let score = 0.5;

    if (core.blood_oxygen < 90) score += 0.4;
    if (core.blood_oxygen < 88) score += 0.4;
    if (core.heart_rate > 100 || core.heart_rate < 50) score += 0.25;
    if (core.blood_pressure_systolic > 160 || core.blood_pressure_systolic < 90) score += 0.25;
    if (core.blood_pressure_diastolic > 100) score += 0.2;
    if (core.body_temperature > 100.4 || core.body_temperature < 96.0) score += 0.2;
    if (core.glucose_level < 70 || core.glucose_level > 180) score += 0.25;
    if (extended.respiratory_rate > 24) score += 0.25;
    if (extended.respiratory_rate > 30) score += 0.3;
    if (extended.sleep_quality < 0.3) score += 0.1;
    if (extended.stress_level > 0.7) score += 0.15;

    // Add a small deterministic noise-like term based on the values so the
    // score is not purely thresholded.
    score += (core.heart_rate % 7) / 100;

    const reconstructionError = score;
    const anomalyScore = score;
    const isAnomalous = anomalyScore > this.threshold;

    return {
      anomalyScore,
      isAnomalous,
      reconstructionError,
      featureErrors: new Array(18).fill(reconstructionError / 18),
    };
  }
}
