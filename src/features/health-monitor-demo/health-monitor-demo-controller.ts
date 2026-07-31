import type { ChatMessage } from '@/inference/inference-provider';
import { AlertAutoencoder } from '@/ml-models/alert-autoencoder';
import type {
  CaregiverHitlInput,
  DecisionLayerResult,
  HistoricalAnomalyEvent,
  PatientProfile,
  RawObservationInput,
} from '@/ml-models/uc2-decision-layer';
import {
  createTfliteInterpreterAdapter,
  runUC2DecisionLayerV2,
} from '@/ml-models/uc2-decision-layer';
import { stripControlTokens } from '@/utils/stripControlTokens';

import type { V2Toggle } from './types';

import { fixtureEhrBaselineRaw, fixtureEhrBaselineProfile, fixtureEhrBaselineCaregiver } from '@/ml-models/uc2-decision-layer/fixtures/fixture_ehr_baseline_threshold';
import { fixtureEmergencyRaw, fixtureEmergencyProfile } from '@/ml-models/uc2-decision-layer/fixtures/fixture_emergency_fast_path';
import { fixtureMatrixBreathingRespRaw, fixtureMatrixBreathingRespProfile, fixtureMatrixBreathingRespCaregiver } from '@/ml-models/uc2-decision-layer/fixtures/fixture_matrix_breathing_resp';
import { fixtureMatrixVomitingGiRaw, fixtureMatrixVomitingGiProfile, fixtureMatrixVomitingGiCaregiver } from '@/ml-models/uc2-decision-layer/fixtures/fixture_matrix_vomiting_gi';
import { fixtureMatrixWeakConfusedSeizureRaw, fixtureMatrixWeakConfusedSeizureProfile, fixtureMatrixWeakConfusedSeizureCaregiver } from '@/ml-models/uc2-decision-layer/fixtures/fixture_matrix_weak_confused_seizure_like';
import { fixtureNormalRaw, fixtureNormalProfile } from '@/ml-models/uc2-decision-layer/fixtures/fixture_normal';
import { fixtureRecurrenceRaw, fixtureRecurrenceProfile, fixtureRecurrenceCaregiver, fixtureRecurrenceHistory } from '@/ml-models/uc2-decision-layer/fixtures/fixture_recurrence_escalation';
import { fixtureRespiratoryRaw, fixtureRespiratoryProfile, fixtureRespiratoryCaregiver } from '@/ml-models/uc2-decision-layer/fixtures/fixture_respiratory_followup';
import { fixtureSensorIssueRaw, fixtureSensorIssueProfile, fixtureSensorIssueCaregiver } from '@/ml-models/uc2-decision-layer/fixtures/fixture_sensor_issue';
import { fixtureSlowPathGiRaw, fixtureSlowPathGiProfile, fixtureSlowPathGiCaregiver } from '@/ml-models/uc2-decision-layer/fixtures/fixture_slow_path_gi';

export type V2Fixture = {
  id: string;
  name: string;
  raw: RawObservationInput;
  profile: PatientProfile;
  caregiver?: CaregiverHitlInput;
  history?: HistoricalAnomalyEvent[];
};

export const V2_FIXTURES: V2Fixture[] = [
  { id: 'normal', name: 'Normal Resting', raw: fixtureNormalRaw, profile: fixtureNormalProfile },
  { id: 'emergency', name: 'Emergency Fast Path (SpO2 86%)', raw: fixtureEmergencyRaw, profile: fixtureEmergencyProfile },
  { id: 'ehr-baseline', name: 'EHR Baseline Threshold (SpO2 93%)', raw: fixtureEhrBaselineRaw, profile: fixtureEhrBaselineProfile, caregiver: fixtureEhrBaselineCaregiver },
  { id: 'recurrence', name: 'Recurrence Escalation (2 prior resp events)', raw: fixtureRecurrenceRaw, profile: fixtureRecurrenceProfile, caregiver: fixtureRecurrenceCaregiver, history: fixtureRecurrenceHistory },
  { id: 'matrix-breathing', name: 'HITL Matrix: Breathing Different', raw: fixtureMatrixBreathingRespRaw, profile: fixtureMatrixBreathingRespProfile, caregiver: fixtureMatrixBreathingRespCaregiver },
  { id: 'matrix-vomiting', name: 'HITL Matrix: Vomiting/Diarrhea', raw: fixtureMatrixVomitingGiRaw, profile: fixtureMatrixVomitingGiProfile, caregiver: fixtureMatrixVomitingGiCaregiver },
  { id: 'matrix-seizure', name: 'HITL Matrix: Weak/Confused/Seizure-like', raw: fixtureMatrixWeakConfusedSeizureRaw, profile: fixtureMatrixWeakConfusedSeizureProfile, caregiver: fixtureMatrixWeakConfusedSeizureCaregiver },
  { id: 'sensor-issue', name: 'Sensor Issue (data quality warning)', raw: fixtureSensorIssueRaw, profile: fixtureSensorIssueProfile, caregiver: fixtureSensorIssueCaregiver },
  { id: 'respiratory-followup', name: 'Respiratory Follow-up', raw: fixtureRespiratoryRaw, profile: fixtureRespiratoryProfile, caregiver: fixtureRespiratoryCaregiver },
  { id: 'slow-path-gi', name: 'Slow Path GI', raw: fixtureSlowPathGiRaw, profile: fixtureSlowPathGiProfile, caregiver: fixtureSlowPathGiCaregiver },
];

