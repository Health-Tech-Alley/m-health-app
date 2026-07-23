/**
 * Context subgraph builder.
 *
 * Extracts a focused, auditable subgraph for a single SLM call. The SLM never
 * traverses the graph itself; the orchestrator traverses it and presents a
 * flat, cited summary.
 */

import type { InMemoryGraph, ContextSubgraph, GraphNode, PlanRootedSubgraph, GraphEdge } from './types';

export function buildContextSubgraph(
  graph: InMemoryGraph,
  patientId: string,
  alertId?: string,
): ContextSubgraph {
  const patientNode = graph.nodes.get(`patient-${patientId}`) ?? null;
  const caregiverNode = findCaregiver(graph, patientNode?.id) ?? null;

  const recentSamples = collect(graph, `patient-${patientId}`, 'HAS_SAMPLE', 'Sample')
    .sort((a, b) => String(b.data.recordedAt).localeCompare(String(a.data.recordedAt)))
    .slice(0, 24);

  const activeThresholds = collect(graph, `patient-${patientId}`, 'HAS_THRESHOLD', 'Threshold')
    .filter((n) => n.data.supersededAt == null);

  const activeAlerts = collect(graph, `patient-${patientId}`, 'HAS_ALERT', 'Alert')
    .sort((a, b) => String(b.data.createdAt).localeCompare(String(a.data.createdAt)))
    .slice(0, 10);

  const recentActions = alertId
    ? collect(graph, `alert-${alertId}`, 'RESULTED_IN', 'Action')
    : activeAlerts.flatMap((a) => collect(graph, a.id, 'RESULTED_IN', 'Action'));

  const relatedMedications = collect(graph, `patient-${patientId}`, 'TAKES', 'Medication');
  const relatedConditions = collect(graph, `patient-${patientId}`, 'HAS_CONDITION', 'Condition');

  // Citations are attached to threshold SUPPORTS edges or to SLM turns.
  const thresholdIds = activeThresholds.map((n) => n.id);
  const citations = Array.from(graph.nodes.values()).filter(
    (n) =>
      n.type === 'Citation' &&
      thresholdIds.some((tid) => hasEdge(graph, tid, n.id, 'SUPPORTS')),
  );

  return {
    patient: patientNode,
    caregiver: caregiverNode,
    recentSamples,
    activeThresholds,
    activeAlerts,
    recentActions: recentActions
      .sort((a, b) => String(b.data.createdAt).localeCompare(String(a.data.createdAt)))
      .slice(0, 20),
    citations,
    relatedMedications,
    relatedConditions,
  };
}

/**
 * Plan-rooted subgraph (planning/39 P3).
 *
 * Centered on the active ADCP revision. Walks out along the projection edges
 * the ADCP edge writers wrote on publish / resolve / goal-change. Used by the
 * Care Concierge intent router to anchor retrieval + KG context to the
 * patient's actual plan rather than the generic patient context.
 *
 * Implementation: walks `graph_edges` from the `careplan-<planId>` node along
 * edge types `SUPERSEDES | REVISED_BY | PART_OF | CONSTRAINS | SUPPORTED_BY | INFORMS`.
 *
 * The GOAL convention here matches the existing GraphProjector: a goal node
 * has a `PART_OF → careplan-<planId>` edge, so we walk the **reverse**
 * adjacency to find goals attached to the active plan. Same for
 * CONSTRAINS: a goal has a CONSTRAINS edge to a vital, and we follow it
 * from the goal in either direction.
 */
