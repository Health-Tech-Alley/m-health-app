/**
 * Agent types for L4 multi-agent orchestration.
 *
 * Each agent receives a context snapshot assembled by the orchestrator and
 * returns a proposal. The orchestrator is the single chokepoint: it mediates
 * all dataflow into and out of agents, enforces the safety-reviewer verdict,
 * and decides which proposed actions to execute.
 */

import type { AggregatedContext } from '../context-aggregator';

export type AgentContext = {
  patientId: string;
  intent: string;
  alertId?: string;
  caregiverId?: string;
  aggregatedContext: AggregatedContext;
};

export type ProposedAction = {
  tool: string;
  args: Record<string, unknown>;
  rationale: string;
  requiresConsent?: boolean;
};

export type AgentProposalInternal = {
  agent: string;
  message: string;
  proposedActions: ProposedAction[];
  citations: string[];
  safetyNotes: string[];
  clarifyingQuestion?: {
    questionId: string;
    question: string;
    options: string[];
  };
};

export interface Agent {
  readonly name: string;
  propose(context: AgentContext): Promise<AgentProposalInternal>;
}
