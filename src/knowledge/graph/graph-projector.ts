/**
 * Graph projector.
 *
 * Builds an in-memory adjacency-list graph from the authoritative SQLite
 * tables. Only the last 90 days of dynamic data are loaded by default;
 * reference data (patients, meds, conditions) is loaded fully.
 *
 * ADCP (planning/39 P3): also projects CarePlan + Goal nodes from the
 * `care_plan_revisions` table so the plan-rooted subgraph has something to
 * anchor on after the first ADCP revision is seeded.
 */

import {
  getActiveAlerts,
  getActiveThresholds,
  getActiveMedications,
  getConditionsForPatient,
  getPatient,
  getCaregiverForPatient,
  getRecentHealthSamples,
  getActionsForAlert,
  listAdcpRevisionsForPatient,
  getDatabase,
  type HealthSampleType,
} from '@/data';

import type { GraphEdge, GraphNode, InMemoryGraph } from './types';

const DEFAULT_WINDOW_DAYS = 90;

function node(id: string, type: GraphNode['type'], label: string, data: Record<string, unknown>): GraphNode {
  return { id, type, label, data };
}

function edge(from: string, to: string, type: GraphEdge['type'], weight = 1.0): GraphEdge {
  return { from, to, type, weight, createdAt: new Date().toISOString() };
}

export class GraphProjector {
  private graph: InMemoryGraph = {
    nodes: new Map(),
    adjacency: new Map(),
    reverseAdjacency: new Map(),
  };

