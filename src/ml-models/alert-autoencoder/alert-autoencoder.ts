import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';
import type { AlertMlModel } from './alert-ml-interface';
import type {
  CoreVitals,
  ExtendedVitals,
  MLResult,
  ModelMetadata,
  StandardScalerParams,
  VitalsValidation,
} from './types';
import { VITALS_RANGES } from './types';

export class AlertAutoencoder implements AlertMlModel {
  private model: TfliteModel | null = null;
  private scaler: StandardScalerParams | null = null;
  private metadata: ModelMetadata | null = null;
  private loaded = false;

  get isLoaded(): boolean {
    return this.loaded;
  }

  get threshold(): number {
    return this.metadata?.threshold ?? 1.13;
  }

  /**
   * The fitted StandardScaler params (mean / scale), exposed so the UC2
   * decision layer can scale features itself and so callers can build a
   * TFLite runner bridge without reloading the JSON.
   */
  get scalerParams(): StandardScalerParams | null {
    return this.scaler;
  }

  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      this.scaler = require('./tiny_uc2_scaler.json') as StandardScalerParams;
      this.metadata = require('./tiny_uc2_metadata.json') as ModelMetadata;

      this.model = await loadTensorflowModel(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./tiny_uc2_autoencoder.tflite'),
        ['core-ml'],
      );

      this.loaded = true;
      console.log('[AlertAutoencoder] Model loaded successfully');
      console.log('[AlertAutoencoder] Inputs:', this.model.inputs);
      console.log('[AlertAutoencoder] Outputs:', this.model.outputs);
    } catch (err: any) {
      console.error('[AlertAutoencoder] Failed to load model:', err);
      throw new Error(`Failed to load autoencoder: ${err.message || 'Unknown error'}`);
    }
  }

  async release(): Promise<void> {
    if (this.model) {
      try {
        this.model.dispose();
      } catch {
        // ignore
      }
      this.model = null;
    }
    this.scaler = null;
    this.metadata = null;
    this.loaded = false;
  }

  static validateVitals(vitals: CoreVitals): VitalsValidation {
    const errors: string[] = [];
    for (const [key, range] of Object.entries(VITALS_RANGES)) {
      const value = vitals[key as keyof CoreVitals];
      if (value < range.min || value > range.max) {
        errors.push(`${range.label}: ${value} out of range (${range.min}-${range.max} ${range.unit})`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  buildFeatureVector(core: CoreVitals, extended: ExtendedVitals, timestamp?: Date): number[] {
    const hour = timestamp ? timestamp.getHours() + timestamp.getMinutes() / 60 : 12;
    const pulsePressure = core.blood_pressure_systolic - core.blood_pressure_diastolic;
    const map = core.blood_pressure_diastolic + pulsePressure / 3;
    const hourSin = Math.sin((2 * Math.PI * hour) / 24);
    const hourCos = Math.cos((2 * Math.PI * hour) / 24);
    const isSleepWindow = hour >= 22 || hour < 6 ? 1 : 0;

    return [
      core.heart_rate,
      core.blood_oxygen,
      core.blood_pressure_systolic,
      core.blood_pressure_diastolic,
      core.glucose_level,
      core.body_temperature,
      extended.respiratory_rate,
      extended.activity_level,
      extended.sleep_quality,
      extended.stress_level,
      extended.hrv_sdnn,
      extended.steps_count,
      extended.calories_burned,
      pulsePressure,
      map,
      hourSin,
      hourCos,
      isSleepWindow,
    ];
  }

  normalize(rawFeatures: number[]): number[] {
    if (!this.scaler) {
      throw new Error('Scaler not loaded');
    }
    return rawFeatures.map((val, i) => {
      const mean = this.scaler!.mean[i];
      const scale = this.scaler!.scale[i];
      return scale > 0 ? (val - mean) / scale : 0;
    });
  }

  /**
   * Run the TFLite autoencoder on an already-scaled 18-feature vector and
   * return the reconstruction vector. Used by the UC2 decision layer runner
   * bridge so the decision layer can compute its own MSE reconstruction error
   * and per-feature contributions (matching the notebook / model_handoff).
   */
  async runReconstruction(scaledInput: number[]): Promise<number[]> {
    if (!this.model) {
      throw new Error('Model not loaded');
    }

    const inputArray = new Float32Array(scaledInput);
    const inputBuffer = inputArray.buffer.slice(
      inputArray.byteOffset,
      inputArray.byteOffset + inputArray.byteLength,
    );

    const outputs = await this.model.run([inputBuffer]);
    const reconstruction = new Float32Array(outputs[0]);
    return Array.from(reconstruction);
  }

  async predict(normalizedInput: number[]): Promise<MLResult> {
    if (!this.model) {
      throw new Error('Model not loaded');
    }
    if (!this.metadata) {
      throw new Error('Metadata not loaded');
    }

    const reconstruction = await this.runReconstruction(normalizedInput);

    const featureErrors = normalizedInput.map((val, i) => {
      const diff = val - reconstruction[i];
      return diff * diff;
    });

    // MSE (not RMSE) — matches the model metadata threshold, which was fit on
    // validation mean-squared reconstruction error. The previous RMSE
    // computation systematically under-flagged anomalies (RMSE = sqrt(MSE)).
    const reconstructionError =
      featureErrors.reduce((sum, e) => sum + e, 0) / featureErrors.length;

    const anomalyScore = reconstructionError;
    const isAnomalous = anomalyScore > this.metadata.threshold;

    return {
      anomalyScore,
      isAnomalous,
      reconstructionError,
      featureErrors,
    };
  }

  async runInference(core: CoreVitals, extended: ExtendedVitals, timestamp?: Date): Promise<MLResult> {
    const raw = this.buildFeatureVector(core, extended, timestamp);
    const normalized = this.normalize(raw);
    return this.predict(normalized);
  }
}
