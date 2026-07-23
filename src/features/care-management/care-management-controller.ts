import type {
  ChatMessage,
  ChatResult,
  GenerateOptions,
} from '@/inference/inference-provider';
import { CONCIERGE_GENERATION_DEEP } from '@/constants/concierge';
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
import type { FusedRetriever } from '@/knowledge/types';
import type { PatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';
import type { VitalsScenario } from '@/ml-models/alert-autoencoder/mock-scenarios';
import { prepareSlmTurn } from '@/services/slm/prepareSlmTurn';
import type { CareManagementAction, CareManagementState, BatchParityRow } from './types';

/** Same chat signature as SLMProvider.chat / main Concierge tab. */
export type CareManagementChatFn = (
  messages: ChatMessage[],
  onToken: (token: string) => void,
  signal: AbortSignal,
  options?: GenerateOptions,
  onReasoningToken?: (token: string) => void,
) => Promise<ChatResult>;

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

/**
 * Build Concierge explain messages via shared prepareSlmTurn (same NLU path as chat).
 */
async function buildExplanationPrompt(
  core: CoreVitals,
  result: UC2DecisionResult,
  snapshot?: PatientRecordSnapshot | null,
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
    .slice(0, 5)
    .map((f) => `${f.feature}${typeof f.importance === 'number' ? ` (${f.importance.toFixed(3)})` : ''}`)
    .join(', ');

  const severity =
    result.finalDecision?.final_severity ?? result.post_hitl_severity ?? 'n/a';
  const postHitl = result.postHitlAnomalyType ?? result.post_hitl_anomaly_type;
  const aeScore =
    result.aeScore !== null && result.aeScore !== undefined
      ? result.aeScore.toFixed(3)
      : result.ae_score_mse != null
        ? Number(result.ae_score_mse).toFixed(3)
        : 'n/a';

  const baseUser =
    `Please explain this on-device Health Monitor (anomaly) result for me as the family caregiver.\n\n` +
    `HEALTH MONITOR RESULT\n` +
    `Vitals: ${vitalsSummary}\n` +
    `Pipeline: ${result.emergencyResult.pipelinePath}` +
    `${result.emergencyResult.emergency ? ` (emergency: ${result.emergencyResult.reason ?? result.emergencyResult.reasons?.join('; ') ?? 'yes'})` : ''}\n` +
    `Initial anomaly type: ${String(result.initialAnomalyType).replace(/_/g, ' ')}\n` +
    (postHitl
      ? `Post-review anomaly type: ${String(postHitl).replace(/_/g, ' ')}\n`
      : '') +
    `AE score: ${aeScore} (threshold ${Number(result.threshold).toFixed(3)})\n` +
    `Is anomaly: ${result.isAnomaly ? 'yes' : 'no'}\n` +
    `Severity: ${severity}\n` +
    `Top features: ${topFeatures || 'n/a'}\n` +
    `Final notification: ${String(result.finalDecision.final_notification_type).replace(/_/g, ' ').toLowerCase()}\n` +
    (result.finalDecision.final_notification_title
      ? `Title: ${result.finalDecision.final_notification_title}\n`
      : '') +
    (result.finalDecision.final_notification_body
      ? `Body: ${result.finalDecision.final_notification_body}\n`
      : '') +
    `\nExplain what this means in plain language and what I should do next. ` +
    `Lead with the bottom line. Use Markdown. Never diagnose. ` +
    `Do not invent numbers that are not in the result or care context.`;

  const prepared = await prepareSlmTurn({
    userText: baseUser,
    snapshot: snapshot ?? null,
    retriever: retriever ?? null,
    forceDeep: true,
    intentOverride: 'explain_anomaly',
    skillHint: 'explain-anomaly',
    logTag: 'CareManagement',
  });

  return [
    { role: 'system', content: prepared.systemContext },
    { role: 'user', content: prepared.userContent },
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
 * Publish the computed UC2 result through the orchestrator's existing
 * ml_alert_created event, so alert + ml_event persistence stays centralized.
 */
async function publishResultToOrchestrator(
  state: CareManagementState,
  result: UC2DecisionResult,
  input: AppleWatchVitalsInput,
  patientId: string,
): Promise<void> {
  if (!state.coreVitals || !state.extendedVitals) return;
  const { publishUc2ResultAsAlert } = await import('@/services/ml/publish-uc2-alert');
  const scenarioId = state.selectedScenarioId ?? 'custom';
  publishUc2ResultAsAlert({
    patientId,
    result,
    input: { ...input, patient_id: patientId },
    alertIdPrefix: `cm-alert-${scenarioId}`,
    caregiverBlock:
      state.observationCodes.length > 0
        ? {
            action: state.caregiverAction,
            confirmed: true,
            observations: state.observationCodes,
          }
        : undefined,
  });
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
    async executeUC2Decision(
      state: CareManagementState,
      activePatientId?: string | null,
    ): Promise<CareManagementAction> {
      if (!state.coreVitals || !state.extendedVitals) {
        return { type: 'ml-error', payload: { error: 'No vitals loaded' } };
      }
      let publishPatientId: string | null = null;
      if (state.publishToOrchestrator) {
        const activeId = activePatientId?.trim();
        if (!activeId) {
          return { type: 'ml-error', payload: { error: 'No active patient selected for publishing' } };
        }
        publishPatientId = activeId;
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

        if (publishPatientId) {
          await publishResultToOrchestrator(state, result, input, publishPatientId);
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
    async executeApplyHITL(
      state: CareManagementState,
      activePatientId?: string | null,
    ): Promise<CareManagementAction> {
      if (!state.coreVitals || !state.extendedVitals) {
        return { type: 'ml-error', payload: { error: 'No vitals loaded' } };
      }
      let publishPatientId: string | null = null;
      if (state.publishToOrchestrator) {
        const activeId = activePatientId?.trim();
        if (!activeId) {
          return { type: 'ml-error', payload: { error: 'No active patient selected for publishing' } };
        }
        publishPatientId = activeId;
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

        if (publishPatientId) {
          await publishResultToOrchestrator(state, result, input, publishPatientId);
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
      chat: CareManagementChatFn,
      onToken: (token: string) => void,
      retriever?: FusedRetriever | null,
      snapshot?: PatientRecordSnapshot | null,
    ): Promise<CareManagementAction> {
      if (!state.coreVitals || !state.uc2Result) {
        return { type: 'noop' };
      }
      abortController = new AbortController();
      const messages = await buildExplanationPrompt(
        state.coreVitals,
        state.uc2Result,
        snapshot ?? null,
        retriever,
      );

      // Same generation profile as main Concierge tab: unlimited tokens
      // (maxTokens=-1), deep reasoning — no 192-token default cap.
      let accumulated = '';
      let reasoningAccum = '';
      const wrappedOnToken = (token: string) => {
        accumulated += token;
        onToken(token);
      };

      try {
        const result = await chat(
          messages,
          wrappedOnToken,
          abortController.signal,
          CONCIERGE_GENERATION_DEEP,
          (token) => {
            reasoningAccum += token;
          },
        );
        const rawText = result?.text ?? accumulated;
        const stripped = stripControlTokens(rawText);
        const answer = stripped.answer;
        const thinking =
          result?.reasoningContent ??
          (reasoningAccum || stripped.thinking) ??
          null;
        return { type: 'slm-success', payload: { answer, thinking } };
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          const stripped = stripControlTokens(accumulated);
          return {
            type: 'slm-success',
            payload: {
              answer: stripped.answer,
              thinking: reasoningAccum || stripped.thinking,
            },
          };
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
