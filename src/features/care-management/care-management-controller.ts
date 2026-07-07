import type { ChatMessage } from '@/inference/inference-provider';
import { AlertAutoencoder } from '@/ml-models/alert-autoencoder';
import type { CoreVitals, ExtendedVitals } from '@/ml-models/alert-autoencoder/types';
import { SCENARIOS } from '@/ml-models/alert-autoencoder/mock-scenarios';
import {
  type AppleWatchVitalsInput,
  type CaregiverFinalAction,
  type UC2DecisionResult,
} from '@/ml-models/uc2-decision-layer';
import { createUC2ApplicationRuntime } from '@/services/ml/uc2-runtime-service';
import { stripControlTokens } from '@/utils/stripControlTokens';
import {
  retrieveClinicalChunksViaBm25,
  formatCitationsForPrompt,
  buildRetrievalQuery,
} from '@/clinical-evidence/retrieval-helper';
import type { FusedRetriever } from '@/knowledge/types';
import { getConditionsForPatient } from '@/data';
import type { VitalsScenario } from '@/ml-models/alert-autoencoder/mock-scenarios';
import { getEventBus } from '@/orchestration/event-bus';
import type { OrchestrationEvent } from '@/orchestration/events';
import type { CareManagementAction, CareManagementState, BatchParityRow } from './types';

function buildTimestamp(hour: number | undefined): string {
  const d = new Date();
  d.setHours(hour ?? 13, 0, 0, 0);
  return d.toISOString();
}

/**
 * Build the UC2 input from the scenario's extended vitals, overriding the six
 * core vitals with the (possibly edited) core values, and dropping any fields
 * the scenario marks missing so the imputation path fills them.
 */
function buildUC2Input(
  core: CoreVitals,
  extended: ExtendedVitals,
  hour: number | undefined,
  missingFields?: (keyof ExtendedVitals)[],
): AppleWatchVitalsInput {
  const input: AppleWatchVitalsInput = {
    patient_id: 'care-management-test',
    timestamp: buildTimestamp(hour),
    heart_rate: core.heart_rate,
    blood_oxygen: core.blood_oxygen,
    blood_pressure_systolic: core.blood_pressure_systolic,
    blood_pressure_diastolic: core.blood_pressure_diastolic,
    glucose_level: core.glucose_level,
    body_temperature: core.body_temperature,
    respiratory_rate: extended.respiratory_rate,
    activity_level: extended.activity_level,
    sleep_quality: extended.sleep_quality,
    stress_level: extended.stress_level,
    hrv_sdnn: extended.hrv_sdnn,
    steps_count: extended.steps_count,
    calories_burned: extended.calories_burned,
  };

  if (missingFields) {
    for (const field of missingFields) {
      // Mark as missing so imputation substitutes the fallback + tags it
      // `imputed` in the feature-quality provenance map.
      (input as Record<string, unknown>)[field as string] = undefined;
    }
  }

  return input;
}