  build(patientId: string, windowDays = DEFAULT_WINDOW_DAYS): InMemoryGraph {
    this.graph = { nodes: new Map(), adjacency: new Map(), reverseAdjacency: new Map() };

    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    // Reference nodes
    const patient = getPatient(patientId);
    if (patient) {
      this.addNode(node(`patient-${patientId}`, 'Patient', patient.name, { ...patient }));
    }

    const caregiver = getCaregiverForPatient(patientId);
    if (caregiver) {
      this.addNode(node(`caregiver-${caregiver.caregiverId}`, 'Caregiver', caregiver.name, { ...caregiver }));
      this.addEdge(`patient-${patientId}`, `caregiver-${caregiver.caregiverId}`, 'CARED_FOR_BY');
    }

    const conditions = getConditionsForPatient(patientId);
    for (const c of conditions) {
      this.addNode(node(`condition-${c.conditionId}`, 'Condition', c.name, { ...c }));
      this.addEdge(`patient-${patientId}`, `condition-${c.conditionId}`, 'HAS_CONDITION');
    }

    const medications = getActiveMedications(patientId);
    for (const m of medications) {
      this.addNode(node(`med-${m.medicationId}`, 'Medication', m.name, { ...m }));
      this.addEdge(`patient-${patientId}`, `med-${m.medicationId}`, 'TAKES');
    }

    // Vital reference nodes
    const vitalTypes: HealthSampleType[] = [
      'spo2', 'heart_rate', 'respiratory_rate', 'blood_pressure_systolic',
      'blood_pressure_diastolic', 'temperature', 'blood_glucose', 'steps',
      'distance', 'flights_climbed', 'sleep', 'coughing',
    ];
    for (const type of vitalTypes) {
      this.addNode(node(`vital-${type}`, 'Vital', type, { type }));
    }

    // Thresholds
    const thresholds = getActiveThresholds(patientId);
    for (const t of thresholds) {
      this.addNode(node(`threshold-${t.thresholdId}`, 'Threshold', `${t.vitalType} ${t.direction} ${t.value}`, { ...t }));
      this.addEdge(`patient-${patientId}`, `threshold-${t.thresholdId}`, 'HAS_THRESHOLD');
      this.addEdge(`vital-${t.vitalType}`, `threshold-${t.thresholdId}`, 'HAS_THRESHOLD');
    }

    // Recent samples
    const sampleNodes: GraphNode[] = [];
    for (const type of vitalTypes) {
      const samples = getRecentHealthSamples(patientId, type, since, 100);
      for (const s of samples) {
        const sampleId = `sample-${s.sampleId}`;
        if (!this.graph.nodes.has(sampleId)) {
          this.addNode(node(sampleId, 'Sample', `${s.type} ${s.value}${s.unit}`, { ...s }));
          this.addEdge(`patient-${patientId}`, sampleId, 'HAS_SAMPLE');
          this.addEdge(`vital-${s.type}`, sampleId, 'HAS_SAMPLE');
          sampleNodes.push(this.graph.nodes.get(sampleId)!);
        }
      }
    }

    // Alerts and actions
    const alerts = getActiveAlerts(patientId);
    for (const a of alerts) {
      this.addNode(node(`alert-${a.alertId}`, 'Alert', a.title, { ...a }));
      this.addEdge(`patient-${patientId}`, `alert-${a.alertId}`, 'HAS_ALERT');

      const actions = getActionsForAlert(a.alertId);
      for (const action of actions) {
        const actionId = `action-${action.actionId}`;
        if (!this.graph.nodes.has(actionId)) {
          this.addNode(node(actionId, 'Action', action.type, { ...action }));
        }
        this.addEdge(`alert-${a.alertId}`, actionId, 'RESULTED_IN');
        this.addEdge(`action-${action.actionId}`, `alert-${a.alertId}`, 'RESPONDS_TO');
      }
    }

    // ADCP — project CarePlan + Goal nodes so the plan-rooted subgraph has
    // something to anchor on (planning/39 §9 P3).
    try {
      const adcpRevisions = listAdcpRevisionsForPatient(patientId);
      for (const rev of adcpRevisions) {
        const cpId = `careplan-${rev.identity.planId}`;
        if (!this.graph.nodes.has(cpId)) {
          this.addNode(
            node(cpId, 'CarePlan', `v${rev.identity.version} (${rev.identity.source})`, {
              ...rev.identity,
            }),
          );
        }
        this.addEdge(`patient-${patientId}`, cpId, 'PART_OF');
        for (const goal of rev.goals.goals) {
          const goalId = `goal-${goal.goalId}`;
          if (!this.graph.nodes.has(goalId)) {
            this.addNode(node(goalId, 'Goal', goal.description, { ...goal }));
          }
          this.addEdge(goalId, cpId, 'PART_OF');
          if (goal.measurementTarget?.metricKey) {
            this.addEdge(goalId, `vital-${goal.measurementTarget.metricKey}`, 'CONSTRAINS');
          }
        }
      }
    } catch {
      // ignore — KG projection is best-effort
    }

    // Edges from persistent graph_edges table
    const db = getDatabase();
    const storedEdges = db.getAllSync<{ fromId: string; toId: string; type: GraphEdge['type']; weight: number; createdAt: string }>(
      `SELECT from_id AS fromId, to_id AS toId, type, weight, created_at AS createdAt
       FROM graph_edges
       WHERE created_at >= ?
       ORDER BY created_at ASC;`,
      since,
    );
    for (const e of storedEdges) {
      if (this.graph.nodes.has(e.fromId) && this.graph.nodes.has(e.toId)) {
        this.addEdge(e.fromId, e.toId, e.type, e.weight);
      }
    }

    // Temporal PRECEDED edges between consecutive samples of the same vital type
    for (const type of vitalTypes) {
      const typeSamples = sampleNodes
        .filter((n) => n.data.type === type)
        .sort((a, b) => String(a.data.recordedAt).localeCompare(String(b.data.recordedAt)));
      for (let i = 1; i < typeSamples.length; i++) {
        this.addEdge(typeSamples[i - 1].id, typeSamples[i].id, 'PRECEDED', 0.5);
      }
    }

    return this.graph;
  }

  private addNode(n: GraphNode): void {
    this.graph.nodes.set(n.id, n);
    if (!this.graph.adjacency.has(n.id)) this.graph.adjacency.set(n.id, []);
    if (!this.graph.reverseAdjacency.has(n.id)) this.graph.reverseAdjacency.set(n.id, []);
  }

  private addEdge(from: string, to: string, type: GraphEdge['type'], weight = 1.0): void {
    const e = edge(from, to, type, weight);
    this.graph.adjacency.get(from)?.push(e);
    this.graph.reverseAdjacency.get(to)?.push(e);
  }

  getGraph(): InMemoryGraph {
    return this.graph;
  }
}
