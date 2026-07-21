/**
 * Knowledge graph types.
 *
 * Derived, read-only view over the authoritative SQLite tables. Nodes and edges
 * are kept in memory for fast traversal; persistence is SQLite.
 */

export type NodeType =
  | 'Patient'
  | 'Caregiver'
  | 'Provider'
  | 'Condition'
  | 'Medication'
  | 'Vital'
  | 'Sample'
  | 'Threshold'
  | 'Alert'
  | 'Action'
  | 'Citation'
  | 'SLMTurn'
  | 'CarePlan'
  | 'Goal'
  | 'TriggerEvent';

export type GraphNode = {
  id: string;
  type: NodeType;
  label: string;
  data: Record<string, unknown>;
};

export type EdgeType =
  | 'HAS_CONDITION'
  | 'TAKES'
  | 'CARED_FOR_BY'
  | 'HAS_PROVIDER'
  | 'HAS_THRESHOLD'
  | 'HAS_SAMPLE'
  | 'TRIGGERED'
  | 'HAS_ALERT'
  | 'RESPONDS_TO'
  | 'RESULTED_IN'
  | 'CITES'
  | 'SUPPORTS'
  | 'INFORMS'
  | 'PART_OF'
  | 'INFLUENCED'
  | 'SIMILAR_TO'
  | 'PRECEDED'
  // ADCP (planning/39 §9 planning/24 gaps)
  | 'SUPERSEDES'
  | 'REVISED_BY'
  | 'SUPPORTED_BY'
  | 'CONSTRAINS';

export type GraphEdge = {
  from: string;
  to: string;
  type: EdgeType;
  weight: number;
  createdAt: string;
};

export type InMemoryGraph = {
  nodes: Map<string, GraphNode>;
  adjacency: Map<string, GraphEdge[]>;
  reverseAdjacency: Map<string, GraphEdge[]>;
};

export type ContextSubgraph = {
  patient: GraphNode | null;
  caregiver: GraphNode | null;
  recentSamples: GraphNode[];
  activeThresholds: GraphNode[];
  activeAlerts: GraphNode[];
  recentActions: GraphNode[];
  citations: GraphNode[];
  relatedMedications: GraphNode[];
  relatedConditions: GraphNode[];
};

/**
 * Plan-rooted subgraph (planning/39 §9 P3) — used by Care Concierge intents
 * to anchor RAG / KG context on the active ADCP revision.
 */
export type PlanRootedSubgraph = {
  activeCarePlan: GraphNode | null;
  recentRevisions: GraphNode[];
  revisions: GraphNode[];
  goals: GraphNode[];
  triggerEvents: GraphNode[];
  pendingProposals: GraphNode[];
  appliedProposals: GraphNode[];
  therapyContracts: GraphNode[];
  decisionLog: GraphNode[];
  edges: GraphEdge[];
};
