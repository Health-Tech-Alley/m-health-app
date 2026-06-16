/**
 * Context subgraph builder.
 *
 * Extracts a focused, auditable subgraph for a single SLM call. The SLM never
 * traverses the graph itself; the orchestrator traverses it and presents a
 * flat, cited summary.
 */

import type { InMemoryGraph, ContextSubgraph, GraphNode } from './types';

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

function hasEdge(graph: InMemoryGraph, fromId: string, toId: string, type: string): boolean {
  return (graph.adjacency.get(fromId) ?? []).some((e) => e.to === toId && e.type === type);
}