const MOCK_SCALER = { mean: new Array(12).fill(0), scale: new Array(12).fill(1) };

export function createHealthMonitorDemoController(mlModel: AlertAutoencoder) {
  let abortController: AbortController | null = null;

  return {
    async runPipelines(params: {
      raw: RawObservationInput;
      profile: PatientProfile;
      caregiver?: CaregiverHitlInput;
      history?: HistoricalAnomalyEvent[];
      toggles: V2Toggle;
    }): Promise<{ v2: DecisionLayerResult }> {
      const { raw, profile, caregiver, history, toggles } = params;

      // Use the real StandardScaler params when the model is loaded so the
      // AE score is on the same scale as the training-time threshold. Fall
      // back to the identity scaler only when running without the native
      // TFLite module (Expo Go / JS-only).
      const scaler = mlModel.scalerParams
        ? { mean: mlModel.scalerParams.mean, scale: mlModel.scalerParams.scale }
        : MOCK_SCALER;

      const v2 = await runUC2DecisionLayerV2({
        raw,
        profile: (toggles.useEhrThresholds || toggles.usePersonalizedThresholds) ? profile : undefined,
        caregiverInput: toggles.useHitlMatrix ? caregiver : undefined,
        history: toggles.useRecurrence ? history : undefined,
        scaler,
        interpreter: mlModel.isLoaded ? createTfliteInterpreterAdapter(mlModel) : undefined,
        aeThreshold: mlModel.threshold,
      });

      return { v2 };
    },

    buildExplanationMessages(v2: DecisionLayerResult): ChatMessage[] {
      const system: ChatMessage = {
        role: 'system',
        content:
          'You are a caregiver-support assistant. Explain a Health Monitor result in plain, calm language for a family caregiver. Never diagnose. Keep your answer to 2-3 sentences. Lead with the bottom line. Use Markdown.',
      };

      const lines: string[] = [];
      lines.push(`Emergency: ${v2.emergency.is_emergency ? `YES (${v2.emergency.reason})` : 'No'}`);
      if (v2.ae) {
        lines.push(`AE Score: ${v2.ae.ae_score.toFixed(3)} (threshold ${v2.ae.ae_threshold.toFixed(3)}, anomaly: ${v2.ae.is_anomaly})`);
      }
      if (v2.sensor_classification) {
        lines.push(`Sensor Type: ${v2.sensor_classification.sensor_anomaly_type}`);
        lines.push(`Pre-HITL Severity: ${v2.sensor_classification.pre_hitl_severity}`);
      }
      if (v2.caregiver_hitl) {
        lines.push(`HITL Max Delta: +${v2.caregiver_hitl.max_matrix_delta}`);
        lines.push(`HITL Critical Route: ${v2.caregiver_hitl.critical_route_triggered ? 'Yes' : 'No'}`);
        if (v2.caregiver_hitl.observation_reasons.length > 0) {
          lines.push(`HITL Reasons: ${v2.caregiver_hitl.observation_reasons.join('; ')}`);
        }
      }
      if (v2.personalized_thresholds) {
        lines.push(`Personalized Floor: ${v2.personalized_thresholds.personalized_threshold_severity_floor}`);
      }
      if (v2.recurrence) {
        lines.push(`Recurrence Floor: ${v2.recurrence.recurrence_severity_floor}`);
        lines.push(`Same-class Count: ${v2.recurrence.same_class_count}`);
      }
      if (v2.final_decision) {
        lines.push(`Final Decision: ${v2.final_decision.final_notification_type}`);
        lines.push(`Final Severity: ${v2.final_decision.post_hitl_severity}`);
        lines.push(`Notification: ${v2.final_decision.final_notification_title}`);
      }
      lines.push('');
      lines.push('In 2-3 sentences, explain what this means for the caregiver.');

      const user: ChatMessage = { role: 'user', content: lines.join('\n') };
      return [system, user];
    },

    async runSLMExplanation(
      v2: DecisionLayerResult,
      chat: (messages: ChatMessage[], onToken: (token: string) => void, signal: AbortSignal) => Promise<{ text: string; reasoningContent?: string | null }>,
      onToken: (token: string) => void,
    ): Promise<{ answer: string }> {
      abortController = new AbortController();
      const messages = this.buildExplanationMessages(v2);
      try {
        const result = await chat(messages, onToken, abortController.signal);
        const stripped = stripControlTokens(result.text);
        return { answer: stripped.answer };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return { answer: '' };
        }
        throw err;
      }
    },

    stopSLM(): void {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
    },
  };
}
