/**
 * Context router — the tiered T0–T6 prompt-context selection layer.
 *
 * Per planning/32 §10.3, the SLM prompt is assembled from six tiers:
 *   T0 — Always-on        (patient, thresholds, baselines, PCP, main concern)
 *   T1 — Condition-tagged (all chunks tagged with the patient's conditions)
 *   T2 — Query-BM25       (query-time lexical match, top 5)
 *   T3 — Deep docs        (guideline / systematic-review / full SPL)
 *   T4 — SDOH             (CDC PLACES chunk for the patient's geography)
 *   T5 — Prior decisions  (audit + nonEmergencyDecision)
 *   T6 — ML bridge        (top features, rule engine, caregiver HITL)
 *
 * The orchestrator owns the orchestrator-level concerns (T6 ML bridge, T5
 * prior decisions via the priorDecisionsProvider). The router here is
 * responsible for T1–T4 — choosing which knowledge chunks to surface — and
 * produces a `SelectedContext` that the aggregator copies into the
 * AggregatedContext passed to the SLM.
 *
 * In practice most of T1–T3 work happens inside CachedFusedRetriever; this
 * router adds the SDOH (T4) and deep-mode (T3) gating so both builders
 * (orchestrator + chat) can use a single source of truth.
 */

import type { RetrievedChunk } from '@/knowledge/types';
import { getKnowledgeChunksByCondition } from '@/data/repositories/knowledgeCacheRepository';
import type { ReasoningMode } from '@/constants/concierge';
import { fetchCdcPlaces, cdcToChunks } from './cdc-places-client';

const SDOH_KEYWORDS = /\b(rural|urban|transport|access|barrier|insurance|near me|nearby|hospital|clinic|pharmacy|medicaid|medicare)\b/i;

export interface ContextRouterArgs {
  /** Caregiver's free-text message (used to decide whether SDOH tier fires). */
  message?: string;
  /** Patient's confirmed conditions — gates T1 (condition-tagged chunks). */
  conditions: string[];
  /** Patient's confirmed conditions from the snapshot (used for SDOH fallback). */
  snapshotConditions?: string[];
  /** Patient's free-text location (county / state) for T4. */
  location?: string;
  /** Reasoning mode drives the chunk-budget for T2/T3. */
  reasoningMode: ReasoningMode;
  /** Top-K for T2 (query-BM25). */
  kChunks?: number;
  /** How many long-doc chunks to surface in T3. */
  kDeep?: number;
}

export interface SelectedContext {
  /** T1 — condition-tagged chunks (deduplicated against T2). */
  conditionTagged: RetrievedChunk[];
  /** T2 — query-BM25 chunks. */
  query: RetrievedChunk[];
  /** T3 — deep-doc chunks (guideline / systematic-review / full SPL). */
  deep: RetrievedChunk[];
  /** T4 — SDOH chunk (CDC PLACES), or null. */
  sdoh: RetrievedChunk | null;
}

/**
 * SDOH chunk source pulled directly from the knowledge_cache. Keeps the
 * router free of async live-network calls — bundler pre-populates these.
 */
function getSdohChunk(location?: string): RetrievedChunk | null {
  if (!location) return null;
  const chunks = getKnowledgeChunksByCondition('SDOH');
  const lc = location.toLowerCase();
  const hit = chunks.find((c) => c.text.toLowerCase().includes(lc)) ?? chunks[0];
  if (!hit) return null;
  return {
    docId: hit.chunkId,
    text: hit.text,
    score: 1,
    source: 'cdc-places' as const,
    documentType: hit.documentType,
    lengthTier: hit.lengthTier,
  };
}

/**
 * SDOH live-fetch fallback. Used when the cache has no record for the
 * requested geography (e.g. a newly added patient without a re-bundle).
 */
async function fetchSdohLive(location: string): Promise<RetrievedChunk | null> {
  try {
    const rec = await fetchCdcPlaces({ location });
    if (!rec) return null;
    const chunks = cdcToChunks(rec);
    if (chunks.length === 0) return null;
    const c = chunks[0];
    return {
      docId: c.chunkId,
      text: c.text,
      score: 1,
      source: 'cdc-places' as const,
      documentType: c.documentType,
      lengthTier: c.lengthTier,
    };
  } catch {
    return null;
  }
}

function deepChunksFromStore(conditions: string[], kDeep: number): RetrievedChunk[] {
  if (conditions.length === 0) return [];
  const all: RetrievedChunk[] = [];
  for (const cond of conditions) {
    const chunks = getKnowledgeChunksByCondition(cond);
    for (const c of chunks) {
      const dt = c.documentType;
      if (
        dt === 'guideline' ||
        dt === 'systematic_review' ||
        dt === 'fulltext' ||
        dt === 'spl_full'
      ) {
        all.push({
          docId: c.chunkId,
          text: c.text,
          score: 1,
          source: c.source,
          documentType: c.documentType,
          lengthTier: c.lengthTier,
          sectionHeading: c.sectionHeading,
        });
      }
    }
  }
  // Dedup by docId; cap at kDeep.
  const dedup = new Map<string, RetrievedChunk>();
  for (const c of all) if (!dedup.has(c.docId)) dedup.set(c.docId, c);
  return Array.from(dedup.values()).slice(0, kDeep);
}

/**
 * Select the context tiers for a single SLM call. Pure-ish: it can do an
 * async live-fetch only for the SDOH tier (T4) when the cache misses.
 */
export async function selectContextForPrompt(
  args: ContextRouterArgs,
  /** The query-BM25 retriever (CachedFusedRetriever). */
  retrieveQuery: (q: {
    intent: string;
    conditions: string[];
    activeMeds?: string[];
    kTools?: number;
    kChunks?: number;
  }) => Promise<{ chunks: RetrievedChunk[] }>,
): Promise<SelectedContext> {
  const kChunks = args.kChunks ?? 8;
  const kDeep = args.kDeep ?? 2;

  // T2 — query BM25
  const queryResult = await retrieveQuery({
    intent: args.message ?? '',
    conditions: args.conditions,
    kChunks,
  });
  const queryChunks = queryResult.chunks;

  // T1 — condition-tagged chunks not already in the query set.
  const queryIds = new Set(queryChunks.map((c) => c.docId));
  const conditionTagged: RetrievedChunk[] = [];
  for (const cond of args.conditions) {
    const tagged = getKnowledgeChunksByCondition(cond);
    for (const c of tagged) {
      if (queryIds.has(c.chunkId)) continue;
       conditionTagged.push({
         docId: c.chunkId,
         text: c.text,
         score: 0.5,
         source: c.source,
         documentType: c.documentType,
         lengthTier: c.lengthTier,
         sectionHeading: c.sectionHeading,
       });
      queryIds.add(c.chunkId);
    }
  }

  // T3 — deep docs (only when reasoning is 'auto').
  const deep = args.reasoningMode === 'auto'
    ? deepChunksFromStore(args.snapshotConditions ?? args.conditions, kDeep)
    : [];

  // T4 — SDOH chunk, only when the message touches access/barriers/rural.
  let sdoh: RetrievedChunk | null = null;
  // Require SDOH language in the message — do not always inject when location is set.
  if (args.location && SDOH_KEYWORDS.test(args.message ?? '')) {
    sdoh = getSdohChunk(args.location);
    if (!sdoh) sdoh = await fetchSdohLive(args.location);
  }

  return {
    conditionTagged,
    query: queryChunks,
    deep,
    sdoh,
  };
}