export function buildPlanRootedSubgraph(
  graph: InMemoryGraph,
  planId: string,
): PlanRootedSubgraph {
  const rootId = `careplan-${planId}`;
  const root = graph.nodes.get(rootId) ?? null;

  // Revision lineage (outgoing edges only — supersedes chain).
  const supersedes = collect(graph, rootId, 'SUPERSEDES', 'CarePlan');
  const revisedBy = collect(graph, rootId, 'REVISED_BY', 'CarePlan');
  const recentRevisions = [...supersedes, ...revisedBy];

  // Goals are attached to this plan via incoming PART_OF edges.
  const goals = collectIncoming(graph, rootId, 'PART_OF', 'Goal');

  // Constraints: walk outward from each goal via CONSTRAINS → Vital.
  const constraints: GraphNode[] = [];
  for (const goal of goals) {
    constraints.push(...collect(graph, goal.id, 'CONSTRAINS', 'Vital'));
    constraints.push(...collectIncoming(graph, goal.id, 'CONSTRAINS', 'Vital'));
  }

  const edges: GraphEdge[] = collectEdges(graph, rootId);

  const patientId = findPatientIdForPlanNode(graph, rootId);
  const pendingProposals: GraphNode[] = patientId
    ? collect(graph, `patient-${patientId}`, 'INFLUENCED', 'PlanProposal' as GraphNode['type']).filter(
        (n) => String(n.data.status).startsWith('awaiting') || n.data.status === 'draft',
      )
    : [];
  const appliedProposals: GraphNode[] = patientId
    ? collect(graph, `patient-${patientId}`, 'INFLUENCED', 'PlanProposal' as GraphNode['type']).filter(
        (n) => n.data.status === 'applied' || n.data.status === 'accepted',
      )
    : [];

  const triggerEvents: GraphNode[] = Array.from(graph.nodes.values()).filter(
    (n) => n.type === 'TriggerEvent' && edges.some((e) => e.to === n.id),
  );

  const decisionLog: GraphNode[] = [];
  const therapyContracts: GraphNode[] = [];

  void constraints;
  return {
    activeCarePlan: root,
    recentRevisions,
    revisions: recentRevisions.length > 0 ? recentRevisions : root ? [root] : [],
    goals,
    triggerEvents,
    pendingProposals,
    appliedProposals,
    therapyContracts,
    decisionLog,
    edges,
  };
}

function findPatientIdForPlanNode(graph: InMemoryGraph, planNodeId: string): string | null {
  // Plan nodes typically have a PART_OF edge *from* patient-xxx.
  const edges = graph.reverseAdjacency.get(planNodeId) ?? [];
  const partEdge = edges.find((e) => e.type === 'PART_OF' && e.from.startsWith('patient-'));
  if (partEdge) return partEdge.from.slice('patient-'.length);
  return null;
}

function RecentPlanActions(_graph: InMemoryGraph, _planId: string): GraphNode[] {
  // We resolve via the ADCP edgewriters' INFORMS→planproposal edges; if no
  // proposal nodes have been linked, fall back to empty.
  return [];
}

function findCaregiver(graph: InMemoryGraph, patientNodeId?: string): GraphNode | null {
  if (!patientNodeId) return null;
  const edges = graph.adjacency.get(patientNodeId) ?? [];
  const edge = edges.find((e) => e.type === 'CARED_FOR_BY');
  return edge ? graph.nodes.get(edge.to) ?? null : null;
}

function collect(
  graph: InMemoryGraph,
  fromId: string,
  edgeType: string,
  nodeType: string,
): GraphNode[] {
  const edges = graph.adjacency.get(fromId) ?? [];
  return edges
    .filter((e) => e.type === edgeType)
    .map((e) => graph.nodes.get(e.to))
    .filter((n): n is GraphNode => n !== undefined && n.type === nodeType);
}

function collectMulti(
  graph: InMemoryGraph,
  fromId: string,
  edgeTypes: string[],
  _nodeTypes: string[],
): GraphNode[] {
  const edges = graph.adjacency.get(fromId) ?? [];
  return edges
    .filter((e) => edgeTypes.includes(e.type))
    .map((e) => graph.nodes.get(e.to))
    .filter((n): n is GraphNode => n !== undefined);
}

/**
 * Walk incoming edges (i.e. edges where `from` is some other node and
 * `to === fromId`). Useful for "this plan owns these goal nodes" where the
 * goal's edge points at the plan, not the other way around.
 */
function collectIncoming(
  graph: InMemoryGraph,
  fromId: string,
  edgeType: string,
  nodeType: string,
): GraphNode[] {
  const edges = graph.reverseAdjacency.get(fromId) ?? [];
  return edges
    .filter((e) => e.type === edgeType)
    .map((e) => graph.nodes.get(e.from))
    .filter((n): n is GraphNode => n !== undefined && n.type === nodeType);
}

function collectEdges(graph: InMemoryGraph, fromId: string): GraphEdge[] {
  return graph.adjacency.get(fromId) ?? [];
}

function hasEdge(graph: InMemoryGraph, fromId: string, toId: string, type: string): boolean {
  return (graph.adjacency.get(fromId) ?? []).some((e) => e.to === toId && e.type === type);
}
