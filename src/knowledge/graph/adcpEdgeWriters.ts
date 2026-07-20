/**
 * ADCP edge writers (planning/39 §9, planning/24 gaps).
 *
 * Project-on-write: every time the ADCP repository publishes a revision /
 * resolves a proposal / changes a goal, the corresponding graph edges (and
 * nodes) are upserted to `graph_edges`. Care Concierge's plan-rooted subgraph
 * reads these edges without parsing the full ADCP document.
 *
 * Safe to call from anywhere after a SQLite write — failures are logged but
 * never block the application write (KG is a derived index, not source).
 */

import { writeGraphEdge } from './edge-writers';
import type { GraphEdge } from './types';

export function writeCarePlanRevisionEdges(
  patientId: string,
  params: {
    revisionId: string;
    planId: string;
    version: number;
    supersedesPlanId?: string | null;
    source: string;
    publishedBy: string;
    goalIds?: string[];
  },
): GraphEdge[] {
  const newEdges: GraphEdge[] = [];
  // Patient → CarePlan
  newEdges.push(
    writeGraphEdge({
      from: `patient-${patientId}`,
      to: `careplan-${params.planId}`,
      type: 'PART_OF',
      weight: 1.0,
    }),
  );
  // supersedes chain
  if (params.supersedesPlanId) {
    newEdges.push(
      writeGraphEdge({
        from: `careplan-${params.planId}`,
        to: `careplan-${params.supersedesPlanId}`,
        type: 'SUPERSEDES',
        weight: 1.0,
      }),
      writeGraphEdge({
        from: `careplan-${params.supersedesPlanId}`,
        to: `careplan-${params.planId}`,
        type: 'REVISED_BY',
        weight: 1.0,
      }),
    );
  }
  // CarePlan → Goal
  for (const goalId of params.goalIds ?? []) {
    newEdges.push(
      writeGraphEdge({
        from: `goal-${goalId}`,
        to: `careplan-${params.planId}`,
        type: 'PART_OF',
        weight: 0.7,
      }),
    );
  }
  return newEdges;
}

export function writeGoalEdges(
  patientId: string,
  goalId: string,
  metricKey: string | null,
): GraphEdge[] {
  const newEdges: GraphEdge[] = [];
  if (metricKey) {
    newEdges.push(
      writeGraphEdge({
        from: `goal-${goalId}`,
        to: `vital-${metricKey}`,
        type: 'CONSTRAINS',
        weight: 0.6,
      }),
    );
  }
  return newEdges;
}

export function writeTriggerEventEdges(
  patientId: string,
  triggerEventId: string,
  relatedIds: { alertId?: string; proposalId?: string; thresholdId?: string },
): GraphEdge[] {
  const from = `triggerevent-${triggerEventId}`;
  const newEdges: GraphEdge[] = [];
  if (relatedIds.alertId) {
    newEdges.push(
      writeGraphEdge({ from, to: `alert-${relatedIds.alertId}`, type: 'TRIGGERED', weight: 1.0 }),
    );
  }
  if (relatedIds.thresholdId) {
    newEdges.push(
      writeGraphEdge({ from, to: `threshold-${relatedIds.thresholdId}`, type: 'TRIGGERED', weight: 1.0 }),
    );
  }
  if (relatedIds.proposalId) {
    newEdges.push(
      writeGraphEdge({ from, to: `planproposal-${relatedIds.proposalId}`, type: 'INFORMS', weight: 0.8 }),
    );
  }
  return newEdges;
}

export function writeProposalEdges(
  patientId: string,
  proposalId: string,
  params: { intentId: string; section: string; status: string; supersedes?: string | null },
): GraphEdge[] {
  return [
    writeGraphEdge({
      from: `planproposal-${proposalId}`,
      to: `patient-${patientId}`,
      type: 'INFLUENCED',
      weight: 0.7,
    }),
    writeGraphEdge({
      from: `planproposal-${proposalId}`,
      to: `intent-${params.intentId}`,
      type: 'INFORMS',
      weight: 0.6,
    }),
  ];
}
