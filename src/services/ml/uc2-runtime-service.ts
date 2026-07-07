import { AlertAutoencoder } from '@/ml-models/alert-autoencoder';
import {
  createTfliteInterpreterAdapter,
  runUC2DecisionLayerV2,
  type AppleWatchVitalsInput,
  type CaregiverFinalAction,
  type CaregiverHitlInput,
  type DecisionLayerResult,
  type HistoricalAnomalyEvent,
  type PatientProfile,
  type RawObservationInput,
  type UC2DecisionResult,
} from '@/ml-models/uc2-decision-layer';
import { patientProfileFromPlainObject } from '@/ml-models/uc2-decision-layer/ehrProfileAdapter';

export type EvaluateUC2WithExistingRuntimeParams = {
  vitals: AppleWatchVitalsInput;
  caregiverFinalAction?: CaregiverFinalAction;
  caregiverSelectedCodes?: string[];
  eventId?: string;
  profile?: PatientProfile;
  history?: HistoricalAnomalyEvent[];
};

export type UC2ApplicationRuntime = {
  isReady(): boolean;
  evaluateUC2WithExistingRuntime(
    params: EvaluateUC2WithExistingRuntimeParams,
  ): Promise<UC2DecisionResult>;
};

function appleWatchToRawObservation(input: AppleWatchVitalsInput): RawObservationInput {
  return {
    patient_id: input.patient_id,
    timestamp_iso: input.timestamp,
    heart_rate: input.heart_rate,
    blood_oxygen: input.blood_oxygen,
    blood_pressure_systolic: input.blood_pressure_systolic,
    blood_pressure_diastolic: input.blood_pressure_diastolic,
    glucose_level: input.glucose_level,
    body_temperature: input.body_temperature,
    respiratory_rate: input.respiratory_rate,
    steps_count: input.steps_count,
  };
}

function mapV2ToCompatResult(
  v2: DecisionLayerResult,
  threshold: number,
  promptShown: boolean,
): UC2DecisionResult {
  const aeScore = v2.ae?.ae_score ?? null;
  const isAnomaly = v2.ae?.is_anomaly ?? false;
  const emergencyResult = v2.emergency;
  const finalDecision = v2.final_decision;
  const initialAnomalyType = (v2.sensor_classification?.sensor_anomaly_type ?? 'NORMAL_PATTERN') as UC2DecisionResult['initialAnomalyType'];
  const postHitlAnomalyType = (finalDecision.post_hitl_anomaly_type ?? 'NORMAL_PATTERN') as UC2DecisionResult['postHitlAnomalyType'];

  return {
    emergencyResult,
    rawFeatures: v2.feature_vector ?? [],
    scaledFeatures: null,
    aeScore,
    threshold,
    isAnomaly,
    promptShown,
    initialAnomalyType,
    postHitlAnomalyType,
    topFeatureEvidence: v2.ae?.top_contributors ?? [],
    featureQuality: {},
    finalDecision: {
      ...finalDecision,
      final_severity: finalDecision.post_hitl_severity ?? 0,
      final_notification_type: finalDecision.final_notification_type,
      final_notification_title: finalDecision.final_notification_title ?? '',
      final_notification_body: finalDecision.final_notification_body ?? '',
    } as UC2DecisionResult['finalDecision'],
    initialMCPPayload: v2.initial_mcp_payload ?? null,
    finalSLMPayload: v2.final_slm_payload ?? null,
    ae_score_mse: aeScore,
    ml_anomaly_flag: isAnomaly,
    pre_hitl_severity: v2.sensor_classification?.pre_hitl_severity ?? 0,
    post_hitl_severity: finalDecision.post_hitl_severity ?? 0,
    sensor_anomaly_type: v2.sensor_classification?.sensor_anomaly_type ?? 'NORMAL_PATTERN',
    post_hitl_anomaly_type: postHitlAnomalyType,
    anomaly_family: v2.sensor_classification?.anomaly_family,
    caregiver_selected_codes: v2.caregiver_hitl?.caregiver_selected_codes ?? [],
    max_matrix_delta: v2.caregiver_hitl?.max_matrix_delta ?? 0,
    critical_route_triggered: v2.caregiver_hitl?.critical_route_triggered ?? false,
    personalized_threshold_severity_floor:
      v2.personalized_thresholds?.personalized_threshold_severity_floor ?? 0,
    recurrence_severity_floor: v2.recurrence?.recurrence_severity_floor ?? 0,
    final_notification_type: finalDecision.final_notification_type,
    final_notification_level: finalDecision.final_notification_level,
    quality_tags: v2.feature_quality_tags ?? [],
    quality_warnings: v2.feature_quality_tags?.filter(t => t.warning).map(t => t.warning!) ?? [],
    emergency_rule_result: emergencyResult,
    slm_payload: v2.final_slm_payload ?? null,
    provider_payload: v2.final_slm_payload ?? null,
    mcp_payload: v2.initial_mcp_payload ?? null,
    audit_event: v2.audit_event,
  } as UC2DecisionResult;
}

export function createUC2ApplicationRuntime(
  mlModel: AlertAutoencoder,
): UC2ApplicationRuntime {
  return {
    isReady(): boolean {
      return mlModel.isLoaded && mlModel.scalerParams !== null;
    },

    async evaluateUC2WithExistingRuntime({
      vitals,
      caregiverSelectedCodes = [],
      eventId = `uc2-${Date.now()}`,
      profile,
      history,
    }: EvaluateUC2WithExistingRuntimeParams): Promise<UC2DecisionResult> {
      const scaler = mlModel.scalerParams;
      if (!scaler) {
        throw new Error('ML scaler not loaded');
      }
      if (!mlModel.isLoaded) {
        throw new Error('ML model not loaded');
      }

      const raw = appleWatchToRawObservation(vitals);

      const caregiverInput: CaregiverHitlInput | undefined =
        caregiverSelectedCodes.length > 0
          ? {
              selected_codes: caregiverSelectedCodes as CaregiverHitlInput['selected_codes'],
              confirmed_at_iso: new Date().toISOString(),
            }
          : undefined;

      const result = await runUC2DecisionLayerV2({
        raw,
        profile,
        caregiverInput,
        history,
        scaler: { mean: scaler.mean, scale: scaler.scale },
        interpreter: createTfliteInterpreterAdapter(mlModel),
        aeThreshold: mlModel.threshold,
      });

      return mapV2ToCompatResult(result, mlModel.threshold, caregiverInput !== undefined);
    },
  };
}
