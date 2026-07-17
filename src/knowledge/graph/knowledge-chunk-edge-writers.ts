/**
 * Knowledge chunk edge writers for the evidence graph (doc 36).
 *
 * These write PARENT_OF, SHARES_CONDITION, and SHARES_MEDICATION edges into
 * the knowledge_chunk_edges table at bundle / live supplement / CDA insert
 * time. All entry points are try/catch-wrapped at the call site so enrichment
 * never fails the parent operation.
 *
 * Do NOT edit patient edge-writers.ts for evidence edges.
 */

import type { KnowledgeChunk, KnowledgeChunkEdgeType } from '@/data/types';
import {
  upsertKnowledgeChunkEdge,
  clearAllKnowledgeChunkEdges,
  normalizeUndirectedEndpoints,
} from '@/data/repositories/knowledgeChunkEdgeRepository';
import { getAllKnowledgeChunks } from '@/data/repositories/knowledgeCacheRepository';

export const DEFAULT_MAX_DEGREE = 20;

export const V1_EDGE_TYPES: readonly KnowledgeChunkEdgeType[] = [
  'PARENT_OF',
  'SHARES_CONDITION',
  'SHARES_MEDICATION',
];

// ---------------------------------------------------------------------------
// PARENT_OF
// ---------------------------------------------------------------------------

export function writeParentOfEdges(
  chunks: KnowledgeChunk[],
  source = 'section',
): void {
  for (const c of chunks) {
    let parentDocId: string | undefined;
    try {
      if (c.metadataJson) {
        parentDocId = (
          JSON.parse(c.metadataJson) as { parentDocId?: string }
        ).parentDocId;
      }
    } catch {
      /* metadata not JSON */
    }
    if (!parentDocId && c.chunkId.includes('#s')) {
      parentDocId = c.chunkId.slice(0, c.chunkId.indexOf('#s'));
    }
    if (!parentDocId || parentDocId === c.chunkId) continue;
    upsertKnowledgeChunkEdge({
      fromChunkId: parentDocId,
      toChunkId: c.chunkId,
      type: 'PARENT_OF',
      weight: 1.0,
      source,
    });
  }
}

// ---------------------------------------------------------------------------
// SHARES_CONDITION
// ---------------------------------------------------------------------------

function parseConditionsCsv(csv?: string): string[] {
  if (!csv?.trim()) return [];
  return csv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function parseMetadataPatientId(chunk: KnowledgeChunk): string | undefined {
  if (chunk.patientId) return chunk.patientId;
  if (!chunk.metadataJson) return undefined;
  try {
    return (JSON.parse(chunk.metadataJson) as { patientId?: string }).patientId;
  } catch {
    return undefined;
  }
}

function canLinkPatientScopes(a: KnowledgeChunk, b: KnowledgeChunk): boolean {
  const aPatientId = parseMetadataPatientId(a);
  const bPatientId = parseMetadataPatientId(b);
  return !aPatientId || !bPatientId || aPatientId === bPatientId;
}

export function writeSharesConditionEdges(
  newChunks: KnowledgeChunk[],
  opts?: { maxDegree?: number; source?: string },
): void {
  const maxDegree = opts?.maxDegree ?? DEFAULT_MAX_DEGREE;
  const source = opts?.source ?? 'bundler';

  const all = getAllKnowledgeChunks();
  const byId = new Map(all.map((c) => [c.chunkId, c]));
  const byToken = new Map<string, string[]>();

  for (const c of all) {
    const tokens = parseConditionsCsv(c.conditions);
    for (const t of tokens) {
      let list = byToken.get(t);
      if (!list) {
        list = [];
        byToken.set(t, list);
      }
      list.push(c.chunkId);
    }
  }

  const newlyWritten = new Set<string>();

  for (const c of newChunks) {
    const tokens = parseConditionsCsv(c.conditions);
    let connected = 0;
    for (const t of tokens) {
      if (connected >= maxDegree) break;
      const partners = byToken.get(t) ?? [];
      for (const partnerId of partners) {
        if (connected >= maxDegree) break;
        if (partnerId === c.chunkId) continue;
        const partner = byId.get(partnerId);
        if (partner && !canLinkPatientScopes(c, partner)) continue;
        const [from, to] = normalizeUndirectedEndpoints(c.chunkId, partnerId);
        const key = `SHARES_CONDITION:${from}:${to}`;
        if (newlyWritten.has(key)) continue;
        newlyWritten.add(key);
        upsertKnowledgeChunkEdge({
          fromChunkId: from,
          toChunkId: to,
          type: 'SHARES_CONDITION',
          weight: 1.0,
          source,
        });
        connected++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// SHARES_MEDICATION
// ---------------------------------------------------------------------------

export function writeSharesMedicationEdges(
  newChunks: KnowledgeChunk[],
  medKey: string,
  opts?: { maxDegree?: number; source?: string },
): void {
  const maxDegree = opts?.maxDegree ?? DEFAULT_MAX_DEGREE;
  const source = opts?.source ?? 'bundler';

  const all = getAllKnowledgeChunks();
  const byId = new Map(all.map((c) => [c.chunkId, c]));
  const byMedKey = new Map<string, string[]>();

  for (const c of all) {
    let key: string | undefined;
    try {
      if (c.metadataJson) {
        key = (JSON.parse(c.metadataJson) as { medKey?: string }).medKey;
      }
    } catch {
      /* ignore */
    }
    if (!key) {
      const lower = parseConditionsCsv(c.conditions);
      if (lower.includes(medKey)) key = medKey;
    }
    if (!key) continue;
    let list = byMedKey.get(key);
    if (!list) {
      list = [];
      byMedKey.set(key, list);
    }
    list.push(c.chunkId);
  }

  const newIds = new Set(newChunks.map((c) => c.chunkId));
  const newlyWritten = new Set<string>();

  for (const c of newChunks) {
    const existing = byMedKey.get(medKey) ?? [];
    let connected = 0;
    for (const partnerId of existing) {
      if (connected >= maxDegree) break;
      if (partnerId === c.chunkId) continue;
      if (newIds.has(partnerId)) continue;
      const partner = byId.get(partnerId);
      if (partner && !canLinkPatientScopes(c, partner)) continue;
      const [from, to] = normalizeUndirectedEndpoints(c.chunkId, partnerId);
      const key = `SHARES_MEDICATION:${from}:${to}`;
      if (newlyWritten.has(key)) continue;
      newlyWritten.add(key);
      upsertKnowledgeChunkEdge({
        fromChunkId: from,
        toChunkId: to,
        type: 'SHARES_MEDICATION',
        weight: 1.0,
        source,
        metadataJson: JSON.stringify({ medKey }),
      });
      connected++;
    }
  }
}

// ---------------------------------------------------------------------------
// Full rebuild (dev / post-bundle)
// ---------------------------------------------------------------------------

export function rebuildStructuralEdgesForCache(opts?: {
  maxDegree?: number;
}): void {
  clearAllKnowledgeChunkEdges();
  const all = getAllKnowledgeChunks();
  writeParentOfEdges(all, 'rebuild');
  writeSharesConditionEdges(all, {
    maxDegree: opts?.maxDegree,
    source: 'rebuild',
  });
}
