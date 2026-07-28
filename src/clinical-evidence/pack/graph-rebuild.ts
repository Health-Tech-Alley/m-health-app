/**
 * Rebuild pack-scoped evidence graph after layer import (doc 42 / extends doc 36).
 */

import type { PackChunkRow, PackEdgeRow } from './types';
import {
  clearAllPackEdges,
  getAllPackChunks,
  upsertPackEdges,
} from './pack-db';

const DEFAULT_MAX_DEGREE = 20;

function parseConditionsCsv(csv?: string): string[] {
  if (!csv?.trim()) return [];
  return csv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeUndirected(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function parentOfEdges(chunks: PackChunkRow[]): PackEdgeRow[] {
  const edges: PackEdgeRow[] = [];
  for (const c of chunks) {
    let parentDocId: string | undefined;
    try {
      if (c.metadataJson) {
        parentDocId = (JSON.parse(c.metadataJson) as { parentDocId?: string }).parentDocId;
      }
    } catch {
      /* ignore */
    }
    if (!parentDocId && c.chunkId.includes('#s')) {
      parentDocId = c.chunkId.slice(0, c.chunkId.indexOf('#s'));
    }
    if (!parentDocId || parentDocId === c.chunkId) continue;
    edges.push({
      fromChunkId: parentDocId,
      toChunkId: c.chunkId,
      type: 'PARENT_OF',
      weight: 1,
      source: 'pack',
      packLayer: c.packLayer,
    });
  }
  return edges;
}

function sharesConditionEdges(
  chunks: PackChunkRow[],
  maxDegree = DEFAULT_MAX_DEGREE,
): PackEdgeRow[] {
  const byToken = new Map<string, string[]>();
  for (const c of chunks) {
    for (const t of parseConditionsCsv(c.conditions)) {
      let list = byToken.get(t);
      if (!list) {
        list = [];
        byToken.set(t, list);
      }
      list.push(c.chunkId);
    }
  }

  const edges: PackEdgeRow[] = [];
  const seen = new Set<string>();

  for (const c of chunks) {
    const tokens = parseConditionsCsv(c.conditions);
    let connected = 0;
    for (const t of tokens) {
      if (connected >= maxDegree) break;
      for (const partnerId of byToken.get(t) ?? []) {
        if (connected >= maxDegree) break;
        if (partnerId === c.chunkId) continue;
        const [from, to] = normalizeUndirected(c.chunkId, partnerId);
        const key = `SHARES_CONDITION:${from}:${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          fromChunkId: from,
          toChunkId: to,
          type: 'SHARES_CONDITION',
          weight: 1,
          source: 'pack',
        });
        connected++;
      }
    }
  }
  return edges;
}

function sharesMedicationEdges(
  chunks: PackChunkRow[],
  maxDegree = DEFAULT_MAX_DEGREE,
): PackEdgeRow[] {
  const byMed = new Map<string, string[]>();
  for (const c of chunks) {
    let medKey: string | undefined;
    try {
      if (c.metadataJson) {
        medKey = (JSON.parse(c.metadataJson) as { medKey?: string }).medKey;
      }
    } catch {
      /* ignore */
    }
    if (!medKey) continue;
    const key = medKey.toLowerCase();
    let list = byMed.get(key);
    if (!list) {
      list = [];
      byMed.set(key, list);
    }
    list.push(c.chunkId);
  }

  const edges: PackEdgeRow[] = [];
  const seen = new Set<string>();

  for (const [, ids] of byMed) {
    for (let i = 0; i < ids.length; i++) {
      let connected = 0;
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        if (connected >= maxDegree) break;
        const [from, to] = normalizeUndirected(ids[i], ids[j]);
        const key = `SHARES_MEDICATION:${from}:${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          fromChunkId: from,
          toChunkId: to,
          type: 'SHARES_MEDICATION',
          weight: 1,
          source: 'pack',
        });
        connected++;
      }
    }
  }
  return edges;
}

/** Full pack graph rebuild (G0). */
export function rebuildPackEvidenceGraph(opts?: { maxDegree?: number }): number {
  const chunks = getAllPackChunks();
  clearAllPackEdges();
  const maxDegree = opts?.maxDegree ?? DEFAULT_MAX_DEGREE;
  const edges = [
    ...parentOfEdges(chunks),
    ...sharesConditionEdges(chunks, maxDegree),
    ...sharesMedicationEdges(chunks, maxDegree),
  ];
  upsertPackEdges(edges);
  return edges.length;
}
