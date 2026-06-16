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
  insertSlmTurn,
  type Alert,
  type CaregiverAction,
  type HealthSample,
  type SlmTurn,
} from '@/data';
import type { InferenceProvider } from '@/inference/inference-provider';
import type { FusedRetriever } from '@/knowledge';
import { audit, auditAlertCreated, auditCaregiverAction, auditSampleRead, auditSlmTurn } from '@/services/audit/auditService';
import { checkEgressConsent } from '@/services/consent/consentGate';
import type { AlertMlModel } from '@/ml-models/alert-autoencoder';
import { AlertMlService } from '@/services/ml/alert-ml-service';

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

export type OrchestratorConfig = {
  slm: InferenceProvider;
  retriever: FusedRetriever;
  alertMl?: AlertMlModel;
  bus?: EventBus;
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

export class Orchestrator {
  private slm: InferenceProvider;
  private retriever: FusedRetriever;
  private client: InProcessMcpClient;
  private cep: CepEngine;
  private alertMlService?: AlertMlService;
  private graphProjector = new GraphProjector();
  private unsubscribe?: () => void;
  private trace: TraceStep[] = [];
  private agents: Agent[];
  private safetyReviewer = new SafetyReviewerAgent();

  constructor(config: OrchestratorConfig) {
    this.slm = config.slm;
    this.retriever = config.retriever;
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
      source: 'mock',
      type: event.sampleType as HealthSample['type'],
      value: event.value,
      unit: event.unit,
      recordedAt: event.recordedAt,
      receivedAt: new Date().toISOString(),
    };
    insertHealthSample(sample);
    writeSampleEdges(event.patientId, event.sampleId, event.sampleType as HealthSample['type']);
    auditSampleRead(event.patientId, event.sampleId, 'system');

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
    if (this.alertMlService) {
      try {
        await this.alertMlService.evaluate(event.patientId, event);
      } catch (err) {
        console.error('[Orchestrator] Alert ML evaluation failed:', err);
      }
    }
  }

  private async handleMlAlert(event: Extract<OrchestrationEvent, { type: 'ml_alert_created' }>): Promise<void> {
    const alert: Alert = {
      alertId: event.alertId,
      patientId: event.patientId,
      severity: event.severity,
      status: 'open',
      title: `ML anomaly detected (score ${formatScore(event.score)})`,
      body: `Alert ML flagged an anomaly based on recent vitals.`,
      mlScore: event.score,
      mlFeaturesJson: JSON.stringify(event.features),
      createdAt: event.at,
    };
    insertAlert(alert);
    auditAlertCreated(event.patientId, alert.alertId, {
      mlScore: event.score,
      severity: event.severity,
      features: event.features,
    });

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
  }

  /**
   * Multi-agent fan-out.
   *
   * Runs patient-state, caregiver, and coordinator agents in parallel,
   * collects proposals, enforces the safety-reviewer verdict, applies the
   * consent gate to egress-bearing actions, and executes allowed actions.
   */
  private async fanOutAndExecute(ctx: Omit<AgentContext, 'aggregatedContext'>): Promise<AgentProposalInternal[]> {
    const aggregatedContext = await buildAggregatedContext(ctx.patientId, ctx.intent, this.retriever);
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

    // Fan out agents first to collect proposed actions and safety notes.
    const agentProposals = await this.fanOutAndExecute({
      patientId,
      intent,
      alertId,
      caregiverId,
    });

    this.addTrace({ agent: 'orchestrator', thought: 'Building aggregated context for SLM explain.' });
    const context = await buildAggregatedContext(patientId, intent, this.retriever);

    this.addTrace({ agent: 'orchestrator', thought: 'Building knowledge-graph context subgraph.' });
    const graph = this.graphProjector.build(patientId);
    const subgraph = buildContextSubgraph(graph, patientId, alertId);

    const prompt = this.buildExplainPrompt(context, alert, agentProposals, subgraph);
    const turnId = `turn-${Date.now()}`;

    this.addTrace({ agent: 'orchestrator', thought: 'Calling SLM with RAG context and tool schemas.' });
    const slmResult = await this.slm.chat(
      [
        { role: 'system', content: this.buildSystemPrompt(context) },
        { role: 'user', content: prompt },
      ],
      () => {},
      new AbortController().signal,
    );

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
    auditSlmTurn(patientId, turnId, { alertId, latencyMs: slmResult.latencyMs });

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

  private buildSystemPrompt(context: AggregatedContext): string {
    const thresholdBlock = context.activeThresholds
      .map(
        (t) =>
          `- ${t.vitalType} ${t.direction} ${t.value} (severity ${t.severity})`,
      )
      .join('\n');

    const vitalsBlock = Object.entries(context.recentVitals)
      .map(([type, info]) => `- ${type}: latest ${info.latest} ${info.unit} (${info.samples} samples in 24h)`)
      .join('\n');

    const citationBlock = context.retrieval.chunks
      .map((c) => `[${c.docId}] ${c.text}`)
      .join('\n');

    const toolBlock = TOOL_SCHEMAS
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');

    return [
      'You are a caregiver-support assistant inside a mobile health app.',
      'Your job is to help a non-clinical family caregiver understand a health alert and decide on safe next steps.',
      '',
      'RULES',
      '- Never diagnose. Never give definitive clinical instructions.',
      '- Always defer clinical decisions to the care team or emergency services when red flags are present.',
      '- Ground every clinical claim in the provided citations. Cite docId in brackets like [OE-copd-spo2-cutoff].',
      '- If you need more information, ask ONE multiple-choice clarifying question. Provide 2–4 options.',
      '- Do not ask open-ended questions.',
      '- Keep answers to ~120–250 words. Lead with the bottom line, then numbered steps, then red flags.',
      '',
      'PATIENT CONTEXT',
      `Name: ${context.patient.name}`,
      `Age: ${context.patient.age ?? 'unknown'}`,
      `Conditions: ${context.patient.conditions.join(', ') || 'none documented'}`,
      `Medications: ${context.patient.medications ?? 'none documented'}`,
      `SpO2 cutoff: ${context.patient.spo2Cutoff ?? 'not set'}`,
      '',
      'ACTIVE THRESHOLDS',
      thresholdBlock || 'None configured',
      '',
      'RECENT VITALS (24h)',
      vitalsBlock || 'No recent vitals',
      '',
      'CITATIONS',
      citationBlock || 'No citations retrieved',
      '',
      'AVAILABLE TOOLS',
      toolBlock,
      '',
      'If you want the caregiver to use a tool, include a line like:',
      'ACTION: tool_name({"arg":"value"})',
    ].join('\n');
  }

  private buildExplainPrompt(
    context: AggregatedContext,
    alert: Alert,
    agentProposals: AgentProposalInternal[],
    subgraph: import('@/knowledge/graph').ContextSubgraph,
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

    return [
      `Alert: ${alert.title}`,
      `Severity: ${alert.severity}`,
      typeof alert.mlScore === 'number' ? `ML anomaly score: ${formatScore(alert.mlScore)}` : '',
      '',
      'Agent safety notes:',
      agentNotes || 'None',
      '',
      'Recent graph-derived vitals:',
      graphVitals || 'No recent samples',
      '',
      'Active thresholds from care graph:',
      graphThresholds || 'None',
      '',
      'Active medications from care graph:',
      graphMeds || 'None documented',
      '',
      'Explain what this alert means for this specific patient, what the caregiver should do now,',
      'and what red flags would require calling emergency services.',
      'If the information is insufficient, ask ONE multiple-choice clarifying question.',
    ].join('\n');
  }

  private parseProposal(text: string, _context: AggregatedContext, alertId: string): AgentProposal {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const actionLines = lines.filter((l) => l.startsWith('ACTION:'));
    const questionMatch = text.match(/QUESTION:\s*(.+?)\nOPTIONS:\s*([\s\S]+?)(?:\n\n|\nACTION:|$)/i);

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

    return {
      message: text.replace(/ACTION:.*\n?/g, '').replace(/QUESTION:.*OPTIONS:[\s\S]*?\n\n/g, '').trim(),
      citations: [],
      proposedActions,
      clarifyingQuestion,
      safety: { ok: true, notes: [] },
      trace: [],
    };
  }
}
