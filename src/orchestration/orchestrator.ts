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
  insertHealthSample,
  insertHealthSamplesBatched,
  insertSlmTurn,
  type Alert,
  type CaregiverAction,
  type HealthSample,
  type SlmTurn,
  type MlEvent,
} from '@/data';
import {
  insertMlEvent,
  getMlEventForAlert,
  parseTopFeatures,
  parseRuleEngine,
  parseCaregiverBlock,
  parseRawVitals,
  getAnomalyConfidenceRatio,
} from '@/data/repositories/mlEventRepository';
import type { PatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';
import type { InferenceProvider } from '@/inference/inference-provider';
import type { FusedRetriever, RetrievedChunk } from '@/knowledge';
import { audit, auditAlertCreated, auditCaregiverAction, auditSampleRead, auditSlmTurn } from '@/services/audit/auditService';
import { checkEgressConsent } from '@/services/consent/consentGate';
import type { AlertMlModel } from '@/ml-models/alert-autoencoder';
import { AlertMlService } from '@/services/ml/alert-ml-service';
import type { AppleWatchVitalsInput, UC2DecisionResult } from '@/ml-models/uc2-decision-layer';
import type { SlmTaskQueue } from '@/services/slm/slm-task-queue';
import { store } from '@/store';
import { projectHealthSample } from '@/store/reducers/vitalsSlice';

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
import { getEventBus, type EventBus } from './event-bus';
import type { OrchestrationEvent } from './events';
import { buildAggregatedContext, type AggregatedContext } from './context-aggregator';
import {
  GraphProjector,
  buildContextSubgraph,
  writeSampleEdges,
  writeAlertEdges,
  writeActionEdges,
  writeSlmTurnEdges,
  writeTriggerEdges,
} from '@/knowledge/graph';
import {
  createInProcessMcp,
  type InProcessMcpClient,
} from './mcp/mcp-in-process';
import { TOOL_SCHEMAS } from './mcp/tool-registry';
import {
  NEXT_STEP_TAXONOMY,
  isValidActionId,
} from './next-steps';
import { CONCIERGE_GENERATION_EXPLAIN, REASONING_FORMAT_EXPLAIN } from '@/constants/concierge';
import { filterToolsForSkill, getSkillPromptFragment, type SkillId } from './skills';
import type { MlRawVitalsPayload, NextStep, NextStepActionId } from '@/data/types';
import {
  patientBlock,
  thresholdsBlock,
  carePlanGoalsBlock,
  recentVitalsBlock,
  budgetAwareCitationsBlock,
  toolsBlock,
  personaPreamble,
  priorDecisionsBlock,
  progressMeasuresBlock,
  sensitiveTopicsInstruction,
  type PriorDecisionEntry,
} from './prompt-fragments';
import { runInBackground } from '@/utils/commonFunctions';
import { ingestSamplesBatch, LiveVitalReading } from "@/store/reducers/vitalsSlice";

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

function toLiveVitalReading(sample: HealthSample): LiveVitalReading {
  return {
    patientId: sample.patientId,
    sampleId: sample.sampleId,
    type: sample.type,
    value: sample.value,
    unit: sample.unit,
    source: sample.source,
    recordedAt: sample.recordedAt,
    receivedAt: sample.receivedAt,
  };
}

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
  private static readonly DEBOUNCE_MS = 3000;
  private snapshotProvider: () => PatientRecordSnapshot | null;
  private priorDecisionsProvider?: (args: { patientId: string; alertId?: string }) => PriorDecisionEntry[];
  private vitalsWriteBuffer: Map<string, HealthSample[]> = new Map(); // per patient, or just one global array

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
    const unsubVitals = bus.subscribe('vitals_sample', (event) => {
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

    this.unsubscribe = () => {
      unsubVitals();
      unsubMl();
      unsubOverride();
    };
  }

  dispose(): void {
    this.unsubscribe?.();
    void this.alertMlService?.release();
    for (const [, entry] of this.vitalsDebounce) {
      clearTimeout(entry.timer);
    }
    this.vitalsDebounce.clear();
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
    // Persist the sample so later SLM explain paths can read it.
    const sample: HealthSample = {
      sampleId: event.sampleId,
      patientId: event.patientId,
      source: event.source ?? 'mock',
      type: event.sampleType as HealthSample['type'],
      value: event.value,
      unit: event.unit,
      recordedAt: event.recordedAt,
      receivedAt: event.receivedAt ?? new Date().toISOString(),
    };
    // Buffer instead of writing/dispatching per-event.
    const buffer = this.vitalsWriteBuffer.get(event.patientId) ?? [];
    buffer.push(sample);
    this.vitalsWriteBuffer.set(event.patientId, buffer);

    this.scheduleVitalsFlush(event.patientId); // debounced, batches insertHealthSample + dispatch

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

    // Always check thresholds; severity-3 violations short-circuit to the fast path.
    const check = await this.client.callTool('check_threshold_violation', {
      patientId: event.patientId,
      vitalType: event.sampleType,
      value: event.value,
    });
    if (!check.ok || !check.data) return;

    const { maxSeverity, violations } = check.data as {
      maxSeverity: number;
      violations: { thresholdId: string; severity: number }[];
    };

    if (maxSeverity === 3) {
      await this.emergencyFastPath(event, violations);
      return;
    }

    if (maxSeverity === 2 || maxSeverity === 1) {
      await this.createAlert(event, maxSeverity as 1 | 2, violations);
    }

    // Run the Alert ML model asynchronously after threshold handling.
    // Use debouncing: only run ML once per debounce window per patient.
    if (this.alertMlService) {
      const debounceEntry = this.vitalsDebounce.get(event.patientId);
      if (debounceEntry) {
        clearTimeout(debounceEntry.timer);
        debounceEntry.timer = setTimeout(async () => {
          const batch = debounceEntry.events;
          this.vitalsDebounce.delete(event.patientId);
          try {
            const latest = batch[batch.length - 1];
            if (latest.type === 'vitals_sample') {
              // Pass the patient record snapshot so the v2 layer can compute
              // personalized severity floors (CP GMFCS Level V, etc.).
              const snapshot = this.snapshotProvider?.() ?? null;
              await this.alertMlService?.evaluate(
                latest.patientId,
                latest as Extract<OrchestrationEvent, { type: 'vitals_sample' }>,
                snapshot,
              );
            }
          } catch (err) {
            console.error('[Orchestrator] Alert ML evaluation failed:', err);
          }
        }, Orchestrator.DEBOUNCE_MS);
      }
    }
  }

  private flushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private scheduleVitalsFlush(patientId: string): void {
    if (this.flushTimers.has(patientId)) return;
    const timer = setTimeout(() => {
      this.flushTimers.delete(patientId);
      const buffer = this.vitalsWriteBuffer.get(patientId) ?? [];
      this.vitalsWriteBuffer.delete(patientId);
      if (buffer.length === 0) return;

      runInBackground(async () => {
        await insertHealthSamplesBatched(buffer); // one transaction, not N runSync calls
        store.dispatch(ingestSamplesBatch({ samples: buffer.map(toLiveVitalReading) }));
      });
    }, 500); // small debounce, batches whatever arrived in this window
    this.flushTimers.set(patientId, timer);
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

  private async emergencyFastPath(
    event: Extract<OrchestrationEvent, { type: 'vitals_sample' }>,
    violations: { thresholdId: string; severity: number }[],
  ): Promise<void> {
    const alert: Alert = {
      alertId: `alert-${Date.now()}`,
      patientId: event.patientId,
      severity: 3,
      status: 'open',
      title: `Emergency: ${event.sampleType} ${event.value}${event.unit}`,
      body: `Severe threshold violation detected. Immediate attention required.`,
      createdAt: new Date().toISOString(),
    };
    insertAlert(alert);
    writeAlertEdges(event.patientId, alert.alertId);
    for (const v of violations) {
      writeTriggerEdges(event.sampleId, v.thresholdId, alert.alertId);
    }
    auditAlertCreated(event.patientId, alert.alertId, { source: 'threshold', violations });

    // Egress-bearing notification still goes through consent gate for audit; in
    // the severity-3 fast path the caregiver must still direct the action.
    const consent = checkEgressConsent(event.patientId, 'dispatch_alert_notification');
    if (consent.allowed) {
      await this.client.callTool('dispatch_alert_notification', {
        alertId: alert.alertId,
        bypassDnd: true,
      });
    }

    console.log('[Orchestrator] Emergency fast path triggered for', alert.alertId);
  }

  private async createAlert(
    event: Extract<OrchestrationEvent, { type: 'vitals_sample' }>,
    severity: 1 | 2,
    violations: { thresholdId: string; severity: number }[],
  ): Promise<void> {
    const alert: Alert = {
      alertId: `alert-${Date.now()}`,
      patientId: event.patientId,
      severity,
      status: 'open',
      title: `${event.sampleType} ${event.value}${event.unit}`,
      body: `Threshold violation: ${violations.map((v) => v.thresholdId).join(', ')}`,
      createdAt: new Date().toISOString(),
    };
    insertAlert(alert);
    writeAlertEdges(event.patientId, alert.alertId);
    for (const v of violations) {
      writeTriggerEdges(event.sampleId, v.thresholdId, alert.alertId);
    }
    auditAlertCreated(event.patientId, alert.alertId, { source: 'threshold', violations });

    // Dispatch an OS / in-app banner notification for non-critical threshold
    // alerts (severity 1-2) so the caregiver is proactively notified —
    // severity-3 is handled by the emergency fast path. Consent-gated; on
    // Track A (no expo-notifications) this surfaces as the in-app banner so
    // the demo shows how notifications react to dynamic data.
    try {
      const consent = checkEgressConsent(event.patientId, 'dispatch_alert_notification');
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
    if ('retrieveDeep' in this.retriever && typeof (this.retriever as { retrieveDeep?: unknown }).retrieveDeep === 'function') {
      try {
        const deepResult = await (this.retriever as { retrieveDeep: (q: { intent: string; conditions: string[]; activeMeds: string[]; kTools: number; kChunks: number }) => Promise<{ chunks: RetrievedChunk[] }> }).retrieveDeep({
          intent,
          conditions: context.patient.conditions,
          activeMeds: (context.patient.medications ?? '').split(',').map((s) => s.trim()).filter(Boolean),
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

    let prompt = this.buildExplainPrompt(context, alert, agentProposals, subgraph, {
      topFeatures: mlTopFeatures,
      ruleEngine: mlRuleEngine,
      caregiverBlock: mlCaregiverBlock,
      rawVitals: mlRawVitals,
      confidenceRatio: mlConfidenceRatio,
    });
    const reserveForGeneration = CONCIERGE_GENERATION_EXPLAIN.maxTokens > 0
      ? CONCIERGE_GENERATION_EXPLAIN.maxTokens
      : 2048; // unlimited generation — reserve a generous budget
    prompt = this.truncateToTokenBudget(prompt, 4096 - reserveForGeneration);

    const turnId = `turn-${Date.now()}`;

    this.addTrace({ agent: 'orchestrator', thought: 'Acquiring SLM lease for explain_alert.' });
    const lease = await this.slmTasks.acquire('explain_alert');

    let slmResult;
    try {
      this.addTrace({ agent: 'orchestrator', thought: 'Selecting skill: explain-anomaly for alert-explain flow.' });
      const activeSkill = 'explain-anomaly' as SkillId;
      this.addTrace({ agent: 'orchestrator', thought: 'Calling SLM with RAG context, skill prompt, and skill-filtered tool schemas.' });
      slmResult = await this.slm.chat(
        [
          { role: 'system', content: this.buildSystemPrompt(context, activeSkill) },
          { role: 'user', content: prompt },
        ],
        () => {},
        new AbortController().signal,
        { ...CONCIERGE_GENERATION_EXPLAIN, reasoningFormat: REASONING_FORMAT_EXPLAIN },
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
      payloadJson: JSON.stringify({ turnId, prompt }),
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

    const maxChars = maxTokens * 4;
    const truncated = prompt.slice(0, maxChars);
    const lastNewline = truncated.lastIndexOf('\n');
    const result = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
    this.addTrace({
      agent: 'orchestrator',
      thought: `Prompt truncated from ~${approxTokens} to ~${Math.ceil(result.length / 4)} tokens.`,
    });
    return result + '\n\n[Context truncated to fit model context window.]';
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

  async executeHypotheticalEval(
    action: { tool: string; args: Record<string, unknown>; rationale: string },
    patientId: string,
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

    const mlResult = await this.alertMlService.runDecisionLayer(input);
    const evalBlock = mlResult ? this.formatMlEvalForPrompt(mlResult) : '';
    this.addTrace({
      agent: 'orchestrator',
      thought: `Ran hypothetical ML eval: severity=${mlResult?.finalDecision.final_severity}, aeScore=${mlResult?.aeScore?.toFixed(2)}.`,
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
    return [
      'ML_HYPOTHETICAL_EVAL (the Health Monitor decision on the vitals you asked to test)',
      `Anomaly score: ${r.aeScore !== null ? r.aeScore.toFixed(3) : 'n/a'} (threshold ${r.threshold.toFixed(3)})`,
      `Is anomaly: ${r.isAnomaly}. Emergency: ${r.emergencyResult.emergency} (severity ${r.emergencyResult.severity}).`,
      `Initial classification: ${r.initialAnomalyType.replace(/_/g, ' ').toLowerCase()}.`,
      `Final notification: ${r.finalDecision.final_notification_type.replace(/_/g, ' ').toLowerCase()} (severity ${r.finalDecision.final_severity}).`,
      r.topFeatureEvidence.slice(0, 3).map((f) => `  - ${f.feature}: ${f.importance.toFixed(2)}`).join('\n'),
      'Ground your next answer in this ML output. The ML verdict is authoritative; you contextualize it.',
    ].filter(Boolean).join('\n');
  }
}
