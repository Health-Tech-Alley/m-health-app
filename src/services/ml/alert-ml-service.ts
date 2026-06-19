/**
 * Alert ML service.
 *
 * Maintains a rolling per-patient window of recent health samples, builds the
 * UC2 input, runs the full UC2 decision layer (rule engine -> autoencoder ->
 * contextual routing -> final decision) over the loaded TFLite model, and
 * emits `ml_alert_created` events on the orchestration bus when an anomaly is
 * found — carrying the full UC2 result so the orchestrator can persist it and
 * dispatch notifications + the SLM bridge.
 */

import { getLatestHealthSample, type HealthSampleType } from '@/data';
import type { AlertMlModel } from '@/ml-models/alert-autoencoder';
import type { CoreVitals, ExtendedVitals } from '@/ml-models/alert-autoencoder/types';
import type {
  AppleWatchVitalsInput,
  UC2DecisionResult,
} from '@/ml-models/uc2-decision-layer';
import {
  createAlertAutoencoderRunner,
  runUC2DecisionLayer,
} from '@/ml-models/uc2-decision-layer';
import type { AlertAutoencoder } from '@/ml-models/alert-autoencoder/alert-autoencoder';
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
   * SQLite and, if enough types are present, runs the UC2 decision layer.
   */
  async evaluate(
    patientId: string,
    triggeringEvent: Extract<OrchestrationEvent, { type: 'vitals_sample' }>,
  ): Promise<UC2DecisionResult | null> {
    if (!this.model.isLoaded) {
      await this.load();
    }

    const built = this.buildInputFromRecentSamples(patientId, new Date(triggeringEvent.recordedAt));
    if (!built) return null;

    // The UC2 layer needs a concrete AlertAutoencoder for the TFLite runner.
    // When the configured model is one, use it directly; otherwise fall back
    // to the legacy per-model inference path (kept for the mock provider).
    const result = await this.runDecisionLayer(built.input);

    if (result && (result.isAnomaly || result.emergencyResult.emergency)) {
      this.emitAlert(patientId, result, built.deviceId);
    }

    return result;
  }

  /**
   * Run the UC2 decision layer directly from an explicit vitals input (used by
   * the Care Management harness and tests). Returns the full result.
   */
  async runDecisionLayer(input: AppleWatchVitalsInput): Promise<UC2DecisionResult | null> {
    if (!this.model.isLoaded) {
      await this.load();
    }

    // The runner requires the real AlertAutoencoder (TFLite). If the
    // configured model exposes a scaler + runReconstruction, use the UC2
    // layer; otherwise the mock provider can't produce a reconstruction
    // vector, so fall back to legacy inference.
    const ae = this.model as unknown as AlertAutoencoder;
    const scaler = ae.scalerParams;
    if (!scaler || typeof ae.runReconstruction !== 'function') {
      return this.runLegacy(input);
    }

    const runner = createAlertAutoencoderRunner(ae);
    return runUC2DecisionLayer({
      eventId: `uc2-${Date.now()}`,
      input,
      scaler: { mean: scaler.mean, scale: scaler.scale },
      threshold: this.model.threshold,
      runTFLiteAutoencoder: runner,
      caregiverFinalAction: 'no_prompt_shown',
      caregiverSelectedCodes: [],
    });
  }

  /**
   * Legacy single-shot inference path for the mock provider (no TFLite bridge).
   */
  private async runLegacy(input: AppleWatchVitalsInput): Promise<UC2DecisionResult | null> {
    const core: CoreVitals = {
      heart_rate: input.heart_rate ?? 72,
      blood_oxygen: input.blood_oxygen ?? 97,
      blood_pressure_systolic: input.blood_pressure_systolic ?? 120,
      blood_pressure_diastolic: input.blood_pressure_diastolic ?? 80,
      glucose_level: input.glucose_level ?? 100,
      body_temperature: input.body_temperature ?? 98.6,
    };
    const extended: ExtendedVitals = {
      ...core,
      respiratory_rate: input.respiratory_rate ?? 16,
      activity_level: input.activity_level ?? 0.2,
      sleep_quality: input.sleep_quality ?? 0.6,
      stress_level: input.stress_level ?? 0.3,
      hrv_sdnn: input.hrv_sdnn ?? 45,
      steps_count: input.steps_count ?? 1000,
      calories_burned: input.calories_burned ?? 150,
    };

    const result = await this.model.runInference(core, extended, new Date(input.timestamp));
    const isAnomaly = result.isAnomalous;

    // Reuse the UC2 result shape with a minimal payload so downstream code
    // stays uniform. The mock provider doesn't run the rule engine / routing,
    // so we approximate classification from the score.
    const topFeatureEvidence: import('@/ml-models/uc2-decision-layer').TopFeatureEvidence[] = [];
    const featureQuality: Record<string, import('@/ml-models/uc2-decision-layer').FeatureQuality> = {};

    const initialAnomalyType: import('@/ml-models/uc2-decision-layer').UC2ContextualType =
      isAnomaly ? 'GENERAL_MULTIVARIATE_ANOMALY' : 'NORMAL_PATTERN';

    const finalDecision: import('@/ml-models/uc2-decision-layer').FinalDecisionResult = {
      final_notification_type: isAnomaly ? 'SLM_SUMMARY_AND_PROVIDER_NOTE' : 'NO_ALERT',
      final_notification_level: isAnomaly ? 'follow_up' : null,
      final_severity: isAnomaly ? 2 : 0,
      final_notification_title: isAnomaly ? 'Follow-up recommended' : '',
      final_notification_body: isAnomaly
        ? 'An unusual pattern was detected by the anomaly model.'
        : '',
      slm_refinement_queued: isAnomaly,
      refinement_reason: isAnomaly ? 'ML anomaly detected.' : null,
    };

    return {
      emergencyResult: {
        emergency: false,
        severity: 0,
        reason: null,
        pipelinePath: 'UC2_SLOW_PATH',
      },
      rawFeatures: [],
      scaledFeatures: null,
      aeScore: result.reconstructionError,
      threshold: this.model.threshold,
      isAnomaly,
      promptShown: isAnomaly,
      initialAnomalyType,
      postHitlAnomalyType: initialAnomalyType,
      topFeatureEvidence,
      featureQuality,
      finalDecision,
      initialMCPPayload: null,
      finalSLMPayload: null,
    };
  }

  private buildInputFromRecentSamples(
    patientId: string,
    timestamp: Date,
  ): { input: AppleWatchVitalsInput; deviceId?: string } | null {
    const get = (type: HealthSampleType) => getLatestHealthSample(patientId, type)?.value ?? null;

    const spo2 = get('spo2');
    const heartRate = get('heart_rate');
    const bpSys = get('blood_pressure_systolic');
    const bpDia = get('blood_pressure_diastolic');
    const temp = get('temperature');
    const glucose = get('blood_glucose');
    const resp = get('respiratory_rate');
    const steps = get('steps');

    const presentTypes = [spo2, heartRate, bpSys, bpDia, temp, glucose, resp].filter(
      (v) => v !== null,
    ).length;
    if (presentTypes < MIN_SAMPLE_TYPES) return null;

    // Convert SpO2 fraction to percentage for the UC2 model (trained on 0-100).
    const spo2Percent = spo2 === null ? undefined : spo2 <= 1.0 ? spo2 * 100 : spo2;

    const input: AppleWatchVitalsInput = {
      patient_id: patientId,
      timestamp: timestamp.toISOString(),
      heart_rate: heartRate ?? undefined,
      blood_oxygen: spo2Percent,
      blood_pressure_systolic: bpSys ?? undefined,
      blood_pressure_diastolic: bpDia ?? undefined,
      glucose_level: glucose ?? undefined,
      body_temperature: temp ?? undefined,
      respiratory_rate: resp ?? undefined,
      steps_count: steps ?? undefined,
      // Extended vitals not yet sourced from HealthKit — left undefined so the
      // UC2 imputation path fills them with patient-profile / fallback defaults
      // and tags them `imputed` in the feature-quality provenance.
      activity_level: undefined,
      sleep_quality: undefined,
      stress_level: undefined,
      hrv_sdnn: undefined,
      calories_burned: undefined,
    };

    return { input };
  }

  private emitAlert(
    patientId: string,
    result: UC2DecisionResult,
    deviceId?: string,
  ): void {
    const severity = result.finalDecision.final_severity as 1 | 2 | 3;
    const scoreRatio =
      result.aeScore !== null && result.threshold > 0
        ? result.aeScore / result.threshold
        : null;

    const topFeatures: [string, number][] = result.topFeatureEvidence.map((f) => [
      f.feature,
      f.importance,
    ]);

    const event: Extract<OrchestrationEvent, { type: 'ml_alert_created' }> = {
      type: 'ml_alert_created',
      alertId: `ml-alert-${Date.now()}`,
      patientId,
      severity,
      score: result.aeScore ?? 0,
      features: result.rawFeatures,
      at: new Date().toISOString(),
      deviceId,
      eventType: 'TRIGGER_WORKFLOW_ANOMALY_TYPE_04',
      modelVersion: 'tiny_ae_uc2_v0.1.0',
      threshold: result.threshold,
      reconstructionError: result.aeScore ?? undefined,
      topFeatures,
      ruleEngine: {
        is_emergency: result.emergencyResult.emergency,
        severity: result.emergencyResult.severity,
        reasons: result.emergencyResult.reason ? [result.emergencyResult.reason] : [],
      },
      rawVitals: Object.fromEntries(
        Object.entries(result.featureQuality).map(([k]) => [k, 0]),
      ),
      pipelinePath: result.emergencyResult.pipelinePath,
      initialAnomalyType: result.initialAnomalyType,
      postHitlAnomalyType: result.postHitlAnomalyType,
      featureQuality: result.featureQuality,
      scoreRatio: scoreRatio ?? undefined,
      notificationTitle: result.finalDecision.final_notification_title || undefined,
      notificationBody: result.finalDecision.final_notification_body || undefined,
    };
    this.bus.publish(event);
  }
}
