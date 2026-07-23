/**
 * Safety-Reviewer Agent.
 *
 * Enforces guardrails on agent proposals before the orchestrator executes any
 * action. Returns a verdict: ok, downgrade (reduce urgency), or block.
 */

import type { Agent, AgentContext, AgentProposalInternal } from './agent-types';

export type SafetyVerdict =
  | { status: 'ok' }
  | { status: 'downgrade'; toSeverity: 1 | 2 }
  | { status: 'block'; reason: string };

export class SafetyReviewerAgent implements Agent {
  readonly name = 'safety-reviewer-agent';

  async propose(context: AgentContext): Promise<AgentProposalInternal> {
    // The safety reviewer itself does not propose actions; it reviews others.
    return {
      agent: this.name,
      message: 'Safety reviewer standing by.',
      proposedActions: [],
      citations: [],
      safetyNotes: [],
    };
  }

  review(proposals: AgentProposalInternal[], _context: AgentContext): SafetyVerdict {
    const allNotes = proposals.flatMap((p) => p.safetyNotes);
    const allActions = proposals.flatMap((p) => p.proposedActions);

    // Guardrail: no agent may propose a definitive diagnosis.
    for (const action of allActions) {
      const rationale = action.rationale.toLowerCase();
      if (rationale.includes('diagnose') || rationale.includes('diagnosis')) {
        return { status: 'block', reason: 'Agents must not propose diagnostic actions.' };
      }
    }

    // Guardrail: severity-3 actions must include a human-in-the-loop note.
    const hasSeverity3 = allNotes.some((n) => n.includes('severity-3'));
    const hasHumanLoop = allActions.some((a) =>
      ['ask_clarifying_question', 'log_observation'].includes(a.tool),
    );
    if (hasSeverity3 && !hasHumanLoop) {
      return { status: 'downgrade', toSeverity: 2 };
    }

    return { status: 'ok' };
  }
}
