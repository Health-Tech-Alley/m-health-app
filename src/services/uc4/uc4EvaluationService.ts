import { getOpenAlerts } from '../../data/repositories/alertRepository';
import {
  getPreviousUc4Priorities,
  saveUc4CaregiverResponse,
  saveUc4Run,
} from '../../data/repositories/uc4PriorityRepository';
import type { PatientRecordSnapshot } from '../../data/types';
import {
  runUC4StructuredMicroPriorities,
  UC4_ENGINE_VERSION,
  UC4_RULE_REGISTRY_VERSION,
  UC4_SCHEMA_VERSION,
  UC4_SCORING_VERSION,
  UC4_TEMPLATE_REGISTRY_VERSION,
  type UC4PriorityCard,
} from '../../ml-models/uc4-micro-priorities';
import { getEventBus } from '../../orchestration/event-bus';
import {
  adaptPatientRecordSnapshotToUC4Input,
  type UC4AdapterIssue,
} from './uc4PatientStateAdapter';

export type Uc4EvaluationSuccess = {
  status: 'success';
  runId: string;
  runStatus: 'completed' | 'paused' | 'no_cards';
  paused: boolean;
  pauseReason?: string | null;
  cards: UC4PriorityCard[];
  warnings: UC4AdapterIssue[];
};

export type Uc4EvaluationNotReady = {
  status: 'not_ready';
  errors: UC4AdapterIssue[];
  warnings: UC4AdapterIssue[];
};

export type Uc4EvaluationFailure = {
  status: 'adapter_error' | 'engine_error' | 'persistence_error';
  message: string;
  warnings: UC4AdapterIssue[];
};

export type Uc4EvaluationServiceResult =
  | Uc4EvaluationSuccess
  | Uc4EvaluationNotReady
  | Uc4EvaluationFailure;

export type Uc4EvaluationOptions = {
  nowIso?: string;
  runId?: string;
};

export type Uc4CardResponseAction =
  | 'acknowledged'
  | 'dismissed'
  | 'completed'
  | 'caregiver_response_submitted'
  | 'provider_review_requested';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runIdFor(patientId: string, nowIso: string): string {
  return `uc4:${patientId}:${nowIso}`;
}

function publishUc4Result(params: {
  patientId: string;
  runId: string;
  status: 'completed' | 'paused' | 'no_cards' | 'error';
  paused: boolean;
  pauseReason?: string | null;
  cardCount: number;
  at: string;
}): void {
  try {
    getEventBus().publish({
      type: 'uc4_priorities_evaluated',
      ...params,
    });
  } catch {
    /* event bus may not exist during isolated tests */
  }
}

export function evaluateAndPersistUc4Priorities(
  snapshot: PatientRecordSnapshot,
  options: Uc4EvaluationOptions = {},
): Uc4EvaluationServiceResult {
  const patientId = snapshot.patient?.patientId;
  if (!patientId) {
    return {
      status: 'not_ready',
      errors: [{ code: 'missing_patient_identity', message: 'Patient identity is required.' }],
      warnings: [],
    };
  }

  const nowIso = options.nowIso ?? new Date().toISOString();
  const runId = options.runId ?? runIdFor(patientId, nowIso);
  let adapterResult: ReturnType<typeof adaptPatientRecordSnapshotToUC4Input>;
  try {
    adapterResult = adaptPatientRecordSnapshotToUC4Input({
      snapshot,
      activeAlerts: getOpenAlerts(patientId),
      previousPriorities: getPreviousUc4Priorities(patientId),
      nowIso,
    });
  } catch (error) {
    return {
      status: 'adapter_error',
      message: message(error),
      warnings: [],
    };
  }

  if (adapterResult.status === 'not_ready') {
    return {
      status: 'not_ready',
      errors: adapterResult.errors,
      warnings: adapterResult.warnings,
    };
  }

  let output: ReturnType<typeof runUC4StructuredMicroPriorities>;
  try {
    output = runUC4StructuredMicroPriorities(adapterResult.input);
  } catch (error) {
    return {
      status: 'engine_error',
      message: message(error),
      warnings: adapterResult.warnings,
    };
  }

  const runStatus = output.paused
    ? 'paused'
    : output.selectedCards.length > 0
      ? 'completed'
      : 'no_cards';
  try {
    saveUc4Run({
      runId,
      patientId,
      status: runStatus,
      pauseReason: output.pauseReason ?? null,
      generatedAt: nowIso,
      engineVersion: UC4_ENGINE_VERSION,
      schemaVersion: UC4_SCHEMA_VERSION,
      templateRegistryVersion: UC4_TEMPLATE_REGISTRY_VERSION,
      ruleRegistryVersion: UC4_RULE_REGISTRY_VERSION,
      scoringVersion: UC4_SCORING_VERSION,
      candidates: output.candidates,
      auditRecords: output.auditRecords,
      cards: output.selectedCards,
    });
  } catch (error) {
    return {
      status: 'persistence_error',
      message: message(error),
      warnings: adapterResult.warnings,
    };
  }

  publishUc4Result({
    patientId,
    runId,
    status: runStatus,
    paused: output.paused,
    pauseReason: output.pauseReason ?? null,
    cardCount: output.selectedCards.length,
    at: nowIso,
  });

  try {
    const { drainPendingProposalsForPatient } = require('../carePlan/mlPlanProposalService') as typeof import('../carePlan/mlPlanProposalService');
    drainPendingProposalsForPatient(patientId, 'uc4');
  } catch (err) {
    console.warn('[UC4] ADCP proposal drain failed:', err instanceof Error ? err.message : err);
  }

  return {
    status: 'success',
    runId,
    runStatus,
    paused: output.paused,
    pauseReason: output.pauseReason ?? null,
    cards: output.selectedCards,
    warnings: adapterResult.warnings,
  };
}

export function submitUc4CaregiverResponse(params: {
  patientId: string;
  cardId: string;
  templateId: string;
  action: Uc4CardResponseAction;
  observationCodes?: string[];
  contextCodes?: string[];
  caregiverRequestedProviderReview?: boolean;
  shortText?: string;
}): string {
  const nowIso = new Date().toISOString();
  const responseId = `uc4-response:${params.patientId}:${params.cardId}:${nowIso}`;
  const observationCodes = new Set(params.observationCodes ?? []);
  if (
    params.action === 'provider_review_requested' ||
    params.caregiverRequestedProviderReview === true
  ) {
    observationCodes.add('CAREGIVER_WANTS_PROVIDER_REVIEW');
  }
  saveUc4CaregiverResponse({
    responseId,
    patientId: params.patientId,
    cardId: params.cardId,
    templateId: params.templateId,
    action: params.action,
    observationCodes: Array.from(observationCodes),
    contextCodes: params.contextCodes ?? [],
    caregiverRequestedProviderReview:
      params.caregiverRequestedProviderReview ?? params.action === 'provider_review_requested',
    shortText: params.shortText ?? null,
  });
  try {
    getEventBus().publish({
      type: 'uc4_caregiver_response',
      patientId: params.patientId,
      responseId,
      cardId: params.cardId,
      action: params.action,
      at: nowIso,
    });
  } catch {
    /* event bus may not exist during isolated tests */
  }
  return responseId;
}
