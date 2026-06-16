/**
 * Orchestrator.
 *
 * The single chokepoint between the app's services and the AI layers (SLM,
 * RAG, Alert ML). It:
 *
 *   1. Receives events from the event bus.
 *   2. Runs the CEP engine.
 *   3. Uses the MCP client to call agents deterministically.
 *   4. Decides when to invoke the SLM (only after caregiver ground truth, or
 *      on-demand for "Explain").
 *   5. Surfaces a transparency trace and citations for every AI action.
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

import { createAllAgents } from './agents';
import { createDefaultCepEngine, type CepEngine } from './cep';
import { getEventBus, type EventBus } from './event-bus';
import type { OrchestrationEvent } from './events';
import { buildAggregatedContext, type AggregatedContext } from './context-aggregator';
import {
  createInProcessMcp,
  type InProcessMcpClient,
} from './mcp/mcp-in-process';
import { TOOL_SCHEMAS } from './mcp/tool-registry';

export type OrchestratorConfig = {
  slm: InferenceProvider;
  retriever: FusedRetriever;
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

export class Orchestrator {
  private slm: InferenceProvider;
  private retriever: FusedRetriever;
  private client: InProcessMcpClient;
  private cep: CepEngine;
  private unsubscribe?: () => void;
  private trace: TraceStep[] = [];

  constructor(config: OrchestratorConfig) {
    this.slm = config.slm;
    this.retriever = config.retriever;
    const { client } = createInProcessMcp({ tools: createAllAgents() });
    this.client = client;
    this.cep = createDefaultCepEngine();
    this.unsubscribe = (config.bus ?? getEventBus()).subscribe(
      'vitals_sample',
      (event) => {
        if (event.type === 'vitals_sample') {
          void this.handleVitalsSample(event);
        }
      },
    );
  }

  dispose(): void {
    this.unsubscribe?.();
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

    const cepAction = this.cep.ingest(event);
    if (cepAction?.type === 'drop') return;

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

    await this.client.callTool('dispatch_alert_notification', {
      alertId: alert.alertId,
      bypassDnd: true,
    });

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

    this.addTrace({ agent: 'orchestrator', thought: 'Building aggregated context for SLM explain.' });
    const context = await buildAggregatedContext(patientId, intent, this.retriever);

    const prompt = this.buildExplainPrompt(context, alert);
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
      createdAt: new Date().toISOString(),
    };
    insertSlmTurn(turn, citations);

    insertCaregiverAction({
      actionId: `act-${Date.now()}`,
      alertId,
      patientId,
      caregiverId,
      type: 'ask_slm',
      payloadJson: JSON.stringify({ turnId, prompt }),
      createdAt: new Date().toISOString(),
    });

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

  private buildExplainPrompt(context: AggregatedContext, alert: Alert): string {
    return [
      `Alert: ${alert.title}`,
      `Severity: ${alert.severity}`,
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
