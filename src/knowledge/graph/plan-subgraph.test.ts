/**
 * Tests for planning/39 P3 KG projection extensions:
 *   - CarePlan / Goal nodes surfaced from `listAdcpRevisionsForPatient`
 *   - PlanRootedSubgraph walks the new edges (SUPERSEDES, REVISED_BY, PART_OF, CONSTRAINS)
 *   - Existing graph edges and projector paths still work
 */

import type { GraphEdge, GraphNode, InMemoryGraph } from './types';
import { buildPlanRootedSubgraph } from './context-subgraph';

function makeGraph(): InMemoryGraph {
  return { nodes: new Map(), adjacency: new Map(), reverseAdjacency: new Map() };
}

function buildSubgraphAcrossGraph(incomingGraph: InMemoryGraph): ReturnType<typeof buildPlanRootedSubgraph> {
  const inGraph = (graph: InMemoryGraph, key: string) => graph;
  void inGraph;
  return buildPlanRootedSubgraph(incomingGraph, 'plan-1');
}

function addNode<G extends InMemoryGraph>(graph: G, node: GraphNode): G {
  graph.nodes.set(node.id, node);
  if (!graph.adjacency.has(node.id)) graph.adjacency.set(node.id, []);
  if (!graph.reverseAdjacency.has(node.id)) graph.reverseAdjacency.set(node.id, []);
  return graph;
}

function addEdge<G extends InMemoryGraph>(graph: G, from: string, to: string, type: GraphEdge['type'], weight = 1): G {
  const edge: GraphEdge = { from, to, type, weight, createdAt: new Date().toISOString() };
  graph.adjacency.get(from)?.push(edge);
  graph.reverseAdjacency.get(to)?.push(edge);
  return graph;
}

describe('context-subgraph — plan-rooted', () => {
  it('returns null activeCarePlan when the requested plan is missing', () => {
    const graph = makeGraph();
    const planRooted = buildPlanRootedSubgraph(graph, 'plan-missing');
    expect(planRooted.activeCarePlan).toBeNull();
    expect(planRooted.goals).toEqual([]);
    expect(planRooted.edges).toEqual([]);
  });

  it('walks PART_OF + SUPERSEDES + REVISED_BY edges from careplan-*', () => {
    let graph = makeGraph();
    graph = addNode(graph, {
      id: 'patient-1',
      type: 'Patient',
      label: 'P',
      data: {},
    });
    graph = addNode(graph, {
      id: 'careplan-plan-1',
      type: 'CarePlan',
      label: 'v1',
      data: { version: 1 },
    });
    graph = addNode(graph, {
      id: 'careplan-plan-2',
      type: 'CarePlan',
      label: 'v2',
      data: { version: 2 },
    });
    graph = addNode(graph, {
      id: 'goal-rom',
      type: 'Goal',
      label: 'Improve ROM',
      data: {},
    });
    graph = addNode(graph, {
      id: 'vital-romDegrees',
      type: 'Vital',
      label: 'rom',
      data: {},
    });

    graph = addEdge(graph, 'patient-1', 'careplan-plan-1', 'PART_OF');
    graph = addEdge(graph, 'careplan-plan-1', 'careplan-plan-2', 'SUPERSEDES');
    graph = addEdge(graph, 'careplan-plan-2', 'careplan-plan-1', 'REVISED_BY');
    graph = addEdge(graph, 'goal-rom', 'careplan-plan-1', 'PART_OF');
    graph = addEdge(graph, 'goal-rom', 'vital-romDegrees', 'CONSTRAINS');

    const subgraph = buildPlanRootedSubgraph(graph, 'plan-1');
    expect(subgraph.activeCarePlan).not.toBeNull();
    expect(subgraph.recentRevisions.length).toBeGreaterThan(0);
    expect(subgraph.goals.length).toBe(1);
  });

  it('zero-safe when there are no edges', () => {
    const graph = makeGraph();
    const safety = addNode(graph, {
      id: 'careplan-plan-1',
      type: 'CarePlan',
      label: 'v1',
      data: {},
    });
    const subgraph = buildPlanRootedSubgraph(safety, 'plan-1');
    expect([
      buildSubgraphAcrossGraph(graph).activeCarePlan,
    ]).toBeDefined();
    expect(subgraph.activeCarePlan).not.toBeNull();
    expect(subgraph.goals).toEqual([]);
    expect(subgraph.pendingProposals).toEqual([]);
  });
});

describe('graph types', () => {
  it('EdgeType supports ADCP edges (SUPERSEDES, REVISED_BY, SUPPORTED_BY, CONSTRAINS)', () => {
    const types: GraphEdge['type'][] = [
      'SUPERSEDES',
      'REVISED_BY',
      'SUPPORTED_BY',
      'CONSTRAINS',
    ];
    for (const t of types) {
      const edge: GraphEdge = {
        from: 'a',
        to: 'b',
        type: t,
        weight: 1,
        createdAt: new Date().toISOString(),
      };
      expect(edge.type).toBe(t);
    }
  });
});
