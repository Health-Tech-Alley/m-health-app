/**
 * Alert ML service.
 *
 * Maintains a rolling per-patient window of recent health samples, aggregates
 * them into the CoreVitals + ExtendedVitals shape the AlertAutoencoder expects,
 * and runs the model when enough data is available. Emits
 * `ml_alert_created` events on the orchestration bus when an anomaly is found.
 */

import { getLatestHealthSample, type HealthSampleType } from '@/data';
import type { AlertMlModel, CoreVitals, ExtendedVitals, MLResult } from '@/ml-models/alert-autoencoder';
import { getEventBus } from '@/orchestration/event-bus';
import type { OrchestrationEvent } from '@/orchestration/events';

const MIN_SAMPLE_TYPES = 3;

export class AlertMlService {
  private model: AlertMlModel;
  private bus = getEventBus();

  constructor(model: AlertMlModel) {
    this.model = model;
  }

  async load(): Promise<void> {
    await this.model.load();
  }

  async release(): Promise<void> {
    await this.model.release();
  }

  /**
   * Called for every new vitals_sample event. Pulls the latest samples from
   * SQLite and, if enough types are present, runs the Alert ML model.
   */
  async evaluate(patientId: string, triggeringEvent: Extract<OrchestrationEvent, { type: 'vitals_sample' }>): Promise<MLResult | null> {
    if (!this.model.isLoaded) {
      await this.load();
    }

    const vitals = this.buildVitalsFromRecentSamples(patientId);
    if (!vitals) return null;

    const result = await this.model.runInference(vitals.core, vitals.extended, new Date(triggeringEvent.recordedAt));

    if (result.isAnomalous) {
      const features = this.buildFeatureVector(vitals.core, vitals.extended, new Date(triggeringEvent.recordedAt));
      const event: Extract<OrchestrationEvent, { type: 'ml_alert_created' }> = {
        type: 'ml_alert_created',
        alertId: `ml-alert-${Date.now()}`,
        patientId,
        severity: this.inferSeverity(result, vitals.core),
        score: result.anomalyScore,
        features,
        at: new Date().toISOString(),
      };
      this.bus.publish(event);
    }

    return result;
  }

  private buildVitalsFromRecentSamples(patientId: string): { core: CoreVitals; extended: ExtendedVitals } | null {
    const get = (type: HealthSampleType) => getLatestHealthSample(patientId, type)?.value ?? null;

    const spo2 = get('spo2');
    const heartRate = get('heart_rate');
    const bpSys = get('blood_pressure_systolic');
    const bpDia = get('blood_pressure_diastolic');
    const temp = get('temperature');
    const glucose = get('blood_glucose');
    const resp = get('respiratory_rate');
    const steps = get('steps');

    const presentTypes = [spo2, heartRate, bpSys, bpDia, temp, glucose, resp].filter((v) => v !== null).length;
    if (presentTypes < MIN_SAMPLE_TYPES) return null;

    // Convert SpO2 fraction to percentage for the autoencoder (the existing
    // model was trained on 0-100 scale).
    const spo2Percent = spo2 === null ? 97 : spo2 <= 1.0 ? spo2 * 100 : spo2;

    const core: CoreVitals = {
      heart_rate: heartRate ?? 72,
      blood_oxygen: spo2Percent,
      blood_pressure_systolic: bpSys ?? 120,
      blood_pressure_diastolic: bpDia ?? 80,
      glucose_level: glucose ?? 100,
      body_temperature: temp ?? 98.6,
    };

    const extended: ExtendedVitals = {
      ...core,
      respiratory_rate: resp ?? 16,
      activity_level: 0.2,
      sleep_quality: 0.6,
      stress_level: 0.3,
      hrv_sdnn: 45,
      steps_count: steps ?? 1000,
      calories_burned: 150,
    };

    return { core, extended };
  }

  private inferSeverity(result: MLResult, core: CoreVitals): 1 | 2 | 3 {
    if (core.blood_oxygen < 88 || core.heart_rate > 130 || core.heart_rate < 45) return 3;
    if (result.anomalyScore > this.model.threshold * 1.3) return 3;
    if (result.anomalyScore > this.model.threshold * 1.1) return 2;
    return 1;
  }

  private buildFeatureVector(core: CoreVitals, extended: ExtendedVitals, timestamp: Date): number[] {
    const hour = timestamp.getHours() + timestamp.getMinutes() / 60;
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
}
