/**
 * Edge writers.
 *
 * Persist graph edges to the `graph_edges` table whenever the authoritative
 * SQLite tables change. Keeping edge writes in one place prevents graph drift.
 */

import { getDatabase } from '@/data/db';
import type { GraphEdge } from './types';

function now(): string {
  return new Date().toISOString();
}

export function writeGraphEdge(edge: Omit<GraphEdge, 'createdAt' | 'weight'> & { weight?: number }): GraphEdge {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO graph_edges
      (from_id, to_id, type, weight, created_at)
     VALUES (?, ?, ?, ?, ?);`,
    edge.from,
    edge.to,
    edge.type,
    edge.weight ?? 1.0,
    now(),
  );
  return { ...edge, weight: edge.weight ?? 1.0, createdAt: now() };
}

export function writeSampleEdges(patientId: string, sampleId: string, vitalType: string): void {
  writeGraphEdge({ from: `patient-${patientId}`, to: `sample-${sampleId}`, type: 'HAS_SAMPLE' });
  writeGraphEdge({ from: `vital-${vitalType}`, to: `sample-${sampleId}`, type: 'HAS_SAMPLE' });
}

export function writeTriggerEdges(
  sampleId: string,
  thresholdId: string,
  alertId: string,
): void {
  writeGraphEdge({ from: `sample-${sampleId}`, to: `threshold-${thresholdId}`, type: 'TRIGGERED' });
  writeGraphEdge({ from: `sample-${sampleId}`, to: `alert-${alertId}`, type: 'TRIGGERED' });
}

export function writeAlertEdges(patientId: string, alertId: string): void {
  writeGraphEdge({ from: `patient-${patientId}`, to: `alert-${alertId}`, type: 'HAS_ALERT' });
}

export function writeActionEdges(
  actionId: string,
  alertId: string | undefined,
  caregiverId: string,
): void {
  if (alertId) {
    writeGraphEdge({ from: `action-${actionId}`, to: `alert-${alertId}`, type: 'RESPONDS_TO' });
    writeGraphEdge({ from: `alert-${alertId}`, to: `action-${actionId}`, type: 'RESULTED_IN' });
  }
  writeGraphEdge({ from: `caregiver-${caregiverId}`, to: `action-${actionId}`, type: 'RESPONDS_TO' });
}

export function writeThresholdCitationEdge(thresholdId: string, citationId: string): void {
  writeGraphEdge({ from: `citation-${citationId}`, to: `threshold-${thresholdId}`, type: 'SUPPORTS' });
}

export function writeSlmTurnEdges(
  turnId: string,
  alertId: string | undefined,
  citationIds: string[],
): void {
  if (alertId) {
    writeGraphEdge({ from: `slm-turn-${turnId}`, to: `alert-${alertId}`, type: 'INFORMS' });
  }
  for (const cid of citationIds) {
    writeGraphEdge({ from: `slm-turn-${turnId}`, to: `citation-${cid}`, type: 'CITES' });
  }
}
