/**
 * Caregiver Agent.
 *
 * Interprets caregiver intent and proposes dialogue / clarification actions.
 * In v1 it is deterministic; future versions may use a small SLM for intent
 * parsing.
 */

import { getCaregiverForPatient } from '@/data';

import type { Agent, AgentContext, AgentProposalInternal } from './agent-types';

export class CaregiverAgent implements Agent {
  readonly name = 'caregiver-agent';

  async propose(context: AgentContext): Promise<AgentProposalInternal> {
    const caregiver = getCaregiverForPatient(context.patientId);
    const intent = context.intent.toLowerCase();

    const actions: AgentProposalInternal['proposedActions'] = [];
    if (intent.includes('explain')) {
      actions.push({
        tool: 'ask_clarifying_question',
        args: {
          alertId: context.alertId,
          question: 'What is your main concern right now?',
          options: JSON.stringify(['Breathing', 'Color/alertness', 'Pain', 'Other']),
        },
        rationale: 'Gather caregiver concern before finalizing explanation.',
      });
    }

    return {
      agent: this.name,
      message: caregiver
        ? `Caregiver ${caregiver.name} (${caregiver.relationship}) is interacting with the app. Main concern: ${caregiver.mainConcern ?? 'not recorded'}.`
        : 'No caregiver profile found.',
      proposedActions: actions,
      citations: [],
      safetyNotes: [],
    };
  }
}
