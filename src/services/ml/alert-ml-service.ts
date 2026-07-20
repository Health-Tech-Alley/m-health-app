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

import {
  getLatestHealthSample,
  type HealthSample,
  type HealthSampleType,
  type MlRawVitalsInputEnvelope,
} from '@/data';
import type { PatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';
import type { AlertMlModel } from '@/ml-models/alert-autoencoder';
import type { AlertAutoencoder } from '@/ml-models/alert-autoencoder/alert-autoencoder';
import type {
  CoreVitals,
  ExtendedVitals,
  StandardScalerParams,
} from '@/ml-models/alert-autoencoder/types';
import type {
  AppleWatchVitalsInput,
  PatientProfile,
  TopFeatureEvidence,
  UC2DecisionResult,
} from '@/ml-models/uc2-decision-layer';
import {
  buildUC2FeatureVector,
  createTfliteInterpreterAdapter,
  finalDecision,
  patientProfileFromPlainObject,
  runEmergencyRuleEngine,
  runUC2DecisionLayerV2,
  shouldShowCaregiverPrompt,
} from '@/ml-models/uc2-decision-layer';
import { getEventBus } from '@/orchestration/event-bus';
import type { OrchestrationEvent } from '@/orchestration/events';
import { store } from '@/store';
import {
  filterLiveVitalReadingsForPatient,
  type LiveVitalReading,
} from '@/store/reducers/vitalsSlice';
import { normalizeSpo2Percent } from '@/utils/spo2';
import { toRawObservationInput } from './uc2-runtime-service';

const MIN_SAMPLE_TYPES = 2;
/** HITL / fallback: need at least one of SpO2 or HR (imputation fills the rest). */
const MIN_HITL_CORE_VITALS = 1;

function shortPatientId(patientId: string): string {
  return patientId.length > 6 ? `...${patientId.slice(-6)}` : patientId;
}

function toUc2BodyTemperature(value: number, unit?: string): number {
  const normalizedUnit = unit?.trim().toLowerCase();
  if (
    normalizedUnit === 'c' ||
    normalizedUnit === 'cel' ||
    normalizedUnit === 'celsius' ||
    normalizedUnit === '°c'
  ) {
    return (value * 9) / 5 + 32;
  }
  return value;
}

type InputProvenance = MlRawVitalsInputEnvelope['provenance'];
type ProvenanceSample = Pick<
  HealthSample,
  'sampleId' | 'source' | 'value' | 'recordedAt' | 'receivedAt' | 'unit' | 'metadataJson'
>;

type BuiltMlInput = {
  input: AppleWatchVitalsInput;
  provenance: InputProvenance;
  evaluatedAt: string;
  deviceId?: string;
};

type RuntimeInputField =
  | 'heart_rate'
  | 'blood_oxygen'
  | 'blood_pressure_systolic'
  | 'blood_pressure_diastolic'
  | 'glucose_level'
  | 'body_temperature'
  | 'respiratory_rate'
  | 'steps_count';

type TfliteCapableAlertModel = AlertMlModel & {
  readonly scalerParams: StandardScalerParams | null;
  runReconstruction(scaledInput: number[]): Promise<number[]>;
};

function hasTfliteRuntime(model: AlertMlModel): model is TfliteCapableAlertModel {
  return (
    'scalerParams' in model &&
    'runReconstruction' in model &&
    typeof model.runReconstruction === 'function'
  );
}

export function buildMlRawVitalsInputEnvelope(params: {
  input: AppleWatchVitalsInput;
  provenance: InputProvenance;
  evaluatedAt: string;
}): MlRawVitalsInputEnvelope {
  return {
    contract: 'AppleWatchVitalsInput',
    contractVersion: 1,
    input: params.input,
    provenance: params.provenance,
    evaluatedAt: params.evaluatedAt,
  };
}

function sampleProvenance(
  sample: ProvenanceSample,
  healthSampleType: HealthSampleType,
): InputProvenance[string] {
  return {
    source: sample.source,
    sampleId: sample.sampleId,
    recordedAt: sample.recordedAt,
    receivedAt: sample.receivedAt,
    unit: sample.unit,
    healthSampleType,
    metadataJson: sample.metadataJson,
  };
}

export function getRecentReadingsFromRedux(
  patientId: string,
  type: HealthSampleType,
  sinceMs: number,
  limit: number,
): LiveVitalReading[] {
  const vitals = store.getState().vitals;
  if (vitals.activePatientId !== patientId || vitals.readings.length === 0) {
    return [];
  }

  return filterLiveVitalReadingsForPatient(vitals.readings, patientId, {
    type,
    since: sinceMs,
    limit,
  });
}

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
   *
   * `snapshot` is the latest PatientRecordSnapshot; used to build the
   * `PatientProfile` that drives personalized severity floors (per
   * planning/14 §13 — without a profile, `personalizedThresholds.ts` is
   * silently inactive).
   */
  async evaluate(
    patientId: string,
    triggeringEvent: Extract<OrchestrationEvent, { type: 'vitals_sample' }>,
    snapshot: PatientRecordSnapshot | null = null,
    readings?: LiveVitalReading[],
  ): Promise<UC2DecisionResult | null> {
    if (__DEV__) {
      console.log('[ML] Evaluating vitals_sample for patientId=', shortPatientId(patientId), 'sampleType=', triggeringEvent.sampleType);
    }
    if (!this.model.isLoaded) {
      await this.load();
    }
    if (__DEV__) {
      console.log('[ML] Model loaded:', this.model.isLoaded, 'threshold:', this.model.threshold);
    }

    const built = readings
      ? this.buildInputFromReadings(patientId, new Date(triggeringEvent.recordedAt), readings)
      : this.buildInputFromRecentSamples(patientId, new Date(triggeringEvent.recordedAt));
    if (!built) return null;
    if (__DEV__) {
      console.log('[ML] Built UC2 input for patientId=', shortPatientId(patientId), 'input:', {
        ...built.input,
        patient_id: shortPatientId(patientId),
      }, 'provenance:', built.provenance);
    }

    const profile = this.buildProfileFromSnapshot(patientId, snapshot);

    // The UC2 layer needs a concrete AlertAutoencoder for the TFLite runner.
    // When the configured model is one, use it directly; otherwise fall back
    // to the legacy per-model inference path (kept for the mock provider).
    const result = await this.runDecisionLayer(built.input, profile);
    if (__DEV__) {
      console.log(`[ML] UC2 decision layer result for patientId=${shortPatientId(patientId)}:`, result);
    }

    if (result && (result.isAnomaly || result.emergencyResult.emergency)) {
      this.emitAlert(
        patientId,
        result,
        buildMlRawVitalsInputEnvelope({
          input: built.input,
          provenance: built.provenance,
          evaluatedAt: built.evaluatedAt,
        }),
        built.deviceId,
      );
    }

    return result;
  }

  /**
   * Public wrapper for HITL re-runs and chat tooling that need a PatientProfile
   * without going through ambient `evaluate()`.
   */
  profileFromSnapshot(
    patientId: string,
    snapshot: PatientRecordSnapshot | null,
  ): PatientProfile | undefined {
    return this.buildProfileFromSnapshot(patientId, snapshot);
  }

  /**
   * Build UC2 input from latest SQLite samples. Ambient path requires
   * MIN_SAMPLE_TYPES distinct vitals; HITL fallback accepts SpO2 and/or HR only.
   */
  tryBuildInputFromRecentSamples(
    patientId: string,
    options?: { minTypes?: number; requireCoreVital?: boolean },
  ): AppleWatchVitalsInput | null {
    const built = this.buildInputFromRecentSamples(patientId, new Date(), {
      minTypes: options?.minTypes ?? MIN_HITL_CORE_VITALS,
      requireCoreVital: options?.requireCoreVital ?? true,
    });
    return built?.input ?? null;
  }

  /**
   * Build a `PatientProfile` for the v2 decision layer from the active
   * PatientRecordSnapshot. Returns undefined if no snapshot is available —
   * the v2 layer tolerates an absent profile (it just skips personalized
   * threshold floor + CP severity scale lookups).
   */
  private buildProfileFromSnapshot(
    patientId: string,
    snapshot: PatientRecordSnapshot | null,
  ): PatientProfile | undefined {
    if (!snapshot) return undefined;
    const patient = snapshot.patient;
    if (!patient) return undefined;

    return patientProfileFromPlainObject(patientId, {
      display_name: patient.name,
      conditions: snapshot.conditions
        .filter((c) => !c.needsReview)
        .map((c) => c.name)
        .filter(Boolean),
      medications: snapshot.medications.map((m) => m.name).filter(Boolean),
      care_plan_goals: snapshot.carePlanGoals.map((g) => g.description),
      resting_heart_rate: patient.baselineHeartRate
        ? parseFloat(String(patient.baselineHeartRate).replace(/[^\d.]/g, ''))
        : undefined,
      gmfcs_level: (patient as { gmfcs?: string }).gmfcs,
      macs: patient.macs,
      cfcs: patient.cfcs,
      edacs: patient.edacs,
    });
  }

  /**
   * Run the UC2 decision layer v2 directly from an explicit vitals input (used by
   * the Care Management harness and tests). Returns the full result mapped to
   * the UC2DecisionResult compat shape.
   *
   * `profile` is optional but recommended: when supplied, the v2 layer applies
   * personalized severity floors (e.g. for CP GMFCS Level V patients) and the
   * Caregiver HITL matrix uses the patient's care context.
   */
  async runDecisionLayer(
    input: AppleWatchVitalsInput,
    profile?: PatientProfile,
    caregiverSelectedCodes: string[] = [],
  ): Promise<UC2DecisionResult | null> {
    if (!this.model.isLoaded) {
      await this.load();
    }

    // The runner requires the real AlertAutoencoder (TFLite). If the
    // configured model exposes a scaler + runReconstruction, use the UC2
    // v2 layer; otherwise the mock provider can't produce a reconstruction
    // vector, so fall back to legacy inference.
    if (!hasTfliteRuntime(this.model)) {
      return this.runLegacyEmergencyFastPath(input) ?? this.runLegacy(input);
    }

    const ae = this.model as AlertAutoencoder;
    const scaler = ae.scalerParams;
    if (!scaler) {
      return this.runLegacyEmergencyFastPath(input) ?? this.runLegacy(input);
    }

    const v2Result = await runUC2DecisionLayerV2({
      raw: toRawObservationInput(input),
      profile,
      caregiverInput:
        caregiverSelectedCodes.length > 0
          ? {
              selected_codes: caregiverSelectedCodes as import('@/ml-models/uc2-decision-layer').CaregiverObservationCode[],
              confirmed_at_iso: new Date().toISOString(),
            }
          : undefined,
      scaler: { mean: scaler.mean, scale: scaler.scale },
      interpreter: createTfliteInterpreterAdapter(ae),
      aeThreshold: this.model.threshold,
    });

    const patientIdForDrain = input.patient_id?.trim();
    if (patientIdForDrain) {
      try {
        const { drainPendingProposalsForPatient } = require('../carePlan/mlPlanProposalService') as typeof import('../carePlan/mlPlanProposalService');
        drainPendingProposalsForPatient(patientIdForDrain, 'uc2');
      } catch (err) {
        console.warn('[AlertML] ADCP proposal drain failed:', err instanceof Error ? err.message : err);
      }
    }

    const aeScore = v2Result.ae?.ae_score ?? null;
    const isAnomaly = v2Result.ae?.is_anomaly ?? false;
    const finalDec = v2Result.final_decision;
    const topFeatureEvidence: TopFeatureEvidence[] =
      v2Result.ae?.top_contributors.map((contributor) => ({
        feature: contributor.feature,
        importance: contributor.contribution,
        direction: 'unknown',
        source: 'ae_reconstruction_contribution',
      })) ?? [];
    const promptShown = shouldShowCaregiverPrompt({
      emergency: Boolean(
        v2Result.emergency.is_emergency ?? v2Result.emergency.emergency,
      ),
      isAnomaly: Boolean(isAnomaly),
    });

    return {
      emergencyResult: v2Result.emergency,
      rawFeatures: v2Result.feature_vector ?? [],
      scaledFeatures: null,
      aeScore,
      threshold: this.model.threshold,
      isAnomaly,
      promptShown,
      initialAnomalyType: v2Result.sensor_classification?.sensor_anomaly_type ?? 'NORMAL_PATTERN',
      postHitlAnomalyType: finalDec.post_hitl_anomaly_type ?? 'NORMAL_PATTERN',
      topFeatureEvidence,
      featureQuality: {},
      finalDecision: {
        ...finalDec,
        final_severity: finalDec.post_hitl_severity ?? 0,
        final_notification_title: finalDec.final_notification_title ?? '',
        final_notification_body: finalDec.final_notification_body ?? '',
      } as UC2DecisionResult['finalDecision'],
      initialMCPPayload: v2Result.initial_mcp_payload ?? null,
      finalSLMPayload: v2Result.final_slm_payload ?? null,
      ae_score_mse: aeScore,
      ml_anomaly_flag: isAnomaly,
      pre_hitl_severity: v2Result.sensor_classification?.pre_hitl_severity ?? 0,
      post_hitl_severity: finalDec.post_hitl_severity ?? 0,
      sensor_anomaly_type: v2Result.sensor_classification?.sensor_anomaly_type ?? 'NORMAL_PATTERN',
      post_hitl_anomaly_type: (finalDec.post_hitl_anomaly_type ?? 'NORMAL_PATTERN') as UC2DecisionResult['post_hitl_anomaly_type'],
      anomaly_family: v2Result.caregiver_hitl?.anomaly_family,
      caregiver_selected_codes: v2Result.caregiver_hitl?.caregiver_selected_codes ?? [],
      max_matrix_delta: v2Result.caregiver_hitl?.max_matrix_delta ?? 0,
      critical_route_triggered: v2Result.caregiver_hitl?.critical_route_triggered ?? false,
      personalized_threshold_severity_floor:
        v2Result.personalized_thresholds?.personalized_threshold_severity_floor ?? 0,
      recurrence_severity_floor: v2Result.recurrence?.recurrence_severity_floor ?? 0,
      final_notification_type: finalDec.final_notification_type,
      final_notification_level: finalDec.final_notification_level,
      quality_tags: v2Result.feature_quality_tags ?? [],
      quality_warnings: v2Result.feature_quality_tags?.filter(t => t.warning).map(t => t.warning!) ?? [],
      emergency_rule_result: v2Result.emergency,
      slm_payload: v2Result.final_slm_payload ?? null,
      provider_payload: v2Result.final_slm_payload ?? null,
      mcp_payload: v2Result.initial_mcp_payload ?? null,
      audit_event: v2Result.audit_event,
    };
  }

  /**
   * Legacy single-shot inference path for the mock provider (no TFLite bridge).
   */
  private runLegacyEmergencyFastPath(input: AppleWatchVitalsInput): UC2DecisionResult | null {
    const featureVector = buildUC2FeatureVector(input);
    const emergencyResult = runEmergencyRuleEngine(featureVector.featureMap);
    if (!emergencyResult.emergency) {
      return null;
    }

    const initialAnomalyType = 'CRITICAL_EMERGENCY_ALERT' as const;
    const postHitlAnomalyType = 'CRITICAL_EMERGENCY_ALERT' as const;
    const decision = finalDecision({
      emergency: true,
      promptShown: false,
      caregiverFinalAction: 'no_prompt_shown',
      postHitlAnomalyType,
    });

    return {
      emergencyResult,
      rawFeatures: featureVector.rawFeatures,
      scaledFeatures: null,
      aeScore: null,
      threshold: this.model.threshold,
      isAnomaly: false,
      promptShown: false,
      initialAnomalyType,
      postHitlAnomalyType,
      topFeatureEvidence: [],
      featureQuality: featureVector.featureQuality,
      finalDecision: decision,
      initialMCPPayload: null,
      finalSLMPayload: null,
    };
  }

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

  private buildInputFromReadings(
    patientId: string,
    timestamp: Date,
    readings: LiveVitalReading[],
    options?: { minTypes?: number; requireCoreVital?: boolean },
  ): BuiltMlInput | null {
    const get = (type: HealthSampleType): LiveVitalReading | null => {
      const matches = readings.filter(
        (reading) => reading.patientId === patientId && reading.type === type,
      );
      matches.sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
      return matches[0] ?? null;
    };

    return this.buildInputFromLatestSamples(patientId, timestamp, get, options);
  }

  private buildInputFromRecentSamples(
    patientId: string,
    timestamp: Date,
    options?: { minTypes?: number; requireCoreVital?: boolean },
  ): BuiltMlInput | null {
    const get = (type: HealthSampleType) => getLatestHealthSample(patientId, type);

    return this.buildInputFromLatestSamples(patientId, timestamp, get, options);
  }

  private buildInputFromLatestSamples(
    patientId: string,
    timestamp: Date,
    get: (type: HealthSampleType) => ProvenanceSample | null,
    options?: { minTypes?: number; requireCoreVital?: boolean },
  ): BuiltMlInput | null {

    const spo2 = get('spo2');
    const heartRate = get('heart_rate');
    const bpSys = get('blood_pressure_systolic');
    const bpDia = get('blood_pressure_diastolic');
    const temp = get('temperature');
    const glucose = get('blood_glucose');
    const resp = get('respiratory_rate');
    const steps = get('steps');

    const qualifyingSamples: Array<[HealthSampleType, ProvenanceSample | null]> = [
      ['spo2', spo2],
      ['heart_rate', heartRate],
      ['blood_pressure_systolic', bpSys],
      ['blood_pressure_diastolic', bpDia],
      ['temperature', temp],
      ['blood_glucose', glucose],
      ['respiratory_rate', resp],
    ];
    const qualifyingTypes = qualifyingSamples
      .filter(([, sample]) => sample !== null)
      .map(([type]) => type);
    const presentTypes = qualifyingTypes.length;
    const minTypes = options?.minTypes ?? MIN_SAMPLE_TYPES;
    const latestSources = qualifyingSamples.reduce<string[]>((sources, [, sample]) => {
      if (sample?.source && !sources.includes(sample.source)) {
        sources.push(sample.source);
      }
      return sources;
    }, []);
    if (presentTypes < minTypes) {
      if (__DEV__) {
        console.log('[ML] Wearable readiness', {
          patient: shortPatientId(patientId),
          qualifyingTypes,
          requiredMinimum: minTypes,
          sources: latestSources,
          reason: 'insufficient_sample_types',
        });
      }
      return null;
    }

    if (options?.requireCoreVital) {
      const hasCore = spo2 !== null || heartRate !== null;
      if (!hasCore) {
        if (__DEV__) {
          console.log('[ML] Wearable readiness', {
            patient: shortPatientId(patientId),
            qualifyingTypes,
            requiredMinimum: minTypes,
            sources: latestSources,
            reason: 'missing_core_vital',
          });
        }
        return null;
      }
    }

    if (__DEV__) {
      console.log('[ML] Wearable readiness', {
        patient: shortPatientId(patientId),
        qualifyingTypes,
        requiredMinimum: minTypes,
        sources: latestSources,
        reason: 'ready',
      });
    }

    // Convert SpO2 fraction to percentage for the UC2 model (trained on 0-100).
    const spo2Percent =
      spo2 === null ? undefined : normalizeSpo2Percent(spo2.value);

    const input: AppleWatchVitalsInput = {
      patient_id: patientId,
      timestamp: timestamp.toISOString(),
      heart_rate: heartRate?.value ?? undefined,
      blood_oxygen: spo2Percent,
      blood_pressure_systolic: bpSys?.value ?? undefined,
      blood_pressure_diastolic: bpDia?.value ?? undefined,
      glucose_level: glucose?.value ?? undefined,
      body_temperature: temp ? toUc2BodyTemperature(temp.value, temp.unit) : undefined,
      respiratory_rate: resp?.value ?? undefined,
      steps_count: steps?.value ?? undefined,
      // Extended vitals not yet sourced from HealthKit — left undefined so the
      // UC2 imputation path fills them with patient-profile / fallback defaults
      // and tags them `imputed` in the feature-quality provenance.
      activity_level: undefined,
      sleep_quality: undefined,
      stress_level: undefined,
      hrv_sdnn: undefined,
      calories_burned: undefined,
    };

    const provenanceEntries: Partial<Record<RuntimeInputField, InputProvenance[string]>> = {
      heart_rate: heartRate ? sampleProvenance(heartRate, 'heart_rate') : undefined,
      blood_oxygen: spo2 ? sampleProvenance(spo2, 'spo2') : undefined,
      blood_pressure_systolic: bpSys
        ? sampleProvenance(bpSys, 'blood_pressure_systolic')
        : undefined,
      blood_pressure_diastolic: bpDia
        ? sampleProvenance(bpDia, 'blood_pressure_diastolic')
        : undefined,
      glucose_level: glucose ? sampleProvenance(glucose, 'blood_glucose') : undefined,
      body_temperature: temp ? sampleProvenance(temp, 'temperature') : undefined,
      respiratory_rate: resp ? sampleProvenance(resp, 'respiratory_rate') : undefined,
      steps_count: steps ? sampleProvenance(steps, 'steps') : undefined,
    };

    const provenance = Object.fromEntries(
      Object.entries(provenanceEntries).filter(
        (entry): entry is [string, InputProvenance[string]] => entry[1] !== undefined,
      ),
    );

    return { input, provenance, evaluatedAt: input.timestamp };
  }

  private emitAlert(
    patientId: string,
    result: UC2DecisionResult,
    rawVitals: MlRawVitalsInputEnvelope,
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
      rawVitals,
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
