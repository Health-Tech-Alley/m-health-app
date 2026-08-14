/**
 * Orchestrator.
 *
 * The single chokepoint between the app's services and the AI layers (SLM,
 * RAG, Alert ML). It:
 *
 *   1. Receives events from the event bus.
 *   2. Runs the CEP engine.
 *   3. Fans out to L4 agents in parallel and enforces the safety-reviewer verdict.
 *   4. Decides when to invoke the SLM (only after caregiver ground truth, or
 *      on-demand for "Explain").
 *   5. Routes egress-bearing actions through the consent gate.
 *   6. Writes a tamper-evident audit entry for every clinically significant action.
 *   7. Surfaces a transparency trace and citations for every AI action.
 */

import {
  getAlertById,
  insertAlert,
  insertCaregiverAction,
  insertHealthSamplesBatched,
  insertSlmTurn,
  updateAlertMlFields,
  type Alert,
  type CaregiverAction,
  type HealthSample,
  type MlEvent,
  type SlmTurn
} from '@/data';
import {
  getAnomalyConfidenceRatio,
  getMlEventForAlert,
  insertMlEvent,
  parseCaregiverBlock,
  parseRawVitals,
  parseRuleEngine,
  parseTopFeatures,
  updateMlEventPostHitl,
} from '@/data/repositories/mlEventRepository';
import type { PatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';
import { getUc3TrajectoryResultById } from '@/data/repositories/uc3TrajectoryResultRepository';
import {
  getUc4PriorityCardSummariesForRun,
  getUc4PriorityCardSummaryById,
  getUc4RunSummaryById,
} from '@/data/repositories/uc4PriorityRepository';
import type { InferenceProvider, GenerateOptions } from '@/inference/inference-provider';
import type { FusedRetriever, RetrievedChunk } from '@/knowledge';
import type { AlertMlModel } from '@/ml-models/alert-autoencoder';
import type { AppleWatchVitalsInput, UC2DecisionResult } from '@/ml-models/uc2-decision-layer';
import { audit, auditAlertCreated, auditCaregiverAction, auditSampleRead, auditSlmTurn } from '@/services/audit/auditService';
import { checkEgressConsent } from '@/services/consent/consentGate';
import { AlertMlService } from '@/services/ml/alert-ml-service';
import { dispatchImmediate } from '@/services/notifications';
import type { SlmTaskQueue } from '@/services/slm/slm-task-queue';
import { store } from '@/store';

import { REASONING_FORMAT_EXPLAIN, getConciergeGeneration } from '@/constants/concierge';
import type {
  HealthSampleSource,
  MlRawVitalsPayload,
  NextStep,
  NextStepActionId,
  Threshold,
} from '@/data/types';
import {
  GraphProjector,
  buildContextSubgraph,
  writeActionEdges,
  writeAlertEdges,
  writeSampleEdges,
  writeSlmTurnEdges,
  writeTriggerEdges,
} from '@/knowledge/graph';
import {
  healthSampleToLiveVitalReading,
  isProductionWearableSource,
  isSimulatedHealthSampleSource,
  selectProductionWearableReadingsForPatient,
  selectSimulatedReadingsForPatient,
  type LiveVitalReading,
} from '@/store/reducers/vitalsSlice';
import {
  CaregiverAgent,
  CoordinatorAgent,
  PatientStateAgent,
  SafetyReviewerAgent,
  createAllAgents,
  type Agent,
  type AgentContext,
  type AgentProposalInternal,
  type ProposedAction,
} from './agents';
import { createDefaultCepEngine, type CepEngine } from './cep';
import { buildAggregatedContext, type AggregatedContext } from './context-aggregator';
import { getEventBus, type EventBus } from './event-bus';
import type { OrchestrationEvent } from './events';
import {
  createInProcessMcp,
  type InProcessMcpClient,
} from './mcp/mcp-in-process';
import { TOOL_SCHEMAS } from './mcp/tool-registry';
import {
  NEXT_STEP_TAXONOMY,
  isValidActionId,
} from './next-steps';
import { normalizeVitalForThreshold } from '@/utils/spo2';
import { dispatchInChunks, runInBackground } from '@/utils/commonFunctions';
import {
  budgetAwareCitationsBlock,
  carePlanGoalsBlock,
  patientBlock,
  personaPreamble,
  priorDecisionsBlock,
  progressMeasuresBlock,
  recentVitalsBlock,
  rehabTrajectoryBlock,
  sensitiveTopicsInstruction,
  thresholdsBlock,
  toolsBlock,
  uc4PrioritiesBlock,
  type PriorDecisionEntry,
} from './prompt-fragments';
import {
  PreSlmNlu,
  buildPatientNluContext,
  formatEntityHint,
  DEFAULT_NLU_STAGE_TIMEOUT_MS,
} from '@/nlu';
import { filterToolsForSkill, getSkillPromptFragment, type SkillId } from './skills';

export type OrchestratorConfig = {
  slm: InferenceProvider;
  /** The task queue that owns the SLM load/unload lifecycle. */
  slmTasks: SlmTaskQueue;
  retriever: FusedRetriever;
  alertMl?: AlertMlModel;
  bus?: EventBus;
  /**
   * Returns the current patient record snapshot. Called on-demand (during
   * explainAlert / fanOutAndExecute) so the orchestrator always sees the
   * latest structured conditions, comorbidities, symptoms, and thresholds
   * without being recreated on every store update.
   */
  snapshotProvider: () => PatientRecordSnapshot | null;
  /**
   * Optional — supplies a compact 3–5 line summary of the patient's recent
   * caregiver actions + the currently-open non-emergency decision (if any)
   * for prompt injection. Without this, the SLM has no memory of "last time
   * you flagged this, you overrode it." See planning/32 §9 (D8).
   */
  priorDecisionsProvider?: (args: { patientId: string; alertId?: string }) => PriorDecisionEntry[];
};

export type ClarifyingQuestion = {
  questionId: string;
  question: string;
  options: string[];
};

export type AgentProposal = {
  message: string;
  citations: string[];
  proposedActions: { tool: string; args: Record<string, unknown>; rationale: string }[];
  clarifyingQuestion?: ClarifyingQuestion;
  nextSteps?: NextStep[];
  safety: { ok: boolean; notes: string[] };
  trace: TraceStep[];
};

export type TraceStep = {
  agent: string;
  thought: string;
  tool?: string;
  toolArgs?: Record<string, unknown>;
  result?: unknown;
};

function formatScore(score: unknown): string {
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(3) : 'n/a';
}

function shortPatientId(patientId: string): string {
  return patientId.length > 6 ? `...${patientId.slice(-6)}` : patientId;
}

type ThresholdViolation = Pick<Threshold, 'thresholdId' | 'severity'>;

export class Orchestrator {
  private slm: InferenceProvider;
  private slmTasks: SlmTaskQueue;
  private retriever: FusedRetriever;
  private client: InProcessMcpClient;
  private cep: CepEngine;
  private alertMlService?: AlertMlService;
  private graphProjector = new GraphProjector();
  private unsubscribe?: () => void;
  private trace: TraceStep[] = [];
  private agents: Agent[];
  private safetyReviewer = new SafetyReviewerAgent();
  private vitalsDebounce: Map<string, { timer: ReturnType<typeof setTimeout>; events: OrchestrationEvent[] }> = new Map();
  private vitalsStateBuffer: Map<string, LiveVitalReading[]> = new Map();
  private vitalsStateFlushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private static readonly DEBOUNCE_MS = 3000;
  private static readonly VITALS_STATE_FLUSH_MS = 500;
  private snapshotProvider: () => PatientRecordSnapshot | null;
  private priorDecisionsProvider?: (args: { patientId: string; alertId?: string }) => PriorDecisionEntry[];

  constructor(config: OrchestratorConfig) {
    this.slm = config.slm;
    this.slmTasks = config.slmTasks;
    this.retriever = config.retriever;
    this.snapshotProvider = config.snapshotProvider;
    this.priorDecisionsProvider = config.priorDecisionsProvider;
    const { client } = createInProcessMcp({ tools: createAllAgents() });
    this.client = client;
    this.cep = createDefaultCepEngine();
    if (config.alertMl) {
      this.alertMlService = new AlertMlService(config.alertMl);
    }

    this.agents = [
      new PatientStateAgent(),
      new CaregiverAgent(),
      new CoordinatorAgent(),
    ];

    const bus = config.bus ?? getEventBus();
    // console.log('[Orchestrator] Constructing, subscribing to vitals_sample. Bus instance:', bus);
    const unsubVitals = bus.subscribe('vitals_sample', (event) => {
      // console.log('[Orchestrator] bus fired vitals_sample:', event.type === 'vitals_sample' ? event.sampleType : 'n/a');
      if (event.type === 'vitals_sample') {
        void this.handleVitalsSample(event);
      }
    });
    const unsubMl = bus.subscribe('ml_alert_created', (event) => {
      if (event.type === 'ml_alert_created') {
        void this.handleMlAlert(event);
      }
    });
    const unsubOverride = bus.subscribe('caregiver_override', (event) => {
      if (event.type === 'caregiver_override') {
        void this.handleCaregiverOverride(event);
      }
    });
    const unsubUc3 = bus.subscribe('uc3_trajectory_evaluated', (event) => {
      if (event.type === 'uc3_trajectory_evaluated') {
        void this.handleUc3TrajectoryEvaluated(event);
      }
    });
    const unsubUc4 = bus.subscribe('uc4_priorities_evaluated', (event) => {
      if (event.type === 'uc4_priorities_evaluated') {
        void this.handleUc4PrioritiesEvaluated(event);
      }
    });
    const unsubUc4Resp = bus.subscribe('uc4_caregiver_response', (event) => {
      if (event.type === 'uc4_caregiver_response') {
        void this.handleUc4CaregiverResponse(event);
      }
    });

    this.unsubscribe = () => {
      unsubVitals();
      unsubMl();
      unsubOverride();
      unsubUc3();
      unsubUc4();
      unsubUc4Resp();
    };
  }

  dispose(): void {
    this.unsubscribe?.();
    void this.alertMlService?.release();
    for (const [, entry] of this.vitalsDebounce) {
      clearTimeout(entry.timer);
    }
    this.vitalsDebounce.clear();
    for (const [, timer] of this.vitalsStateFlushTimers) {
      clearTimeout(timer);
    }
    this.vitalsStateFlushTimers.clear();
    this.vitalsStateBuffer.clear();
  }

  private addTrace(step: TraceStep): void {
    this.trace.push(step);
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.client.callTool(name, args);
    this.addTrace({ agent: 'mcp', thought: `Call ${name}`, tool: name, toolArgs: args, result });
    return result;
  }

  private async handleVitalsSample(event: Extract<OrchestrationEvent, { type: 'vitals_sample' }>): Promise<void> {
    const source = event.source ?? 'simulated';
    if (__DEV__) {
      console.log('[Orchestrator] Received vitals sample', {
        patient: shortPatientId(event.patientId),
        type: event.sampleType,
        value: event.value,
        unit: event.unit,
        source,
        timestamp: event.recordedAt,
      });
    }

    // Persist the sample so later SLM explain paths can read it.
    const sample: HealthSample = {
      sampleId: event.sampleId,
      patientId: event.patientId,
      source,
      type: event.sampleType as HealthSample['type'],
      value: event.value,
      unit: event.unit,
      recordedAt: event.recordedAt,
      receivedAt: event.receivedAt ?? new Date().toISOString(),
    };
    const reading = healthSampleToLiveVitalReading(sample);

    if (source !== 'apple-health' && source !== 'mock') {
      insertHealthSamplesBatched([sample]);
    }
    this.queueVitalsStateFlush(event.patientId, reading);

    writeSampleEdges(event.patientId, event.sampleId, event.sampleType as HealthSample['type']);
    auditSampleRead(event.patientId, event.sampleId, 'system');

    // Severity-3 events bypass the debounce — they must be handled immediately.
    const existing = this.vitalsDebounce.get(event.patientId);
    if (existing) {
      existing.events.push(event);
    } else {
      const entry = { timer: setTimeout(() => {}, 0), events: [event] };
      this.vitalsDebounce.set(event.patientId, entry);
    }

    const cepAction = this.cep.ingest(event);
    if (cepAction?.type === 'drop') {
      audit({ actor: 'orchestrator', action: 'cep_drop', resourceType: 'sample', resourceId: event.sampleId, patientId: event.patientId, payload: { reason: cepAction.reason } });
      return;
    }

    // CEP promote_spo2_drop: force an immediate ML eval (still after thresholds).
    const forceImmediateMl = cepAction?.type === 'promote_to_alert_ml';
    if (forceImmediateMl) {
      audit({
        actor: 'orchestrator',
        action: 'cep_promote_to_alert_ml',
        resourceType: 'sample',
        resourceId: event.sampleId,
        patientId: event.patientId,
        payload: { reason: cepAction.reason },
      });
    }

    // Always check snapshot thresholds; severity-3 violations short-circuit to the fast path.
    const check = this.checkThresholdViolationFromSnapshot(reading);
    const maxSeverity = check?.maxSeverity ?? 0;
    const violations = check?.violations ?? [];

    if (maxSeverity === 3) {
      await this.emergencyFastPath(reading, violations);
      return;
    }

    if (maxSeverity === 2 || maxSeverity === 1) {
      await this.createAlert(reading, maxSeverity as 1 | 2, violations);
    }

    // Run the Alert ML model asynchronously after threshold handling.
    // Debounce by default; CEP promote_spo2_drop flushes ML immediately.
    if (this.alertMlService) {
      if (forceImmediateMl) {
        await this.flushAlertMlForPatient(event.patientId);
      } else {
        this.scheduleAlertMlDebounce(event.patientId);
      }
    } else {
      console.warn('[Orchestrator] Alert ML service not configured; skipping ML evaluation.');
    }
  }

  private checkThresholdViolationFromSnapshot(
    reading: LiveVitalReading,
  ): { maxSeverity: number; violations: ThresholdViolation[]; normalizedValue: number } | null {
    const snapshot = this.snapshotProvider?.() ?? null;
    const snapshotPatientId = snapshot?.patient?.patientId;
    if (!snapshotPatientId) {
      if (__DEV__) {
        console.log('[Orchestrator] Skipped threshold evaluation: patient snapshot unavailable', {
          patient: shortPatientId(reading.patientId),
          type: reading.type,
        });
      }
      return null;
    }

    if (snapshotPatientId !== reading.patientId) {
      if (__DEV__) {
        console.log('[Orchestrator] Skipped threshold evaluation: mismatched snapshot', {
          patient: shortPatientId(reading.patientId),
          snapshotPatient: shortPatientId(snapshotPatientId),
          type: reading.type,
        });
      }
      return null;
    }

    if (!Array.isArray(snapshot.thresholds)) {
      if (__DEV__) {
        console.log('[Orchestrator] Skipped threshold evaluation: thresholds not hydrated', {
          patient: shortPatientId(reading.patientId),
          type: reading.type,
        });
      }
      return null;
    }

    const value = normalizeVitalForThreshold(reading.type, reading.value);
    const violations = snapshot.thresholds
      .filter((threshold) => threshold.vitalType === reading.type)
      .filter((threshold) => {
        if (threshold.direction === 'below') return value < threshold.value;
        if (threshold.direction === 'above') return value > threshold.value;
        return Math.abs(value - threshold.value) < 0.001;
      })
      .map((threshold) => ({
        thresholdId: threshold.thresholdId,
        severity: threshold.severity,
      }));
    const maxSeverity = violations.length
      ? (Math.max(...violations.map((violation) => violation.severity)) as 1 | 2 | 3)
      : 0;
    return { maxSeverity, violations, normalizedValue: value };
  }

  private selectAlertMlReadingsForSource(
    patientId: string,
    source: HealthSampleSource,
  ): LiveVitalReading[] {
    const state = store.getState();
    if (isSimulatedHealthSampleSource(source)) {
      return selectSimulatedReadingsForPatient(state, patientId);
    }
    if (isProductionWearableSource(source)) {
      return selectProductionWearableReadingsForPatient(state, patientId);
    }
    if (__DEV__) {
      console.log('[Orchestrator] Skipped Alert ML evaluation for unsupported vital source', {
        patient: shortPatientId(patientId),
        source,
      });
    }
    return [];
  }

  private queueVitalsStateFlush(patientId: string, reading: LiveVitalReading): void {
    const buffer = this.vitalsStateBuffer.get(patientId) ?? [];
    buffer.push(reading);
    this.vitalsStateBuffer.set(patientId, buffer);

    if (this.vitalsStateFlushTimers.has(patientId)) return;

    const timer = setTimeout(() => {
      runInBackground(() => this.flushVitalsStateBufferForPatient(patientId));
    }, Orchestrator.VITALS_STATE_FLUSH_MS);
    this.vitalsStateFlushTimers.set(patientId, timer);
  }

  private async flushVitalsStateBufferForPatient(patientId: string): Promise<void> {
    const timer = this.vitalsStateFlushTimers.get(patientId);
    if (timer) {
      clearTimeout(timer);
      this.vitalsStateFlushTimers.delete(patientId);
    }

    const readings = this.vitalsStateBuffer.get(patientId) ?? [];
    this.vitalsStateBuffer.delete(patientId);
    if (readings.length === 0) return;

    const activePatientId = store.getState().vitals.activePatientId;
    if (activePatientId && activePatientId !== patientId) {
      if (__DEV__) {
        console.log('[Orchestrator] Skipped vitals batch for inactive patient', {
          patient: shortPatientId(patientId),
          activePatient: shortPatientId(activePatientId),
          count: readings.length,
        });
      }
      return;
    }

    if (__DEV__) {
      console.log('[Orchestrator] Flushing vitals batch', {
        patient: shortPatientId(patientId),
        count: readings.length,
      });
    }
    await dispatchInChunks(readings);
  }

  /** Debounced Alert ML eval (one run per patient per DEBOUNCE_MS window). */
  private scheduleAlertMlDebounce(patientId: string): void {
    const debounceEntry = this.vitalsDebounce.get(patientId);
    if (!debounceEntry || !this.alertMlService) return;
    clearTimeout(debounceEntry.timer);
    debounceEntry.timer = setTimeout(() => {
      void this.flushAlertMlForPatient(patientId);
    }, Orchestrator.DEBOUNCE_MS);
  }

  /**
   * Run Alert ML for the latest debounced vitals batch (or the most recent
   * sample if the batch was already cleared). Used by the normal debounce
   * timer and by CEP `promote_to_alert_ml`.
   */
  private async flushAlertMlForPatient(patientId: string): Promise<void> {
    if (!this.alertMlService) return;
    const debounceEntry = this.vitalsDebounce.get(patientId);
    let latest: Extract<OrchestrationEvent, { type: 'vitals_sample' }> | null = null;
    if (debounceEntry) {
      clearTimeout(debounceEntry.timer);
      const batch = debounceEntry.events;
      this.vitalsDebounce.delete(patientId);
      const last = batch[batch.length - 1];
      if (last?.type === 'vitals_sample') {
        latest = last;
      }
    }
    if (!latest) return;
    try {
      await this.flushVitalsStateBufferForPatient(patientId);
      const snapshot = this.snapshotProvider?.() ?? null;
      const snapshotPatientId = snapshot?.patient?.patientId;
      if (snapshotPatientId && snapshotPatientId !== patientId) {
        if (__DEV__) {
          console.log('[Orchestrator] Skipped Alert ML evaluation for mismatched snapshot', {
            patient: shortPatientId(patientId),
            snapshotPatient: shortPatientId(snapshotPatientId),
          });
        }
        return;
      }
      const source = latest.source ?? 'simulated';
      const readings = this.selectAlertMlReadingsForSource(patientId, source);
      if (readings.length === 0) {
        if (__DEV__) {
          console.log('[Orchestrator] Skipped Alert ML evaluation: no state readings for source cohort', {
            patient: shortPatientId(patientId),
            source,
          });
        }
        return;
      }
      await this.alertMlService.evaluate(patientId, latest, snapshot, readings);
    } catch (err) {
      console.error('[Orchestrator] Alert ML evaluation failed:', err);
    }
  }

  private async handleMlAlert(event: Extract<OrchestrationEvent, { type: 'ml_alert_created' }>): Promise<void> {
    const notifTitle =
      event.notificationTitle ??
      (event.severity === 3
        ? `Urgent: ML anomaly detected (score ${formatScore(event.score)})`
        : `Check on patient: unusual vitals pattern`);
    const notifBody =
      event.notificationBody ??
      (event.initialAnomalyType
        ? `Pattern: ${event.initialAnomalyType.replace(/_/g, ' ').toLowerCase()}. Open to review.`
        : 'Alert ML flagged an anomaly based on recent vitals.');

    const alert: Alert = {
      alertId: event.alertId,
      patientId: event.patientId,
      severity: event.severity,
      status: 'open',
      title: notifTitle,
      body: notifBody,
      mlScore: event.score,
      mlFeaturesJson: JSON.stringify(event.features),
      createdAt: event.at,
      pipelinePath: event.pipelinePath,
      initialAnomalyType: event.initialAnomalyType,
      postHitlAnomalyType: event.postHitlAnomalyType,
      featureQualityJson: event.featureQuality ? JSON.stringify(event.featureQuality) : undefined,
      scoreRatio: event.scoreRatio,
      aeScore: event.score,
    };
    insertAlert(alert);

    // Persist the full structured ML payload to ml_events for the SLM bridge.
    const mlEvent: MlEvent = {
      eventId: `mlevent-${event.alertId}`,
      patientId: event.patientId,
      deviceId: event.deviceId,
      alertId: event.alertId,
      queueType: event.queueType,
      eventType: event.eventType,
      timestamp: event.at,
      modelVersion: event.modelVersion,
      threshold: event.threshold,
      personalizedThreshold: event.personalizedThreshold,
      reconstructionError: event.reconstructionError,
      anomalyDetected: true,
      inputHash: event.inputHash,
      topFeaturesJson: event.topFeatures ? JSON.stringify(event.topFeatures) : undefined,
      ruleEngineJson: event.ruleEngine ? JSON.stringify(event.ruleEngine) : undefined,
      caregiverJson: event.caregiverBlock ? JSON.stringify(event.caregiverBlock) : undefined,
      rawVitalsJson: event.rawVitals ? JSON.stringify(event.rawVitals) : undefined,
      trainingLabelProxyJson: event.trainingLabelProxy ? JSON.stringify(event.trainingLabelProxy) : undefined,
      createdAt: new Date().toISOString(),
      featureQualityJson: event.featureQuality ? JSON.stringify(event.featureQuality) : undefined,
      initialAnomalyType: event.initialAnomalyType,
      postHitlAnomalyType: event.postHitlAnomalyType,
      scoreRatio: event.scoreRatio,
    };
    insertMlEvent(mlEvent);

    auditAlertCreated(event.patientId, alert.alertId, {
      mlScore: event.score,
      severity: event.severity,
      features: event.features,
      queueType: event.queueType,
      reconstructionError: event.reconstructionError,
      initialAnomalyType: event.initialAnomalyType,
      scoreRatio: event.scoreRatio,
    });

    // Dispatch an OS / in-app notification for severity >= 2 ML anomalies.
    // Severity-3 bypasses DND; severity-2 is a normal-priority check-in.
    if (event.severity >= 2) {
      try {
        const consent = checkEgressConsent(event.patientId, 'dispatch_alert_notification');
        if (consent.allowed) {
          await this.client.callTool('dispatch_alert_notification', {
            alertId: alert.alertId,
            bypassDnd: event.severity === 3,
          });
        }
      } catch (err) {
        console.warn('[Orchestrator] ML alert notification dispatch failed:', err);
      }
    }

    // Run multi-agent fan-out so the coordinator can propose immediate actions.
    await this.fanOutAndExecute({
      patientId: event.patientId,
      intent: `ML alert ${alert.alertId}`,
      alertId: alert.alertId,
    });
  }

  private async handleCaregiverOverride(event: Extract<OrchestrationEvent, { type: 'caregiver_override' }>): Promise<void> {
    audit({
      actor: 'caregiver',
      action: event.action,
      resourceType: 'alert',
      resourceId: event.alertId,
      patientId: event.patientId,
      payload: { note: event.note },
    });
  }

  private async handleUc3TrajectoryEvaluated(
    event: Extract<OrchestrationEvent, { type: 'uc3_trajectory_evaluated' }>,
  ): Promise<void> {
    const result = getUc3TrajectoryResultById(event.resultId);
    if (!result || result.patientId !== event.patientId || result.carePlanId !== event.carePlanId) {
      audit({
        actor: 'system',
        action: 'uc3_trajectory_event_mismatch',
        resourceType: 'uc3_trajectory_result',
        resourceId: event.resultId,
        patientId: event.patientId,
        payload: { carePlanId: event.carePlanId, found: Boolean(result) },
      });
      return;
    }

    audit({
      actor: 'system',
      action: 'uc3_trajectory_evaluated',
      resourceType: 'uc3_trajectory_result',
      resourceId: result.resultId,
      patientId: result.patientId,
      payload: {
        carePlanId: result.carePlanId,
        eventType: result.eventType,
        severity: result.severity,
        requiresHumanReview: result.requiresHumanReview,
        emergencyThresholdBreach: result.emergencyThresholdBreach,
      },
    });

    if (event.inserted === false) return;
    if (!result.requiresHumanReview && !result.emergencyThresholdBreach) return;

    const urgent = result.emergencyThresholdBreach || result.severity === 'urgent';
    try {
      const consent = checkEgressConsent(result.patientId, 'dispatch_alert_notification');
      if (consent.allowed) {
        await dispatchImmediate({
          patientId: result.patientId,
          scope: 'care_task',
          triggerRef: result.resultId,
          title: urgent ? 'Urgent rehab safety concern' : 'Rehab progress review recommended',
          body: result.explanations[0] ?? result.eventType,
          severity: urgent ? 3 : 2,
          bypassDnd: urgent,
        });
      }
    } catch (err) {
      console.warn('[Orchestrator] UC3 notification dispatch failed:', err);
    }
  }

  private async handleUc4PrioritiesEvaluated(
    event: Extract<OrchestrationEvent, { type: 'uc4_priorities_evaluated' }>,
  ): Promise<void> {
    const run = getUc4RunSummaryById(event.runId);
    if (!run || run.patientId !== event.patientId) {
      audit({
        actor: 'system',
        action: 'uc4_priorities_event_mismatch',
        resourceType: 'uc4_priority_run',
        resourceId: event.runId,
        patientId: event.patientId,
        payload: { found: Boolean(run) },
      });
      return;
    }

    audit({
      actor: 'system',
      action: 'uc4_priorities_evaluated',
      resourceType: 'uc4_priority_run',
      resourceId: run.runId,
      patientId: run.patientId,
      payload: {
        status: run.status,
        paused: run.paused,
        pauseReason: run.pauseReason,
        cardCount: run.cardCount,
      },
    });

    if (run.status !== 'completed' || run.cardCount === 0) return;

    const cards = getUc4PriorityCardSummariesForRun(run.patientId, run.runId, 1);
    const topCard = cards[0];
    if (!topCard) return;

    try {
      const consent = checkEgressConsent(run.patientId, 'dispatch_alert_notification');
      if (consent.allowed) {
        await dispatchImmediate({
          patientId: run.patientId,
          scope: 'care_task',
          triggerRef: run.runId,
          title: 'New care focus checklist available',
          body: topCard.title,
          severity: 1,
          bypassDnd: false,
        });
      }
    } catch (err) {
      console.warn('[Orchestrator] UC4 notification dispatch failed:', err);
    }
  }

  private async handleUc4CaregiverResponse(
    event: Extract<OrchestrationEvent, { type: 'uc4_caregiver_response' }>,
  ): Promise<void> {
    const card = event.cardId ? getUc4PriorityCardSummaryById(event.cardId) : null;
    audit({
      actor: 'caregiver',
      action: event.action,
      resourceType: 'uc4_priority_card',
      resourceId: event.cardId ?? event.responseId,
      patientId: event.patientId,
      payload: {
        responseId: event.responseId,
        cardFound: Boolean(card),
        cardPatientMatches: card ? card.patientId === event.patientId : null,
      },
    });
  }

  private async emergencyFastPath(
    reading: LiveVitalReading,
    violations: ThresholdViolation[],
  ): Promise<void> {
    // Display SpO2 as percent even if a legacy fraction sample arrived.
    const displayValue = normalizeVitalForThreshold(reading.type, reading.value);
    const displayUnit =
      reading.type === 'spo2' || reading.unit === 'fraction' ? '%' : reading.unit;
    const alert: Alert = {
      alertId: `alert-${Date.now()}`,
      patientId: reading.patientId,
      severity: 3,
      status: 'open',
      title: `Emergency: ${reading.type} ${displayValue}${displayUnit}`,
      body: `Severe threshold violation detected. Immediate attention required.`,
      createdAt: new Date().toISOString(),
    };
    insertAlert(alert);
    writeAlertEdges(reading.patientId, alert.alertId);
    for (const v of violations) {
      writeTriggerEdges(reading.sampleId, v.thresholdId, alert.alertId);
    }
    auditAlertCreated(reading.patientId, alert.alertId, { source: 'threshold', violations });

    // Egress-bearing notification still goes through consent gate for audit; in
    // the severity-3 fast path the caregiver must still direct the action.
    const consent = checkEgressConsent(reading.patientId, 'dispatch_alert_notification');
    if (consent.allowed) {
      await this.client.callTool('dispatch_alert_notification', {
        alertId: alert.alertId,
        bypassDnd: true,
      });
    }

    console.log('[Orchestrator] Emergency fast path triggered for', alert.alertId);
  }

  private async createAlert(
    reading: LiveVitalReading,
    severity: 1 | 2,
    violations: ThresholdViolation[],
  ): Promise<void> {
    const alert: Alert = {
      alertId: `alert-${Date.now()}`,
      patientId: reading.patientId,
      severity,
      status: 'open',
      title: `${reading.type} ${reading.value}${reading.unit}`,
      body: `Threshold violation: ${violations.map((v) => v.thresholdId).join(', ')}`,
      createdAt: new Date().toISOString(),
    };
    insertAlert(alert);
    writeAlertEdges(reading.patientId, alert.alertId);
    for (const v of violations) {
      writeTriggerEdges(reading.sampleId, v.thresholdId, alert.alertId);
    }
    auditAlertCreated(reading.patientId, alert.alertId, { source: 'threshold', violations });

    // Dispatch an OS / in-app banner notification for non-critical threshold
    // alerts (severity 1-2) so the caregiver is proactively notified —
    // severity-3 is handled by the emergency fast path. Consent-gated; on
    // Track A (no expo-notifications) this surfaces as the in-app banner so
    // the demo shows how notifications react to dynamic data.
    try {
      const consent = checkEgressConsent(reading.patientId, 'dispatch_alert_notification');
      if (consent.allowed) {
        await this.client.callTool('dispatch_alert_notification', {
          alertId: alert.alertId,
          bypassDnd: false,
        });
      }
    } catch (err) {
      console.warn('[Orchestrator] non-critical alert notification dispatch failed:', err);
    }
  }

  /**
   * Multi-agent fan-out.
   *
   * Runs patient-state, caregiver, and coordinator agents in parallel,
   * collects proposals, enforces the safety-reviewer verdict, applies the
   * consent gate to egress-bearing actions, and executes allowed actions.
   */
  private async fanOutAndExecute(ctx: Omit<AgentContext, 'aggregatedContext'>): Promise<AgentProposalInternal[]> {
    const snapshot = this.snapshotProvider();
    if (!snapshot) {
      throw new Error('PatientRecordStore snapshot not available');
    }
    const aggregatedContext = await buildAggregatedContext(ctx.patientId, ctx.intent, this.retriever, snapshot);
    const fullContext: AgentContext = { ...ctx, aggregatedContext };

    const proposals = await Promise.all(
      this.agents.map((agent) => agent.propose(fullContext).catch((err) => {
        console.error(`[Orchestrator] Agent ${agent.name} failed:`, err);
        return {
          agent: agent.name,
          message: '',
          proposedActions: [],
          citations: [],
          safetyNotes: [`Agent ${agent.name} failed: ${err instanceof Error ? err.message : String(err)}`],
        };
      })),
    );

    const verdict = this.safetyReviewer.review(proposals, fullContext);
    if (verdict.status === 'block') {
      audit({
        actor: 'orchestrator',
        action: 'block',
        resourceType: 'agent_proposals',
        resourceId: ctx.alertId,
        patientId: ctx.patientId,
        payload: { reason: verdict.reason },
      });
      return proposals;
    }

    const allActions = proposals.flatMap((p) => p.proposedActions);
    for (const action of allActions) {
      await this.executeProposedAction(action, ctx.patientId, ctx.alertId);
    }

    return proposals;
  }

  private async executeProposedAction(action: ProposedAction, patientId: string, alertId?: string): Promise<void> {
    const consent = checkEgressConsent(patientId, action.tool);
    if (!consent.allowed) {
      audit({
        actor: 'orchestrator',
        action: 'consent_denied',
        resourceType: 'tool',
        resourceId: action.tool,
        patientId,
        payload: { reason: consent.reason, alertId },
      });
      return;
    }

    await this.callTool(action.tool, {
      ...action.args,
      alertId: alertId ?? action.args.alertId,
      patientId,
    });
  }

  /**
   * Called by the UI when the caregiver taps "Explain" on an alert.
   * This is the only path that invokes the SLM for anomaly analysis.
   */
  async explainAlert(
    alertId: string,
    caregiverId: string,
  ): Promise<AgentProposal> {
    this.trace = [];
    const alert = getAlertById(alertId);
    if (!alert) throw new Error(`Alert not found: ${alertId}`);

    const patientId = alert.patientId;
    const intent = `Explain alert ${alertId}: ${alert.title}`;

    // Load the structured ML event (if this alert originated from the ML model)
    // so the explain prompt can include top_features, caregiver observations,
    // rule-engine findings, and the reconstruction-error ratio.
    const mlEvent = getMlEventForAlert(alertId);
    const mlTopFeatures = mlEvent ? parseTopFeatures(mlEvent) : [];
    const mlRuleEngine = mlEvent ? parseRuleEngine(mlEvent) : null;
    const mlCaregiverBlock = mlEvent ? parseCaregiverBlock(mlEvent) : null;
    const mlRawVitals = mlEvent ? parseRawVitals(mlEvent) : null;
    const mlConfidenceRatio = mlEvent ? getAnomalyConfidenceRatio(mlEvent) : null;

    // Confidence router (upgraded): short-circuits SLM invocation when the
    // anomaly confidence is very high. Two paths:
    //   1. Severity-3 alerts → always return preliminary guidance (no SLM).
    //   2. High-confidence sub-severity-3 alerts (ratio > 3) with
    //      caregiver-confirmed observations → return heuristic next-steps
    //      without loading the SLM. The caregiver can still tap "Ask assistant".
    if (alert.severity === 3) {
      const preliminary = this.buildPreliminaryGuidance(alert);
      if (preliminary) {
        this.addTrace({ agent: 'orchestrator', thought: 'Confidence router: returning preliminary guidance for severity-3 alert without SLM.' });
        return preliminary;
      }
    }

    if (
      alert.severity < 3 &&
      mlConfidenceRatio !== null &&
      mlConfidenceRatio > 3 &&
      mlCaregiverBlock?.confirmed === true
    ) {
      this.addTrace({
        agent: 'orchestrator',
        thought: `Confidence router: high-confidence anomaly (ratio=${mlConfidenceRatio.toFixed(2)}) with caregiver confirmation — returning heuristic guidance without SLM.`,
      });
      return this.buildHighConfidenceGuidance(alert, mlTopFeatures, mlCaregiverBlock);
    }

    // Fan out agents first to collect proposed actions and safety notes.
    const agentProposals = await this.fanOutAndExecute({
      patientId,
      intent,
      alertId,
      caregiverId,
    });

    this.addTrace({ agent: 'orchestrator', thought: 'Building aggregated context for SLM explain.' });
    const snapshot = this.snapshotProvider();
    if (!snapshot) {
      throw new Error('PatientRecordStore snapshot not available');
    }
    const context = await buildAggregatedContext(patientId, intent, this.retriever, snapshot);
    if (this.priorDecisionsProvider) {
      // D8: feed prior decisions into the prompt so the SLM can reference
      // "last time you flagged this, you overrode it."
      context.priorDecisions = this.priorDecisionsProvider({ patientId, alertId });
    }

    // D3 / T3: explain path always runs deep — fetch long-doc chunks too.
    try {
      const {
        createReadyEmbedder,
        DEFAULT_TFLITE_EMBEDDER_LOAD_MS,
      } = await import('@/knowledge/embedder');
      const patientCtx = buildPatientNluContext(snapshot);
      const nlu = new PreSlmNlu({
        embedder: await createReadyEmbedder(DEFAULT_TFLITE_EMBEDDER_LOAD_MS, {
          allowDevelopmentFallback: false,
        }),
        retriever: this.retriever,
        toolSchemas: TOOL_SCHEMAS as unknown as import('@/knowledge/types').McpToolSummary[],
        allowDevelopmentFallback: false,
        filterToolsForSkill: (id, tools) =>
          filterToolsForSkill(
            id,
            tools as import('./mcp/tool-registry').ToolSchema[],
          ) as import('@/knowledge/types').McpToolSummary[],
      });

      const nluPacket = await Promise.race([
        nlu.run(`Explain alert ${alertId}: ${alert.title}`, patientCtx, {
          skillHint: 'explain-anomaly',
          intentOverride: 'explain_anomaly',
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`NLU explain timeout after ${DEFAULT_NLU_STAGE_TIMEOUT_MS}ms`)),
            DEFAULT_NLU_STAGE_TIMEOUT_MS,
          ),
        ),
      ]);

      if (nluPacket.chunks.length > 0) {
        context.retrieval.chunks = nluPacket.chunks;
        context.retrieval.citations = nluPacket.chunks.map((c) => c.docId);
      }

      if (nluPacket.entities.length > 0) {
        const hint = formatEntityHint(nluPacket.entities);
        this.addTrace({
          agent: 'orchestrator',
          thought: `NLU entities: ${hint}`,
        });
      }

      this.addTrace({
        agent: 'orchestrator',
        thought:
          `NLU explain: intent=${nluPacket.intent.primary} conf=${nluPacket.intent.confidence.toFixed(2)} ` +
          `entities=${nluPacket.entities.length} tools=${nluPacket.tools.length} ` +
          `chunks=${nluPacket.chunks.length} total=${context.retrieval.chunks.length} ` +
          `backend=${nluPacket.trace.backend}`,
      });
    } catch (nluErr) {
      console.warn('[Orchestrator] NLU explain unavailable or timed out; using standard retrieval:', nluErr);
    }

    if ('retrieveDeep' in this.retriever && typeof (this.retriever as { retrieveDeep?: unknown }).retrieveDeep === 'function') {
      try {
        const primaryOnly = (context.patient.conditions ?? []).slice(0, 1);
        const deepResult = await (this.retriever as { retrieveDeep: (q: { intent: string; conditions: string[]; activeMeds: string[]; kTools: number; kChunks: number }) => Promise<{ chunks: RetrievedChunk[] }> }).retrieveDeep({
          intent,
          conditions: primaryOnly,
          activeMeds: [],
          kTools: 3,
          kChunks: 12,
        });
        // Merge: dedup by docId, prefer the deeper (longer) version.
        const seen = new Set(context.retrieval.chunks.map((c) => c.docId));
        for (const c of deepResult.chunks) {
          if (!seen.has(c.docId)) {
            context.retrieval.chunks.push(c);
            seen.add(c.docId);
          }
        }
        this.addTrace({
          agent: 'orchestrator',
          thought: `Deep mode added ${deepResult.chunks.length} chunks; total ${context.retrieval.chunks.length}.`,
        });
      } catch (err) {
        console.warn('[Orchestrator] deep retrieval failed:', err);
      }
    }

    this.addTrace({ agent: 'orchestrator', thought: 'Building knowledge-graph context subgraph.' });
    const graph = this.graphProjector.build(patientId);
    const subgraph = buildContextSubgraph(graph, patientId, alertId);

    const activeSkill = 'explain-anomaly' as SkillId;
    const systemPrompt = this.buildSystemPrompt(context, activeSkill);
    let userPrompt = this.buildExplainPrompt(context, alert, agentProposals, subgraph, {
      topFeatures: mlTopFeatures,
      ruleEngine: mlRuleEngine,
      caregiverBlock: mlCaregiverBlock,
      rawVitals: mlRawVitals,
      confidenceRatio: mlConfidenceRatio,
    });
    const nCtx = this.getSlmContextSize();
    const budgeted = this.budgetExplainPrompts(systemPrompt, userPrompt, nCtx);
    userPrompt = budgeted.user;

    const turnId = `turn-${Date.now()}`;

    this.addTrace({
      agent: 'orchestrator',
      thought: `Acquiring SLM lease for explain_alert (n_ctx=${nCtx}).`,
    });
    const lease = await this.slmTasks.acquire('explain_alert');

    let slmResult;
    try {
      this.addTrace({ agent: 'orchestrator', thought: 'Selecting skill: explain-anomaly for alert-explain flow.' });
      this.addTrace({ agent: 'orchestrator', thought: 'Calling SLM with RAG context, skill prompt, and skill-filtered tool schemas.' });
      slmResult = await this.slm.chat(
        [
          { role: 'system', content: budgeted.system },
          { role: 'user', content: userPrompt },
        ],
        () => {},
        new AbortController().signal,
        {
          ...this.getExplainGeneration(),
          maxTokens: 768,
          maxReasoningTokens: 384,
        },
        // Capture reasoning for the transparency trace (D4). Not displayed
        // to the caregiver — the explain path waits for the full answer.
        (reasoningToken) => {
          this.addTrace({
            agent: 'slm',
            thought: `reasoning_token(${reasoningToken.length})`,
          });
        },
      );
    } finally {
      lease.release();
    }

    const citations = context.retrieval.citations;
    const turn: SlmTurn = {
      turnId,
      alertId,
      patientId,
      modelId: 'slm',
      latencyMs: slmResult.latencyMs,
      createdAt: new Date().toISOString(),
    };
    insertSlmTurn(turn, citations);
    writeSlmTurnEdges(turnId, alertId, citations);
    auditSlmTurn(patientId, turnId, { alertId, latencyMs: slmResult.latencyMs, tokensGenerated: slmResult.tokensGenerated });

    const action: CaregiverAction = {
      actionId: `act-${Date.now()}`,
      alertId,
      patientId,
      caregiverId,
      type: 'ask_slm',
      payloadJson: JSON.stringify({ turnId, slmModel: this.slm.getLoadedModelId?.() ?? 'slm', latencyMs: slmResult.latencyMs }),
      createdAt: new Date().toISOString(),
    };
    insertCaregiverAction(action);
    writeActionEdges(action.actionId, alertId, caregiverId);
    auditCaregiverAction(patientId, action.actionId, action.type, alertId);

    const proposal = this.parseProposal(slmResult.text, context, alertId);
    proposal.trace = this.trace;
    proposal.citations = citations;
    // Severity-gated next-step injection
    proposal.nextSteps = this.injectSeverityGatedNextSteps(proposal.nextSteps, alert.severity);
    return proposal;
  }

  /**
   * Called when the caregiver answers a clarifying question.
   * The answer becomes a new observation and optionally triggers another SLM turn.
   */
  async answerClarifyingQuestion(
    alertId: string,
    caregiverId: string,
    questionId: string,
    selectedOption: string,
  ): Promise<AgentProposal> {
    const action: CaregiverAction = {
      actionId: `act-${Date.now()}`,
      alertId,
      patientId: getAlertById(alertId)?.patientId ?? '',
      caregiverId,
      type: 'answer_clarifying_question',
      payloadJson: JSON.stringify({ questionId, selectedOption }),
      createdAt: new Date().toISOString(),
    };
    insertCaregiverAction(action);
    writeActionEdges(action.actionId, alertId, caregiverId);
    auditCaregiverAction(action.patientId, action.actionId, action.type, alertId);

    // Log the observation and re-run explain with the new fact.
    await this.client.callTool('log_observation', {
      alertId,
      observation: `Caregiver answered clarifying question ${questionId}: ${selectedOption}`,
      caregiverId,
      patientId: action.patientId,
    });

    return this.explainAlert(alertId, caregiverId);
  }

  async explainRehabTrajectory(
    resultId: string,
    caregiverId: string,
  ): Promise<AgentProposal> {
    this.trace = [];
    const result = getUc3TrajectoryResultById(resultId);
    if (!result) throw new Error(`UC3 trajectory result not found: ${resultId}`);

    const snapshot = this.snapshotProvider();
    if (!snapshot) {
      throw new Error('PatientRecordStore snapshot not available');
    }
    if (snapshot.patient?.patientId && snapshot.patient.patientId !== result.patientId) {
      throw new Error(`UC3 result ${resultId} does not belong to active patient ${snapshot.patient.patientId}`);
    }
    if (snapshot.carePlan?.planId && snapshot.carePlan.planId !== result.carePlanId) {
      throw new Error(`UC3 result ${resultId} does not match active CarePlan ${snapshot.carePlan.planId}`);
    }

    const patientId = result.patientId;
    const intent = `Explain rehab trajectory ${resultId}: ${result.eventType}`;
    this.addTrace({
      agent: 'orchestrator',
      thought: 'Building aggregated context for UC3 rehab trajectory explain.',
    });
    const context = await buildAggregatedContext(patientId, intent, this.retriever, snapshot);
    if (this.priorDecisionsProvider) {
      context.priorDecisions = this.priorDecisionsProvider({ patientId });
    }

    const metricSummary = this.summarizeUc3Metrics(result.metricAnalyses);
    const structuredBlock = [
      'UC3 REHAB TRAJECTORY RESULT (persisted - do not re-score or invent vitals)',
      `eventType: ${result.eventType}`,
      `severity: ${result.severity}`,
      `requiresHumanReview: ${result.requiresHumanReview}`,
      `emergencyThresholdBreach: ${result.emergencyThresholdBreach}`,
      `reviewPriorityScore: ${result.reviewPriorityScore}`,
      `reasonCodes: ${result.reasonCodes.join(', ')}`,
      'explanations:',
      ...result.explanations.slice(0, 6).map((explanation) => `- ${explanation}`),
      'keyMetrics:',
      metricSummary,
      `dataQuality: sufficient=${Boolean((result.dataQuality as { sufficientData?: boolean } | null)?.sufficientData)}`,
    ].join('\n');

    const activeSkill = 'explain-rehab-trajectory' as SkillId;
    // System once only — previously system was duplicated into the user message,
    // which overflowed n_ctx ("context is full") on 2–4k windows.
    const systemPrompt = this.buildSystemPrompt(context, activeSkill);
    let userPrompt = [
      structuredBlock,
      '',
      rehabTrajectoryBlock(context.rehabTrajectory),
      '',
      progressMeasuresBlock(context.progressMeasures),
      '',
      'Explain this rehab trajectory result to the caregiver in plain language.',
      'Do not diagnose. Do not change severity. Do not invent measurements.',
      'Keep the answer to a short paragraph plus a few bullets.',
    ].join('\n');

    const nCtx = this.getSlmContextSize();
    const budgeted = this.budgetExplainPrompts(systemPrompt, userPrompt, nCtx);
    const finalSystem = budgeted.system;
    userPrompt = budgeted.user;

    const turnId = `turn-uc3-${Date.now()}`;
    this.addTrace({
      agent: 'orchestrator',
      thought: `UC3 explain budget n_ctx=${nCtx} system~${Math.ceil(finalSystem.length / 4)} user~${Math.ceil(userPrompt.length / 4)} tokens.`,
    });
    const lease = await this.slmTasks.acquire('explain_rehab_trajectory');

    let slmResult;
    try {
      this.addTrace({
        agent: 'orchestrator',
        thought: 'Selecting skill: explain-rehab-trajectory.',
      });
      slmResult = await this.slm.chat(
        [
          { role: 'system', content: finalSystem },
          { role: 'user', content: userPrompt },
        ],
        () => {},
        new AbortController().signal,
        // Finite budgets — unlimited explain + huge prompt filled the window.
        {
          ...this.getExplainGeneration(),
          maxTokens: 512,
          maxReasoningTokens: 256,
        },
        (reasoningToken) => {
          this.addTrace({
            agent: 'slm',
            thought: `reasoning_token(${reasoningToken.length})`,
          });
        },
      );
    } finally {
      lease.release();
    }

    const citations = context.retrieval.citations;
    const turn: SlmTurn = {
      turnId,
      alertId: result.resultId,
      patientId,
      modelId: 'slm',
      latencyMs: slmResult.latencyMs,
      tokensGenerated: slmResult.tokensGenerated,
      createdAt: new Date().toISOString(),
    };
    insertSlmTurn(turn, citations);
    auditSlmTurn(patientId, turnId, {
      alertId: result.resultId,
      latencyMs: slmResult.latencyMs,
      tokensGenerated: slmResult.tokensGenerated,
      skill: 'explain-rehab-trajectory',
      caregiverId,
    });

    const proposal = this.parseProposal(slmResult.text, context, result.resultId);
    proposal.trace = this.trace;
    proposal.citations = citations;
    const mappedSeverity =
      result.emergencyThresholdBreach || result.severity === 'urgent' ? 3 : 2;
    proposal.nextSteps = this.injectSeverityGatedNextSteps(
      proposal.nextSteps,
      mappedSeverity as 1 | 2 | 3,
    );
    return proposal;
  }

  async explainUc4PriorityCard(
    cardId: string,
    caregiverId: string,
  ): Promise<AgentProposal> {
    this.trace = [];
    const card = getUc4PriorityCardSummaryById(cardId);
    if (!card) throw new Error(`UC4 priority card not found: ${cardId}`);
    const run = getUc4RunSummaryById(card.runId);
    if (!run) throw new Error(`UC4 run not found for card ${cardId}: ${card.runId}`);

    const snapshot = this.snapshotProvider();
    if (!snapshot) {
      throw new Error('PatientRecordStore snapshot not available');
    }
    if (snapshot.patient?.patientId && snapshot.patient.patientId !== card.patientId) {
      throw new Error(`UC4 card ${cardId} does not belong to active patient ${snapshot.patient.patientId}`);
    }

    const patientId = card.patientId;
    const intent = `Explain UC4 care focus card ${card.cardId}: ${card.title}`;
    const context = await buildAggregatedContext(patientId, intent, this.retriever, snapshot);
    if (this.priorDecisionsProvider) {
      context.priorDecisions = this.priorDecisionsProvider({ patientId });
    }

    const deterministicSummary = [
      'UC4 CARE FOCUS CARD (persisted - do not re-score or change templates)',
      `runId: ${run.runId}`,
      `runStatus: ${run.status}`,
      `cardId: ${card.cardId}`,
      `templateId: ${card.templateId}`,
      `priorityKind: ${card.priorityKind}`,
      `title: ${card.title}`,
      `body: ${card.body}`,
      `domain: ${card.domain}`,
      `score: ${card.score}`,
      `firedRuleCodes: ${card.firedRuleCodes.join(', ')}`,
      `safetyBoundary: ${card.safetyBoundary}`,
      `whatToLogNextSchemaJson: ${JSON.stringify(card.whatToLogNextSchema)}`,
      `evidenceJson: ${JSON.stringify(card.evidence)}`,
    ].join('\n');

    const activeSkill = 'uc4-provider-summary-rewrite' as SkillId;
    const systemPrompt = this.buildSystemPrompt(context, activeSkill);
    let userPrompt = [
      'Explain the following deterministic UC4 care focus card for a family caregiver.',
      'Keep all facts, scores, template IDs, and safety boundaries unchanged.',
      'No diagnosis. No medication causality. No treatment changes.',
      'Keep the answer short (one short paragraph + bullets).',
      '',
      deterministicSummary,
    ].join('\n');
    const nCtx = this.getSlmContextSize();
    const budgeted = this.budgetExplainPrompts(systemPrompt, userPrompt, nCtx);
    const lease = await this.slmTasks.acquire('uc4_provider_summary_rewrite');
    const turnId = `turn-uc4-${Date.now()}`;
    let slmResult;
    try {
      slmResult = await this.slm.chat(
        [
          { role: 'system', content: budgeted.system },
          { role: 'user', content: budgeted.user },
        ],
        () => {},
        new AbortController().signal,
        {
          ...this.getExplainGeneration(),
          maxTokens: 512,
          maxReasoningTokens: 256,
        },
      );
    } finally {
      lease.release();
    }

    const citations = context.retrieval.citations;
    const turn: SlmTurn = {
      turnId,
      alertId: card.cardId,
      patientId,
      modelId: 'slm',
      latencyMs: slmResult.latencyMs,
      tokensGenerated: slmResult.tokensGenerated,
      createdAt: new Date().toISOString(),
    };
    insertSlmTurn(turn, citations);
    auditSlmTurn(patientId, turnId, {
      alertId: card.cardId,
      latencyMs: slmResult.latencyMs,
      tokensGenerated: slmResult.tokensGenerated,
      skill: 'uc4-provider-summary-rewrite',
      caregiverId,
    });

    const proposal = this.parseProposal(slmResult.text, context, card.cardId);
    proposal.trace = this.trace;
    proposal.citations = citations;
    return proposal;
  }

  async rewriteUc4ProviderSummary(
    patientId: string,
    deterministicSummary: string,
  ): Promise<string> {
    const snapshot = this.snapshotProvider();
    if (!snapshot) {
      throw new Error('PatientRecordStore snapshot not available');
    }
    if (snapshot.patient?.patientId && snapshot.patient.patientId !== patientId) {
      throw new Error(`UC4 summary patient ${patientId} does not match active patient ${snapshot.patient.patientId}`);
    }
    const context = await buildAggregatedContext(
      patientId,
      'Rewrite UC4 provider summary',
      this.retriever,
      snapshot,
    );
    const activeSkill = 'uc4-provider-summary-rewrite' as SkillId;
    const lease = await this.slmTasks.acquire('uc4_provider_summary_rewrite');
    try {
      const slmResult = await this.slm.chat(
        [
          {
            role: 'system',
            content: this.buildSystemPrompt(context, activeSkill),
          },
          {
            role: 'user',
            content: [
              'Rewrite the following deterministic UC4 provider summary for clinician readability.',
              'Keep all facts, scores, and template IDs unchanged. No diagnosis. No medication causality.',
              '',
              deterministicSummary,
            ].join('\n'),
          },
        ],
        () => {},
        new AbortController().signal,
        { ...this.getExplainGeneration() },
      );
      return slmResult.text;
    } finally {
      lease.release();
    }
  }

  private buildSystemPrompt(context: AggregatedContext, skillId?: SkillId): string {
    // Filter the visible tool list to the active skill's allow-list. This
    // is the per-skill scope enforcement from planning/17 §3d.
    const visibleTools = skillId
      ? filterToolsForSkill(skillId, TOOL_SCHEMAS)
      : TOOL_SCHEMAS;

    const caregiverFirst = (context.caregiver?.name ?? '').trim().split(/\s+/)[0] || 'caregiver';
    const patientFirst = (context.patient.name ?? '').trim().split(/\s+/)[0] || 'the patient';

    const skillFragment = getSkillPromptFragment(skillId ?? '');

    const prior = (context as AggregatedContext & { priorDecisions?: PriorDecisionEntry[] }).priorDecisions;

    return [
      personaPreamble({ voice: 'explain', caregiverFirst, patientFirst }),
      '',
      skillFragment,
      '',
      'RULES',
      '- Never diagnose. Never give definitive clinical instructions.',
      '- Defer clinical decisions to the care team or emergency services when red flags are present.',
      '- Ground clinical claims in CITATIONS below. Add the source label in brackets after the relevant statement (e.g., "Common side effects include nausea [Drug Label]" or "Studies show improved outcomes [PubMed]").',
      '- If a fact is missing, ask ONE multiple-choice clarifying question (2–4 options). Never ask open-ended questions.',
      '- For severity-3 alerts: call_911 and/or go_to_er must appear first in NEXT_STEPS.',
      '',
      sensitiveTopicsInstruction(),
      '',
      'USING THE CAREGIVER\'S NAME',
      '- Use the caregiver\'s name when the situation is urgent, emotionally significant, or when establishing rapport.',
      '- For routine clinical explanations, you can address them directly without the name.',
      '',
      patientBlock({
        name: context.patient.name,
        age: context.patient.age,
        primaryCondition: context.patient.primaryCondition,
        comorbidities: context.patient.comorbidities,
        symptoms: context.symptoms,
        medications: context.patient.medications,
        spo2Cutoff: context.patient.spo2Cutoff,
        baselineHeartRate: context.patient.baselineHeartRate,
        functionalScales: (context.patient as AggregatedContext['patient'] & { functionalScales?: { gmfcs?: string; fms?: string; macs?: string; cfcs?: string; edacs?: string } }).functionalScales,
        location: (context.patient as AggregatedContext['patient'] & { location?: string }).location,
      }),
      '',
      thresholdsBlock(context.activeThresholds),
      '',
      carePlanGoalsBlock(context.carePlanGoals),
      '',
      recentVitalsBlock(context.recentVitals),
      '',
      progressMeasuresBlock(context.progressMeasures),
      '',
      rehabTrajectoryBlock(context.rehabTrajectory),
      '',
      uc4PrioritiesBlock(context.uc4Priorities),
      '',
      budgetAwareCitationsBlock(context.retrieval.chunks, 1200),
      '',
      toolsBlock(visibleTools),
      '',
      priorDecisionsBlock(prior ?? []),
      '',
      'If you want the caregiver to use a tool, include a line like:',
      'ACTION: tool_name({"arg":"value"})',
    ].filter(Boolean).join('\n');
  }

  private buildExplainPrompt(
    context: AggregatedContext,
    alert: Alert,
    agentProposals: AgentProposalInternal[],
    subgraph: import('@/knowledge/graph').ContextSubgraph,
    mlData?: {
      topFeatures: [string, number][];
      ruleEngine: { is_emergency: boolean; severity: number; reasons: string[] } | null;
      caregiverBlock: { action?: string; confirmed?: boolean; observations?: string[] } | null;
      rawVitals: MlRawVitalsPayload | null;
      confidenceRatio: number | null;
    },
  ): string {
    const agentNotes = agentProposals
      .flatMap((p) => p.safetyNotes)
      .map((n) => `- ${n}`)
      .join('\n');

    const graphVitals = subgraph.recentSamples
      .slice(0, 10)
      .map((n) => `- ${n.label} at ${String(n.data.recordedAt)}`)
      .join('\n');

    const graphThresholds = subgraph.activeThresholds
      .map((n) => `- ${n.label} (severity ${n.data.severity})`)
      .join('\n');

    const graphMeds = subgraph.relatedMedications
      .map((n) => `- ${n.label}`)
      .join('\n');

    // ML → SLM bridge: structured pre-explanation from the ML model.
    // The SLM's job narrows from "explain this alert" to "contextualize this
    // already-explained anomaly for this specific caregiver."
    const mlBlock: string[] = [];
    if (mlData) {
      mlBlock.push('', 'ML MODEL OUTPUT (structured pre-explanation — do not contradict)');
      if (mlData.topFeatures.length > 0) {
        mlBlock.push('Top contributing features (feature → reconstruction error contribution):');
        for (const [name, contribution] of mlData.topFeatures) {
          mlBlock.push(`  - ${name}: ${contribution.toFixed(2)}`);
        }
      }
      if (mlData.ruleEngine) {
        mlBlock.push(`Rule engine: emergency=${mlData.ruleEngine.is_emergency}, severity=${mlData.ruleEngine.severity}`);
        if (mlData.ruleEngine.reasons.length > 0) {
          mlBlock.push(`Reasons: ${mlData.ruleEngine.reasons.join('; ')}`);
        }
      }
      if (mlData.caregiverBlock) {
        mlBlock.push(`Caregiver HITL: action=${mlData.caregiverBlock.action ?? 'pending'}, confirmed=${mlData.caregiverBlock.confirmed ?? false}`);
        if (mlData.caregiverBlock.observations && mlData.caregiverBlock.observations.length > 0) {
          mlBlock.push(`Caregiver observations (ground truth — use these): ${mlData.caregiverBlock.observations.join(', ')}`);
        }
      }
      if (mlData.rawVitals) {
        mlBlock.push(`Raw vitals snapshot: ${this.formatRawVitalsSnapshot(mlData.rawVitals)}`);
      }
      if (mlData.confidenceRatio !== null) {
        mlBlock.push(`Anomaly confidence ratio: ${mlData.confidenceRatio.toFixed(2)} (higher = more confident anomaly)`);
      }
    }

    return [
      `Alert: ${alert.title}`,
      `Severity: ${alert.severity}`,
      typeof alert.mlScore === 'number' ? `ML anomaly score: ${formatScore(alert.mlScore)}` : '',
      ...mlBlock,
      '',
      'Agent safety notes:',
      agentNotes || 'None',
      '',
      'Recent graph vitals:',
      graphVitals || 'No recent samples',
      '',
      'Graph thresholds:',
      graphThresholds || 'None',
      '',
      'Graph meds:',
      graphMeds || 'None documented',
      '',
      'Write a 2–4 sentence explanation for the caregiver, leading with the action they should take now. Then any red flags. Then the NEXT_STEPS block (severity-3 first).',
      '',
      'GROUND TRUTH',
      '- The ML model output above is WHY the alert fired — top features are the cause. Build the explanation on them.',
      '- The caregiver observations are ground truth. Do not ask about things already confirmed.',
      '- If information is still missing, ask ONE multiple-choice clarifying question (2–4 options).',
      '',
      'OUTPUT FORMAT',
      'After the explanation, emit EXACTLY this block:',
      'NEXT_STEPS:',
      '- [call_911] Call 911',
      '- [contact_pcp] Contact Dr. Reynolds',
      '- [monitor_home] Continue monitoring at home',
      '',
      'Action ids allowed: call_911, go_to_er, contact_pcp, geofence_service, schedule_urgent_appt, share_record, monitor_home, log_note.',
      'Order by urgency. Severity-3 must include call_911 and/or go_to_er first.',
      '',
      'CONSTRAINTS',
      '- Allowed: non-diagnostic explanation, structured follow-ups, caregiver-safe next steps, provider-ready summary if escalated.',
      '- Blocked: diagnosis, clinical certainty, medication changes, overriding the rule engine or anomaly model.',
      '- You contextualize the anomaly; you do not decide whether it exists.',
    ].join('\n');
  }

  private formatRawVitalsSnapshot(rawVitals: MlRawVitalsPayload): string {
    const maybeEnvelope = rawVitals as { contract?: unknown; input?: unknown };
    const vitals =
      maybeEnvelope.contract === 'AppleWatchVitalsInput' &&
      maybeEnvelope.input !== null &&
      typeof maybeEnvelope.input === 'object'
        ? (maybeEnvelope.input as Record<string, string | number | undefined>)
        : (rawVitals as Record<string, string | number | undefined>);

    return Object.entries(vitals)
      .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`)
      .join(', ');
  }

  /**
   * Truncate the prompt to fit within a token budget (approx 4 chars/token).
   * Truncates RAG chunks and conversation history first, never the alert context.
   */
  private truncateToTokenBudget(prompt: string, maxTokens: number): string {
    const approxTokens = Math.ceil(prompt.length / 4);
    if (approxTokens <= maxTokens) return prompt;

    const maxChars = Math.max(0, maxTokens) * 4;
    const truncated = prompt.slice(0, maxChars);
    const lastNewline = truncated.lastIndexOf('\n');
    const result = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
    this.addTrace({
      agent: 'orchestrator',
      thought: `Prompt truncated from ~${approxTokens} to ~${Math.ceil(result.length / 4)} tokens.`,
    });
    return result + '\n\n[Context truncated to fit model context window.]';
  }

  /** Loaded model n_ctx (falls back to 4096). */
  private getSlmContextSize(): number {
    const fromProvider = this.slm.getContextSize?.();
    if (typeof fromProvider === 'number' && fromProvider > 0) return fromProvider;
    const info = this.slm.getModelInfo?.();
    if (info && typeof info.nCtx === 'number' && info.nCtx > 0) return info.nCtx;
    return 4096;
  }

  /**
   * Model-aware explain generation defaults (sampling follows the loaded
   * catalog family; explain paths override the token budgets below).
   */
  private getExplainGeneration(): Required<GenerateOptions> {
    return {
      ...getConciergeGeneration(this.slm.getLoadedModelId?.() ?? null, 'deep'),
      reasoningFormat: REASONING_FORMAT_EXPLAIN,
    };
  }

  /** Compact UC3 metric dump for explain prompts (avoids multi-KB JSON). */
  private summarizeUc3Metrics(metricAnalyses: unknown): string {
    if (!metricAnalyses || typeof metricAnalyses !== 'object') return '- (none)';
    const lines: string[] = [];
    for (const [key, raw] of Object.entries(metricAnalyses as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue;
      const m = raw as Record<string, unknown>;
      const bits = [
        m.finalActual != null ? `actual=${m.finalActual}` : null,
        m.finalExpected != null ? `expected=${m.finalExpected}` : null,
        m.gapPercent != null ? `gap=${m.gapPercent}` : null,
        m.plateauDays != null ? `plateauDays=${m.plateauDays}` : null,
      ].filter(Boolean);
      if (bits.length > 0) lines.push(`- ${key}: ${bits.join(', ')}`);
      if (lines.length >= 6) break;
    }
    return lines.length > 0 ? lines.join('\n') : '- (none)';
  }

  /**
   * Fit system + user explain prompts into n_ctx with room for generation.
   * Shrinks user first, then system (tools/RAG), never drops the UC3/UC4 core block if possible.
   */
  private budgetExplainPrompts(
    system: string,
    user: string,
    nCtx: number,
  ): { system: string; user: string } {
    // Leave headroom for chat template + generation (answer + short think).
    const reserveGen = Math.min(768, Math.max(256, Math.floor(nCtx * 0.2)));
    const overhead = 48;
    let budget = Math.max(512, nCtx - reserveGen - overhead);

    let sys = system;
    let usr = user;
    const tokens = (s: string) => Math.ceil(s.length / 4);

    // Prefer keeping user (structured UC result) and trim bloated system first.
    if (tokens(sys) + tokens(usr) > budget) {
      const maxSys = Math.min(tokens(sys), Math.floor(budget * 0.55));
      sys = this.truncateToTokenBudget(sys, maxSys);
    }
    if (tokens(sys) + tokens(usr) > budget) {
      const maxUsr = Math.max(200, budget - tokens(sys));
      usr = this.truncateToTokenBudget(usr, maxUsr);
    }
    // Last resort: hard-cap both.
    if (tokens(sys) + tokens(usr) > budget) {
      sys = this.truncateToTokenBudget(sys, Math.floor(budget / 2));
      usr = this.truncateToTokenBudget(usr, Math.floor(budget / 2));
    }
    return { system: sys, user: usr };
  }

  /**
   * Confidence router: for severity-3 alerts, return preliminary guidance
   * without loading the SLM. The caregiver can still tap "Explain" for a
   * full SLM response.
   */
  private buildPreliminaryGuidance(alert: Alert): AgentProposal | null {
    if (alert.severity !== 3) return null;

    const message = [
      `**Emergency alert: ${alert.title}**`,
      '',
      alert.body,
      '',
      'This is a severity-3 threshold violation. **Call 911 or go to the nearest ER** if the situation is life-threatening.',
      'You can tap "Ask the assistant" for a detailed explanation.',
    ].join('\n');

    return {
      message,
      citations: [],
      proposedActions: [],
      nextSteps: this.injectSeverityGatedNextSteps(undefined, 3),
      safety: {
        ok: true,
        notes: ['Preliminary guidance — SLM not invoked for severity-3 fast path.'],
      },
      trace: [],
    };
  }

  /**
   * High-confidence guidance: for sub-severity-3 alerts with a very high
   * reconstruction-error/threshold ratio AND caregiver confirmation, return
   * heuristic next-steps without loading the SLM. The SLM is spared for
   * ambiguous cases; the caregiver can still tap "Ask assistant" for a
   * full explanation.
   */
  private buildHighConfidenceGuidance(
    alert: Alert,
    topFeatures: [string, number][],
    caregiverBlock: { action?: string; confirmed?: boolean; observations?: string[] } | null,
  ): AgentProposal {
    const featureSummary = topFeatures.length > 0
      ? topFeatures.slice(0, 3).map(([name, val]) => `${name} (↑${val.toFixed(1)})`).join(', ')
      : 'multiple vitals';

    const observationSummary = caregiverBlock?.observations?.length
      ? `\n\nCaregiver confirmed: ${caregiverBlock.observations.join(', ')}.`
      : '';

    const message = [
      `**Anomaly detected: ${alert.title}**`,
      '',
      `The Alert ML model flagged this anomaly with high confidence. The top contributing`,
      `factors were: ${featureSummary}.${observationSummary}`,
      '',
      'This does not appear to be an emergency, but it warrants attention. Monitor the',
      'patient closely and contact the care team if symptoms worsen.',
      '',
      'You can tap "Ask the assistant" for a detailed explanation.',
    ].join('\n');

    return {
      message,
      citations: [],
      proposedActions: [],
      nextSteps: this.injectSeverityGatedNextSteps(
        [{ actionId: 'monitor_home' as const, label: 'Continue monitoring at home' }],
        alert.severity,
      ),
      safety: {
        ok: true,
        notes: ['High-confidence heuristic guidance — SLM not invoked (reconstruction-error ratio > 3 with caregiver confirmation).'],
      },
      trace: [],
    };
  }

  /**
   * Severity-gated next-step injection.
   * For severity-3: always include call_911 and go_to_er, sorted first.
   */
  private injectSeverityGatedNextSteps(
    parsed: NextStep[] | undefined,
    severity: number,
  ): NextStep[] {
    const result: NextStep[] = parsed ? [...parsed] : [];

    if (severity === 3) {
      const has911 = result.some((s) => s.actionId === 'call_911');
      const hasER = result.some((s) => s.actionId === 'go_to_er');
      if (!has911) {
        result.unshift({ actionId: 'call_911', label: 'Call 911' });
      }
      if (!hasER) {
        const has911Now = result.some((s) => s.actionId === 'call_911');
        result.splice(has911Now ? 1 : 0, 0, { actionId: 'go_to_er', label: 'Go to nearest ER' });
      }
    }

    // Sort by taxonomy order
    const orderMap = new Map(NEXT_STEP_TAXONOMY.map((t) => [t.actionId, t.order]));
    result.sort((a, b) => (orderMap.get(a.actionId) ?? 99) - (orderMap.get(b.actionId) ?? 99));

    return result;
  }

  private parseProposal(text: string, _context: AggregatedContext, alertId: string): AgentProposal {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const actionLines = lines.filter((l) => l.startsWith('ACTION:'));
    const questionMatch = text.match(/QUESTION:\s*(.+?)\nOPTIONS:\s*([\s\S]+?)(?:\n\n|\nACTION:|\nNEXT_STEPS:|$)/i);

    const proposedActions = actionLines.map((line) => {
      const match = line.match(/ACTION:\s*(\w+)\((.*)\)/);
      if (!match) return null;
      try {
        return {
          tool: match[1],
          args: { ...JSON.parse(match[2]), alertId },
          rationale: 'Suggested by SLM',
        };
      } catch {
        return null;
      }
    }).filter((a): a is NonNullable<typeof a> => Boolean(a));

    let clarifyingQuestion: ClarifyingQuestion | undefined;
    if (questionMatch) {
      const options = questionMatch[2]
        .split('\n')
        .map((o) => o.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean);
      clarifyingQuestion = {
        questionId: `q-${Date.now()}`,
        question: questionMatch[1].trim(),
        options,
      };
    }

    // Parse NEXT_STEPS: block
    const nextSteps = this.parseNextSteps(text);

    // Strip ACTION:, QUESTION:/OPTIONS:, and NEXT_STEPS: blocks from the message
    const message = text
      .replace(/ACTION:.*\n?/g, '')
      .replace(/QUESTION:.*OPTIONS:[\s\S]*?(?:\n\n|\nACTION:|\nNEXT_STEPS:|$)/gi, '')
      .replace(/NEXT_STEPS:[\s\S]*$/i, '')
      .trim();

    return {
      message,
      citations: [],
      proposedActions,
      clarifyingQuestion,
      nextSteps: nextSteps.length > 0 ? nextSteps : undefined,
      safety: { ok: true, notes: [] },
      trace: [],
    };
  }

  private parseNextSteps(text: string): NextStep[] {
    const match = text.match(/NEXT_STEPS:\s*([\s\S]*?)(?:\n\n|$)/i);
    if (!match) return [];

    const steps: NextStep[] = [];
    const lines = match[1].split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const stepMatch = line.match(/^-\s*\[(\w+)\]\s*(.+)/);
      if (stepMatch) {
        const actionId = stepMatch[1];
        const label = stepMatch[2].trim();
        if (isValidActionId(actionId)) {
          steps.push({ actionId: actionId as NextStepActionId, label });
        }
      }
    }
    return steps;
  }

  /**
   * Re-run UC2 with caregiver observation codes (alert-detail HITL).
   * Updates alert + ml_events so explain uses post-HITL context.
   *
   * Vitals source order:
   *   1) raw vitals envelope on the ml_event (best — same snapshot as original ML)
   *   2) latest health_samples for the patient (threshold-only / legacy alerts)
   */
  async reRunHitlForAlert(
    alertId: string,
    observationCodes: string[],
  ): Promise<UC2DecisionResult | null> {
    if (!this.alertMlService) return null;
    const alert = getAlertById(alertId);
    if (!alert) return null;
    const mlEvent = getMlEventForAlert(alertId);
    const raw = mlEvent ? parseRawVitals(mlEvent) : null;

    let input: AppleWatchVitalsInput | null = null;
    if (raw && typeof raw === 'object') {
      const envelope = raw as { input?: AppleWatchVitalsInput; contract?: string };
      if (envelope.input && typeof envelope.input === 'object') {
        input = {
          ...envelope.input,
          patient_id: alert.patientId,
          timestamp: envelope.input.timestamp ?? new Date().toISOString(),
        };
      } else {
        const vitals = raw as Record<string, number | undefined>;
        input = {
          patient_id: alert.patientId,
          timestamp: new Date().toISOString(),
          heart_rate: vitals.heart_rate,
          blood_oxygen: vitals.blood_oxygen,
          blood_pressure_systolic: vitals.blood_pressure_systolic,
          blood_pressure_diastolic: vitals.blood_pressure_diastolic,
          glucose_level: vitals.glucose_level,
          body_temperature: vitals.body_temperature,
          respiratory_rate: vitals.respiratory_rate,
        };
      }
    }

    if (!input || (input.blood_oxygen == null && input.heart_rate == null)) {
      input = this.alertMlService.tryBuildInputFromRecentSamples(alert.patientId, {
        minTypes: 1,
        requireCoreVital: true,
      });
    }

    if (!input || (input.blood_oxygen == null && input.heart_rate == null)) {
      return null;
    }

    // Normalize SpO2 if a legacy fraction snuck into stored raw vitals.
    if (input.blood_oxygen != null) {
      input = {
        ...input,
        blood_oxygen: normalizeVitalForThreshold('spo2', input.blood_oxygen),
      };
    }

    const snapshot = this.snapshotProvider?.() ?? null;
    const profile = this.alertMlService.profileFromSnapshot(alert.patientId, snapshot);

    const result = await this.alertMlService.runDecisionLayer(
      input,
      profile,
      observationCodes,
    );
    if (!result) return null;

    const postType = result.postHitlAnomalyType ?? result.post_hitl_anomaly_type;
    const severity = (result.finalDecision?.final_severity ??
      result.post_hitl_severity ??
      alert.severity) as 1 | 2 | 3;
    const aeScore = result.aeScore ?? result.ae_score_mse ?? undefined;
    const scoreRatio =
      aeScore != null && result.threshold
        ? aeScore / result.threshold
        : undefined;

    updateAlertMlFields(alertId, {
      severity: severity >= 1 && severity <= 3 ? severity : alert.severity,
      postHitlAnomalyType: typeof postType === 'string' ? postType : undefined,
      mlScore: aeScore ?? undefined,
      scoreRatio,
      aeScore: aeScore ?? undefined,
      title: result.finalDecision?.final_notification_title || alert.title,
      body: result.finalDecision?.final_notification_body || alert.body,
    });

    if (mlEvent) {
      updateMlEventPostHitl(mlEvent.eventId, {
        caregiverJson: JSON.stringify({
          action: 'confirm_concern',
          confirmed: true,
          observations: observationCodes,
        }),
        postHitlAnomalyType: typeof postType === 'string' ? postType : undefined,
        reconstructionError: aeScore ?? undefined,
        scoreRatio,
      });
    }

    this.addTrace({
      agent: 'orchestrator',
      thought: `HITL re-run for ${alertId}: postType=${String(postType)}, severity=${severity}, codes=${observationCodes.join(',')}`,
    });

    return result;
  }

  async executeHypotheticalEval(
    action: { tool: string; args: Record<string, unknown>; rationale: string },
    patientId: string,
    options?: { caregiverSelectedCodes?: string[] },
  ): Promise<{ mlResult: UC2DecisionResult | null; evalBlock: string }> {
    if (action.tool !== 'evaluate_hypothetical_vitals') return { mlResult: null, evalBlock: '' };
    if (!this.alertMlService) return { mlResult: null, evalBlock: '' };

    const input: AppleWatchVitalsInput = {
      patient_id: patientId,
      timestamp: new Date().toISOString(),
      heart_rate: action.args.heart_rate as number | undefined,
      blood_oxygen: action.args.blood_oxygen as number | undefined,
      blood_pressure_systolic: action.args.blood_pressure_systolic as number | undefined,
      blood_pressure_diastolic: action.args.blood_pressure_diastolic as number | undefined,
      glucose_level: action.args.glucose_level as number | undefined,
      body_temperature: action.args.body_temperature as number | undefined,
      respiratory_rate: action.args.respiratory_rate as number | undefined,
      steps_count: undefined,
    };

    const snapshot = this.snapshotProvider?.() ?? null;
    const profile = this.alertMlService.profileFromSnapshot(patientId, snapshot);
    const codes = options?.caregiverSelectedCodes ?? [];
    const mlResult = await this.alertMlService.runDecisionLayer(input, profile, codes);
    const evalBlock = mlResult ? this.formatMlEvalForPrompt(mlResult) : '';
    this.addTrace({
      agent: 'orchestrator',
      thought: `Ran hypothetical ML eval: severity=${mlResult?.finalDecision.final_severity}, aeScore=${mlResult?.aeScore?.toFixed(2)}, codes=${codes.length}.`,
    });

    if (mlResult && mlResult.finalDecision.final_severity === 3) {
      const pendingAlertId = `hyp-${Date.now()}`;
      const bus = getEventBus();
      bus.publish({
        type: 'slm_hypothetical_critical',
        alertId: pendingAlertId,
        patientId,
        hypotheticalVitals: action.args as Partial<Record<'heart_rate' | 'blood_oxygen' | 'blood_pressure_systolic' | 'blood_pressure_diastolic' | 'glucose_level' | 'body_temperature' | 'respiratory_rate', number>>,
        mlResult: {
          severity: 3,
          aeScore: mlResult.aeScore,
          threshold: mlResult.threshold,
          isAnomaly: mlResult.isAnomaly,
          emergency: mlResult.emergencyResult.emergency,
          topFeatures: mlResult.topFeatureEvidence.map(f => [f.feature, f.importance] as [string, number]),
        },
        requiresCaregiverConfirm: true,
        at: new Date().toISOString(),
      });

      const caregiverResponse = await this.awaitCaregiverConfirm(pendingAlertId, patientId);

      if (caregiverResponse === 'confirm') {
        const alert: Alert = {
          alertId: pendingAlertId,
          patientId,
          severity: 3,
          status: 'open',
          title: `Hypothetical critical: ML evaluation flagged severity-3 anomaly`,
          body: `Caregiver-confirmed hypothetical vitals triggered a severity-3 ML alert.`,
          mlScore: mlResult.aeScore ?? undefined,
          createdAt: new Date().toISOString(),
        };
        insertAlert(alert);
        bus.publish({
          type: 'ml_alert_created',
          alertId: pendingAlertId,
          patientId,
          severity: 3,
          score: mlResult.aeScore ?? 0,
          features: mlResult.rawFeatures,
          at: new Date().toISOString(),
        });
        auditAlertCreated(patientId, pendingAlertId, {
          source: 'slm_hypothetical_eval',
          severity: 3,
          aeScore: mlResult.aeScore,
        });
      } else {
        audit({
          actor: 'caregiver',
          action: 'dismissed_hypothetical_critical',
          resourceType: 'hypothetical_alert',
          resourceId: pendingAlertId,
          patientId,
          payload: { severity: 3, aeScore: mlResult.aeScore },
        });
      }
    }

    return { mlResult, evalBlock };
  }

  private awaitCaregiverConfirm(alertId: string, patientId: string): Promise<'confirm' | 'dismiss'> {
    return new Promise((resolve) => {
      const bus = getEventBus();
      const unsub = bus.subscribe('caregiver_ground_truth', (event) => {
        if (event.type === 'caregiver_ground_truth' && event.alertId === alertId) {
          unsub();
          if (event.action === 'confirm_critical_hypothetical') {
            resolve('confirm');
          } else {
            resolve('dismiss');
          }
        }
      });
      setTimeout(() => {
        unsub();
        resolve('dismiss');
      }, 60_000);
    });
  }

  private formatMlEvalForPrompt(r: UC2DecisionResult): string {
    const post =
      r.postHitlAnomalyType ?? r.post_hitl_anomaly_type ?? r.initialAnomalyType;
    const codes = r.caregiver_selected_codes ?? [];
    const severity =
      r.finalDecision?.final_severity ?? r.post_hitl_severity ?? 0;
    const isEmergency = Boolean(
      r.emergencyResult?.emergency || severity === 3,
    );
    const suppressed = Boolean(r.finalDecision?.suppression_status?.is_suppressed);
    const suppressionReason =
      r.finalDecision?.suppression_status?.reason ?? 'cooldown';
    const friendlyCodes = codes.map((c) =>
      String(c)
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (ch) => ch.toUpperCase()),
    );
    const contributors = r.topFeatureEvidence
      .slice(0, 5)
      .map((f) =>
        String(f.feature)
          .replace(/_/g, ' ')
          .replace(/\bblood oxygen\b/i, 'oxygen level')
          .replace(/\bheart rate\b/i, 'heart rate')
          .replace(/\bsteps count\b/i, 'activity / steps')
          .replace(/\bhrv sdnn\b/i, 'heart-rate variability')
          .replace(/\bactivity level\b/i, 'activity'),
      )
      .filter(Boolean);

    const concernLevel =
      isEmergency || severity === 3
        ? 'urgent — treat as a possible emergency'
        : severity === 2
          ? 'moderate concern — not an automatic call-911 situation, but follow up soon'
          : severity === 1
            ? 'mild / watchful — unusual pattern, not an emergency by hard rules'
            : 'no strong monitor alarm';

    return [
      'INTERNAL_HEALTH_MONITOR_RESULT (for you only — do NOT paste, quote, or list these lines to the caregiver)',
      `Monitor alarm: ${r.isAnomaly ? 'unusual pattern detected' : 'no strong anomaly'}.`,
      `Hard emergency rules: ${isEmergency ? 'triggered' : 'not triggered'}.`,
      suppressed
        ? `Repeat-alarm suppression active (${suppressionReason}) — the pattern was demoted to watchful monitoring, not a new escalation.`
        : '',
      `Concern level: ${concernLevel} (internal severity ${severity}).`,
      `Pattern before caregiver notes: ${String(r.initialAnomalyType).replace(/_/g, ' ').toLowerCase()}.`,
      `Pattern after caregiver notes: ${String(post).replace(/_/g, ' ').toLowerCase()}.`,
      friendlyCodes.length > 0
        ? `Caregiver reported: ${friendlyCodes.join('; ')}.`
        : 'Caregiver did not add observation codes.',
      contributors.length > 0
        ? `Main contributors (plain language): ${contributors.join(', ')}.`
        : '',
      r.aeScore !== null
        ? `Internal score vs threshold: ${r.aeScore.toFixed(2)} vs ${r.threshold.toFixed(2)} (do not recite raw scores unless the caregiver asks for numbers).`
        : '',
      'Write a natural caregiver reply that uses this result. Never reproduce this block, snake_case labels, or feature dumps.',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