async function buildExplanationPrompt(
  core: CoreVitals,
  result: UC2DecisionResult,
  patientId?: string,
  retriever?: FusedRetriever | null,
): Promise<ChatMessage[]> {
  const vitalsSummary = [
    `Heart Rate: ${core.heart_rate} bpm`,
    `SpO2: ${core.blood_oxygen}%`,
    `BP: ${core.blood_pressure_systolic}/${core.blood_pressure_diastolic} mmHg`,
    `Glucose: ${core.glucose_level} mg/dL`,
    `Temp: ${core.body_temperature}\u00B0F`,
  ].join(', ');

  const topFeatures = result.topFeatureEvidence
    .slice(0, 3)
    .map((f) => f.feature)
    .join(', ');

  // Retrieve clinical knowledge chunks from the knowledge cache (PubMed,
  // MedlinePlus, etc.) using the patient's condition + anomaly type + top
  // features as the query. Injects cited context into the prompt.
  let conditionName: string | undefined;
  if (patientId) {
    try {
      const conditions = getConditionsForPatient(patientId);
      conditionName = conditions.find((c) => c.isPrimary)?.name ?? conditions[0]?.name;
    } catch {
      // ignore — retrieval is best-effort
    }
  }

  const anomalyTypeReadable = result.initialAnomalyType.replace(/_/g, ' ').toLowerCase();
  const retrievalQuery = buildRetrievalQuery(conditionName, anomalyTypeReadable, topFeatures);
  const citations = await retrieveClinicalChunksViaBm25(retriever ?? null, retrievalQuery, 5);
  const citationBlock = formatCitationsForPrompt(citations);

  const systemContent =
    'You are a caregiver-support assistant inside a mobile health app. ' +
    'Explain an anomaly detection result in plain, calm language for a non-clinical family caregiver. ' +
    'Never diagnose. Never give medication instructions. ' +
    'Keep your answer to 80\u2013150 words. Lead with the bottom line, then 2\u20133 short bullet points, then red flags. ' +
    'Use Markdown formatting.' +
    (citations.length > 0
      ? '\n\nGround your explanation in the CLINICAL KNOWLEDGE block below. Add the source label in brackets after relevant statements (e.g., "Common side effects include nausea [Drug Label]" or "Studies show improved outcomes [PubMed]").'
      : '');

  const userContent =
    `An on-device anomaly model produced this result:\n` +
    `Vitals: ${vitalsSummary}\n` +
    `Pipeline: ${result.emergencyResult.pipelinePath}${result.emergencyResult.emergency ? ` (emergency: ${result.emergencyResult.reason})` : ''}\n` +
    `Anomaly type: ${anomalyTypeReadable}\n` +
    `Score: ${result.aeScore !== null ? result.aeScore.toFixed(2) : 'n/a'} (threshold ${result.threshold.toFixed(2)})\n` +
    `Top features: ${topFeatures || 'n/a'}\n` +
    `Final decision: ${result.finalDecision.final_notification_type.replace(/_/g, ' ').toLowerCase()}\n` +
    (citationBlock ? `\n${citationBlock}\n` : '') +
    `\nIn 80\u2013150 words, explain what this means and what the caregiver should do next.`;

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}

/**
 * Compare a scenario's expected metadata against the actual UC2 result. A row
 * passes only when every expected field that the scenario specifies matches.
 * Fields left unspecified on the scenario are not checked.
 */
function matchesScenario(scenario: VitalsScenario, result: UC2DecisionResult): boolean {
  if (scenario.expectedPipelinePath && scenario.expectedPipelinePath !== result.emergencyResult.pipelinePath) {
    return false;
  }
  if (scenario.expectedEmergencyReason && scenario.expectedEmergencyReason !== result.emergencyResult.reason) {
    return false;
  }
  if (scenario.expectedInitialAnomalyType && scenario.expectedInitialAnomalyType !== result.initialAnomalyType) {
    return false;
  }
  if (scenario.expectedPostHitlAnomalyType && scenario.expectedPostHitlAnomalyType !== result.postHitlAnomalyType) {
    return false;
  }
  if (scenario.expectedFinalNotificationType && scenario.expectedFinalNotificationType !== result.finalDecision.final_notification_type) {
    return false;
  }
  if (scenario.expectedSeverity !== undefined && scenario.expectedSeverity !== result.finalDecision.final_severity) {
    return false;
  }
  return true;
}

/**
 * Publish the UC2 result to the orchestrator event bus as a synthetic
 * vitals_sample, so the orchestrator's ML path creates a real alert + (when
 * severity warrants) a notification, and the Dashboard live-refreshes. This
 * lets the Care Management harness test the full graphic flow end-to-end.
 */
async function publishResultToOrchestrator(
  state: CareManagementState,
  result: UC2DecisionResult,
): Promise<void> {
  if (!state.coreVitals || !state.extendedVitals) return;
  try {
    const bus = getEventBus();
    const now = new Date().toISOString();
    // Publish the core vitals as individual samples so the orchestrator
    // persists them and the AlertMlService can read them back. Use the most
    // severe signal first so the threshold fast path can fire immediately.
    const samples: { type: string; value: number; unit: string }[] = [
      { type: 'spo2', value: state.coreVitals.blood_oxygen, unit: '%' },
      { type: 'heart_rate', value: state.coreVitals.heart_rate, unit: 'bpm' },
      { type: 'respiratory_rate', value: state.extendedVitals.respiratory_rate, unit: '/min' },
      { type: 'temperature', value: state.coreVitals.body_temperature, unit: 'F' },
    ];
    for (const s of samples) {
      const event: Extract<OrchestrationEvent, { type: 'vitals_sample' }> = {
        type: 'vitals_sample',
        patientId: state.selectedScenarioId ? `cm-${state.selectedScenarioId}` : 'care-management-test',
        sampleId: `cm-sample-${Date.now()}-${s.type}`,
        sampleType: s.type,
        value: s.value,
        unit: s.unit,
        recordedAt: now,
      };
      bus.publish(event);
    }
  } catch (err) {
    console.warn('[CareManagement] publish to orchestrator failed:', err);
  }
}

