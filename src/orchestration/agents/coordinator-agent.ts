/**
 * Coordinator Agent.
 *
 * Assembles care-plan actions: notifications, escalations, and (when consented)
 * record shares. It reads the current alert and thresholds to decide dispatch.
 */

import { getAlertById, getOpenAlerts } from '@/data';

import type { Agent, AgentContext, AgentProposalInternal } from './agent-types';

export class CoordinatorAgent implements Agent {
  readonly name = 'coordinator-agent';

  async propose(context: AgentContext): Promise<AgentProposalInternal> {
    const alerts = getOpenAlerts(context.patientId);
    const alert = context.alertId ? getAlertById(context.alertId) : alerts[0];
    const actions: AgentProposalInternal['proposedActions'] = [];
    const safetyNotes: string[] = [];

    if (alert) {
      if (alert.severity === 3) {
        actions.push({
          tool: 'dispatch_alert_notification',
          args: { alertId: alert.alertId, bypassDnd: true },
          rationale: 'Severity-3 alert requires immediate notification.',
        });
        safetyNotes.push('Severity-3 alert: caregiver must confirm human-directed action; no auto-911.');
      } else if (alert.severity === 2) {
        actions.push({
          tool: 'dispatch_alert_notification',
          args: { alertId: alert.alertId, bypassDnd: false },
          rationale: 'Severity-2 alert should surface as a non-bypass notification.',
        });
      }

      actions.push({
        tool: 'log_observation',
        args: { alertId: alert.alertId, observation: 'Coordinator proposed actions for review.', caregiverId: context.caregiverId, patientId: context.patientId },
        rationale: 'Record that the coordinator reviewed the alert.',
      });
    }

    return {
      agent: this.name,
      message: alert
        ? `Coordinator reviewed alert ${alert.alertId} (severity ${alert.severity}).`
        : 'No open alert to coordinate.',
      proposedActions: actions,
      citations: [],
      safetyNotes,
    };
  }
}
