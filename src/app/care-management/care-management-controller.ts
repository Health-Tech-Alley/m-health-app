import type { ChatMessage } from '@/inference/inference-provider';
import { AlertAutoencoder } from '@/ml-models/alert-autoencoder';
import type { CoreVitals, ExtendedVitals, MLResult } from '@/ml-models/alert-autoencoder/types';
import { SCENARIOS } from '@/ml-models/alert-autoencoder/mock-scenarios';
import type { CareManagementAction, CareManagementState } from './types';

function buildExplanationPrompt(core: CoreVitals, result: MLResult): ChatMessage[] {
  const vitalsSummary = [
    `Heart Rate: ${core.heart_rate} bpm`,
    `SpO2: ${core.blood_oxygen}%`,
    `Blood Pressure: ${core.blood_pressure_systolic}/${core.blood_pressure_diastolic} mmHg`,
    `Glucose: ${core.glucose_level} mg/dL`,
    `Temperature: ${core.body_temperature}\u00B0F`,
  ].join('\n');

  return [
    {
      role: 'system',
      content:
        'You are a clinical decision support assistant for family caregivers. ' +
        'You analyze patient vitals and anomaly detection results. ' +
        'Provide clear, actionable guidance. Always remind the caregiver this is guidance, not medical advice. ' +
        'Cite evidence when possible.\n\n' +
        'IMPORTANT: Structure your response in two parts:\n' +
        '1. First, provide your reasoning in a <THINKING> section\n' +
        '2. Then, provide the final explanation in an <EXPLANATION> section\n\n' +
        'Format your response exactly like this:\n' +
        '<THINKING>\n' +
        '[Your reasoning process here]\n' +
        '</THINKING>\n\n' +
        '<EXPLANATION>\n' +
        '[Your final explanation for the caregiver here]\n' +
        '</EXPLANATION>',
    },
    {
      role: 'user',
      content:
        `An anomaly detection model flagged the following patient vitals.\n\n` +
        `**Vitals:**\n${vitalsSummary}\n\n` +
        `**ML Anomaly Score:** ${result.anomalyScore.toFixed(3)} (threshold: 1.130, ${result.isAnomalous ? 'ANOMALOUS' : 'normal'})\n` +
        `**Reconstruction Error:** ${result.reconstructionError.toFixed(3)}\n\n` +
        `Please explain:\n` +
        `1. Which vitals appear most concerning and why\n` +
        `2. What conditions these patterns might suggest\n` +
        `3. What the caregiver should do next\n` +
        `4. When to seek emergency care`,
    },
  ];
}

export function createCareManagementController(mlModel: AlertAutoencoder) {
  let abortController: AbortController | null = null;

  return {
    selectScenario(scenarioId: string): CareManagementAction {
      const scenario = SCENARIOS.find((s) => s.id === scenarioId);
      if (!scenario) return { type: 'noop' };

      const core: CoreVitals = {
        heart_rate: scenario.vitals.heart_rate,
        blood_oxygen: scenario.vitals.blood_oxygen,
        blood_pressure_systolic: scenario.vitals.blood_pressure_systolic,
        blood_pressure_diastolic: scenario.vitals.blood_pressure_diastolic,
        glucose_level: scenario.vitals.glucose_level,
        body_temperature: scenario.vitals.body_temperature,
      };

      return {
        type: 'select-scenario',
        payload: { scenarioId, core, extended: scenario.vitals },
      };
    },

    updateVitals(field: keyof CoreVitals, value: number): CareManagementAction {
      return { type: 'update-vitals', payload: { field, value } };
    },

    runMLInference(
      state: CareManagementState,
    ): CareManagementAction {
      if (!state.coreVitals || !state.extendedVitals) {
        return { type: 'ml-error', payload: { error: 'No vitals loaded' } };
      }

      if (!mlModel.isLoaded) {
        return { type: 'ml-error', payload: { error: 'ML model not loaded' } };
      }

      const validation = AlertAutoencoder.validateVitals(state.coreVitals);
      if (!validation.valid) {
        return { type: 'ml-error', payload: { error: validation.errors.join('; ') } };
      }

      return {
        type: 'ml-start',
      };
    },

    async executeMLInference(
      core: CoreVitals,
      extended: ExtendedVitals,
    ): Promise<CareManagementAction> {
      try {
        const result = await mlModel.runInference(core, extended, new Date());
        return { type: 'ml-success', payload: { result } };
      } catch (err: any) {
        return { type: 'ml-error', payload: { error: err.message ?? 'ML inference failed' } };
      }
    },

    requestSLMExplanation(
      state: CareManagementState,
      chat: (
        messages: ChatMessage[],
        onToken: (token: string) => void,
        signal: AbortSignal,
      ) => Promise<any>,
    ): CareManagementAction {
      if (!state.coreVitals || !state.mlResult) {
        return { type: 'noop' };
      }

      abortController = new AbortController();

      return {
        type: 'slm-start',
      };
    },

    async executeSLMExplanation(
      core: CoreVitals,
      result: MLResult,
      chat: (
        messages: ChatMessage[],
        onToken: (token: string) => void,
        signal: AbortSignal,
      ) => Promise<any>,
      onToken: (token: string) => void,
    ): Promise<CareManagementAction> {
      abortController = new AbortController();
      const messages = buildExplanationPrompt(core, result);

      try {
        await chat(messages, onToken, abortController.signal);
        return { type: 'slm-success' };
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return { type: 'slm-success' };
        }
        return { type: 'slm-error', payload: { error: err.message ?? 'SLM failed' } };
      }
    },

    stopSLM(): CareManagementAction {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      return { type: 'noop' };
    },

    reset(): CareManagementAction {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      return { type: 'reset' };
    },
  };
}