export function createCareManagementController(mlModel: AlertAutoencoder) {
  let abortController: AbortController | null = null;
  const uc2Runtime = createUC2ApplicationRuntime(mlModel);

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
        payload: {
          scenarioId,
          core,
          extended: scenario.vitals,
          hour: scenario.hour ?? 13,
          missingFields: scenario.missingFields ? [...scenario.missingFields] : [],
          observationCodes: scenario.presetObservationCodes
            ? [...scenario.presetObservationCodes]
            : [],
          caregiverAction: scenario.presetCaregiverAction ?? 'no_prompt_shown',
        },
      };
    },

    updateVitals(field: keyof CoreVitals, value: number): CareManagementAction {
      return { type: 'update-vitals', payload: { field, value } };
    },

    updateExtended(field: keyof ExtendedVitals, value: number): CareManagementAction {
      return { type: 'update-extended', payload: { field, value } };
    },

    toggleMissing(field: keyof ExtendedVitals): CareManagementAction {
      return { type: 'toggle-missing', payload: { field } };
    },

    setHour(hour: number): CareManagementAction {
      return { type: 'set-hour', payload: { hour } };
    },

    setObservationCodes(codes: string[]): CareManagementAction {
      return { type: 'set-observation-codes', payload: { codes } };
    },

    setCaregiverAction(action: CaregiverFinalAction): CareManagementAction {
      return { type: 'set-caregiver-action', payload: { action } };
    },

    runMLInference(state: CareManagementState): CareManagementAction {
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

      return { type: 'ml-start' };
    },

    /**
     * Run the full UC2 decision layer with the current vitals. The first run
     * uses default HITL (`no_prompt_shown`, no codes) and is saved as the
     * initial result for later diffing.
     */
    async executeUC2Decision(state: CareManagementState): Promise<CareManagementAction> {
      if (!state.coreVitals || !state.extendedVitals) {
        return { type: 'ml-error', payload: { error: 'No vitals loaded' } };
      }

      const input = buildUC2Input(
        state.coreVitals,
        state.extendedVitals,
        state.hour,
        state.missingFields,
      );

      try {
        const result = await uc2Runtime.evaluateUC2WithExistingRuntime({
          eventId: `uc2-cm-${Date.now()}`,
          vitals: input,
          caregiverFinalAction: 'no_prompt_shown',
          caregiverSelectedCodes: [],
        });

        if (state.publishToOrchestrator) {
          await publishResultToOrchestrator(state, result);
        }

        return { type: 'uc2-success', payload: { result, saveAsInitial: true } };
      } catch (err: any) {
        return { type: 'ml-error', payload: { error: err?.message ?? 'UC2 inference failed' } };
      }
    },

    /**
     * Re-run the UC2 decision layer with the caregiver's observation codes and
     * final action, producing the post-HITL classification + final decision.
     */
    async executeApplyHITL(state: CareManagementState): Promise<CareManagementAction> {
      if (!state.coreVitals || !state.extendedVitals) {
        return { type: 'ml-error', payload: { error: 'No vitals loaded' } };
      }

      const input = buildUC2Input(
        state.coreVitals,
        state.extendedVitals,
        state.hour,
        state.missingFields,
      );

      try {
        const result = await uc2Runtime.evaluateUC2WithExistingRuntime({
          eventId: `uc2-cm-${Date.now()}`,
          vitals: input,
          caregiverFinalAction: state.caregiverAction,
          caregiverSelectedCodes: state.observationCodes,
        });

        if (state.publishToOrchestrator) {
          await publishResultToOrchestrator(state, result);
        }

        return { type: 'uc2-success', payload: { result, saveAsInitial: false } };
      } catch (err: any) {
        return { type: 'ml-error', payload: { error: err?.message ?? 'HITL fuse failed' } };
      }
    },

    setPublish(enabled: boolean): CareManagementAction {
      return { type: 'set-publish', payload: { enabled } };
    },

    /**
     * Run every scenario through the full UC2 layer (with each scenario's
     * preset HITL) and compare expected vs actual metadata, producing a
     * pass/fail row per scenario.
     */
    async executeBatchParity(): Promise<CareManagementAction> {
      if (!uc2Runtime.isReady()) {
        return { type: 'batch-done', payload: { rows: [] } };
      }

      const rows: BatchParityRow[] = [];

      for (const scenario of SCENARIOS) {
        const core: CoreVitals = {
          heart_rate: scenario.vitals.heart_rate,
          blood_oxygen: scenario.vitals.blood_oxygen,
          blood_pressure_systolic: scenario.vitals.blood_pressure_systolic,
          blood_pressure_diastolic: scenario.vitals.blood_pressure_diastolic,
          glucose_level: scenario.vitals.glucose_level,
          body_temperature: scenario.vitals.body_temperature,
        };

        const input = buildUC2Input(
          core,
          scenario.vitals,
          scenario.hour ?? 13,
          scenario.missingFields,
        );

        try {
          const result = await uc2Runtime.evaluateUC2WithExistingRuntime({
            eventId: `uc2-batch-${scenario.id}`,
            vitals: input,
            caregiverFinalAction: scenario.presetCaregiverAction ?? 'no_prompt_shown',
            caregiverSelectedCodes: scenario.presetObservationCodes ?? [],
          });

          const row: BatchParityRow = {
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            expectedPipelinePath: scenario.expectedPipelinePath,
            actualPipelinePath: result.emergencyResult.pipelinePath,
            expectedInitialAnomalyType: scenario.expectedInitialAnomalyType,
            actualInitialAnomalyType: result.initialAnomalyType,
            expectedPostHitlAnomalyType: scenario.expectedPostHitlAnomalyType,
            actualPostHitlAnomalyType: result.postHitlAnomalyType,
            expectedFinalNotificationType: scenario.expectedFinalNotificationType,
            actualFinalNotificationType: result.finalDecision.final_notification_type,
            expectedSeverity: scenario.expectedSeverity,
            actualSeverity: result.finalDecision.final_severity,
            expectedEmergencyReason: scenario.expectedEmergencyReason,
            actualEmergencyReason: result.emergencyResult.reason,
            pass: matchesScenario(scenario, result),
          };
          rows.push(row);
        } catch (err: any) {
          rows.push({
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            pass: false,
            error: err?.message ?? 'failed',
          });
        }
      }

      return { type: 'batch-done', payload: { rows } };
    },

    requestSLMExplanation(state: CareManagementState): CareManagementAction {
      if (!state.coreVitals || !state.uc2Result) {
        return { type: 'noop' };
      }
      abortController = new AbortController();
      return { type: 'slm-start' };
    },

    async executeSLMExplanation(
      state: CareManagementState,
      chat: (
        messages: ChatMessage[],
        onToken: (token: string) => void,
        signal: AbortSignal,
      ) => Promise<any>,
      onToken: (token: string) => void,
      retriever?: FusedRetriever | null,
    ): Promise<CareManagementAction> {
      if (!state.coreVitals || !state.uc2Result) {
        return { type: 'noop' };
      }
      abortController = new AbortController();
      const messages = await buildExplanationPrompt(state.coreVitals, state.uc2Result, state.selectedScenarioId ? undefined : 'default-patient', retriever);

      // Accumulate tokens locally so the abort handler can strip whatever was
      // streamed before stop (the state parameter is a stale snapshot).
      let accumulated = '';
      const wrappedOnToken = (token: string) => {
        accumulated += token;
        onToken(token);
      };

      try {
        const result = await chat(messages, wrappedOnToken, abortController.signal);
        // Strip control tokens / thinking tags from the final text so only the
        // clean answer is shown. Capture any reasoning content the native
        // provider returns separately.
        const rawText = result?.text ?? accumulated;
        const stripped = stripControlTokens(rawText);
        const answer = stripped.answer;
        const thinking = result?.reasoningContent ?? stripped.thinking;
        return { type: 'slm-success', payload: { answer, thinking } };
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          // On stop, strip whatever was streamed so far.
          const stripped = stripControlTokens(accumulated);
          return { type: 'slm-success', payload: { answer: stripped.answer, thinking: stripped.thinking } };
        }
        return { type: 'slm-error', payload: { error: err?.message ?? 'SLM failed' } };
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
