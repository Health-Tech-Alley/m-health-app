/**
 * CachedFusedRetriever — BM25-only retriever that reads from the knowledge_cache
 * table + synthetic fixtures, with a live-supplement hook.
 *
 * Replaces TrackAFusedRetriever's dense + RRF approach with BM25-only (medical
 * terminology is highly lexical — condition names, drug names, and symptom
 * keywords are exact-match-friendly). Drops the Track B dense embedder
 * dependency.
 *
 * If BM25 returns < 3 results, calls `liveSupplement()` to hit PubMed +
 * MedlinePlus on the spot, cache the results, and re-search.
 *
 * See planning/22_clinical-data-gathering.md §7.
 */

import { Bm25Index } from '@/knowledge/bm25-index';
import type {
  FusedRetriever,
  McpToolSummary,
  RetrievalQuery,
  RetrievalResult,
  RetrievedChunk,
} from '@/knowledge/types';
import {
  getAllKnowledgeChunks,
  clearExpiredKnowledgeChunks,
} from '@/data/repositories/knowledgeCacheRepository';
import type { KnowledgeChunk } from '@/data/types';
import { liveSupplement } from '@/clinical-evidence/condition-bundler';
import { mergeByParent } from '@/nlu/section-chunker';
import { getAppSettings } from '@/data/repositories/appSettingsRepository';
import { getIncidentEdges } from '@/data/repositories/knowledgeChunkEdgeRepository';
import {
  expandSeedsWithEdges,
  fuseBm25AndGraph,
  type RankHit,
} from '@/knowledge/graph/evidence-expand';

const LIVE_SUPPLEMENT_THRESHOLD = 3;

type ChunkMetadata = {
  patientId?: string;
  sourceId?: string;
  sourceType?: string;
  resourceId?: string;
  docId?: string;
  effectiveAt?: string;
  createdAt?: string;
  retrievedAt?: string;
  kind?: string;
  synthetic?: boolean;
};

function parseChunkMetadata(chunk: KnowledgeChunk): ChunkMetadata {
  if (!chunk.metadataJson) return {};
  try {
    return JSON.parse(chunk.metadataJson) as ChunkMetadata;
  } catch {
    return {};
  }
}

function metadataPatientId(chunk: KnowledgeChunk): string | undefined {
  return chunk.patientId ?? parseChunkMetadata(chunk).patientId;
}

function chunkBelongsToPatient(chunk: KnowledgeChunk, patientId?: string): boolean {
  const chunkPatientId = metadataPatientId(chunk);
  if (!chunkPatientId) return true;
  return Boolean(patientId && chunkPatientId === patientId);
}

function knowledgeChunkToRetrievedChunk(
  chunk: KnowledgeChunk,
  score: number,
  retrievalMethod = 'bm25',
): RetrievedChunk {
  const metadata = parseChunkMetadata(chunk);
  const patientRecord =
    metadata.sourceType === 'patient-record' || metadata.kind === 'cda_narrative';
  const source = patientRecord
    ? 'patient-record'
    : (chunk.source as RetrievedChunk['source']);
  return {
    docId: chunk.chunkId,
    text: chunk.text,
    score,
    source,
    documentType: chunk.documentType as RetrievedChunk['documentType'],
    lengthTier: chunk.lengthTier as RetrievedChunk['lengthTier'],
    sectionHeading: chunk.sectionHeading,
    patientId: chunk.patientId ?? metadata.patientId,
    sourceId: chunk.sourceId ?? metadata.sourceId ?? metadata.docId ?? chunk.chunkId,
    sourceType: chunk.sourceType ?? metadata.sourceType ?? source,
    resourceId: chunk.resourceId ?? metadata.resourceId ?? metadata.docId,
    effectiveAt: chunk.effectiveAt ?? metadata.effectiveAt,
    createdAt: metadata.createdAt ?? metadata.retrievedAt ?? chunk.retrievedAt,
    synthetic:
      chunk.synthetic ??
      metadata.synthetic ??
      (chunk.source === 'synthetic' && !patientRecord),
    retrievalMethod: chunk.retrievalMethod ?? retrievalMethod,
  };
}

function shouldUseDevelopmentEvidenceFixtures(): boolean {
  return __DEV__ && getAppSettings().evidenceDevelopmentFallback === true;
}

export type CachedFusedRetrieverOptions = {
  tools: McpToolSummary[];
  patientName?: string;
  patientConditions?: string[];
  activeMeds?: string[];
  spo2Cutoff?: string;
  /** Patient ID for live supplement queries + enrichment logging. */
  patientId?: string;
};

export class CachedFusedRetriever implements FusedRetriever {
  private clinicalBm25 = new Bm25Index();
  private toolBm25 = new Bm25Index();
  private toolMap = new Map<string, McpToolSummary>();
  private chunkMap = new Map<string, RetrievedChunk>();
  private ready = false;
  private patientId?: string;
  private patientConditions: string[];
  private options: CachedFusedRetrieverOptions;
  private buildPromise: Promise<void> | null = null;

  constructor(options: CachedFusedRetrieverOptions) {
    this.options = {
      ...options,
      tools: [...options.tools],
      patientConditions: [...(options.patientConditions ?? [])],
      activeMeds: [...(options.activeMeds ?? [])],
    };
    this.patientId = options.patientId;
    this.patientConditions = options.patientConditions ?? [];
    // Kick off async index building
    this.buildPromise = this.buildIndexes(this.options);
  }

  private async buildIndexes(options: CachedFusedRetrieverOptions): Promise<void> {
    // Clear expired OpenFDA chunks before building
    clearExpiredKnowledgeChunks();

    // Load cached chunks from knowledge_cache table
    const cachedChunks = getAllKnowledgeChunks().filter((chunk) =>
      chunkBelongsToPatient(chunk, this.patientId),
    );

    // Combine: synthetic fixtures (fallback) + cached clinical chunks
    const fixtureChunks: RetrievedChunk[] = [];
    if (shouldUseDevelopmentEvidenceFixtures()) {
      const {
        getAllClinicalFixtures,
        getPatientPlanFixtures,
      } = await import('@/knowledge/corpora/fixtures');
      const { getAllCpgFixtures } = await import('@/knowledge/corpora/cpg-fixtures');
      fixtureChunks.push(
        ...getAllClinicalFixtures(),
        ...getAllCpgFixtures(),
        ...getPatientPlanFixtures(
          options.patientName ?? 'the patient',
          options.patientConditions ?? [],
          options.activeMeds ?? [],
          options.spo2Cutoff,
        ),
      );
    }

    // Build a combined set — fixtures first (lower priority), then cached
    const allChunks: { docId: string; text: string; chunk: RetrievedChunk }[] = [];

    for (const c of fixtureChunks) {
      const retrieved: RetrievedChunk = {
        ...c,
        score: 0,
        synthetic: true,
        retrievalMethod: 'development_fixture',
        patientId: c.patientId ?? this.patientId,
      };
      this.chunkMap.set(c.docId, retrieved);
      allChunks.push({ docId: c.docId, text: `${c.docId} ${c.text}`, chunk: retrieved });
    }

    for (const c of cachedChunks) {
      const retrieved = knowledgeChunkToRetrievedChunk(c, 0);
      // Don't overwrite fixtures with cached chunks of the same docId
      if (!this.chunkMap.has(c.chunkId)) {
        this.chunkMap.set(c.chunkId, retrieved);
        allChunks.push({ docId: c.chunkId, text: `${c.chunkId} ${c.text}`, chunk: retrieved });
      }
    }

    this.clinicalBm25.add(allChunks.map((c) => ({ docId: c.docId, text: c.text })));

    // Build tool index
    const toolDocs = options.tools.map((t) => ({
      docId: t.name,
      text: `${t.name} ${t.description}`,
    }));
    for (const t of options.tools) {
      this.toolMap.set(t.name, t);
    }
    this.toolBm25.add(toolDocs);

    this.ready = true;
  }

  private async ensureReady(): Promise<void> {
    if (this.ready) return;
    if (this.buildPromise) {
      await this.buildPromise;
    }
  }

  async retrieve(q: RetrievalQuery): Promise<RetrievalResult> {
    return this.retrieveInternal(q, 'fast');
  }

  /**
   * Deep mode (planning/32 §12.4) — returns up to 2 long-doc chunks
   * (guideline / systematic-review / full SPL) plus the regular short
   * chunks. The prompt-budget router truncates the long chunks per budget.
   */
  async retrieveDeep(q: RetrievalQuery): Promise<RetrievalResult> {
    return this.retrieveInternal(q, 'deep');
  }

  private async retrieveInternal(
    q: RetrievalQuery,
    mode: 'fast' | 'deep',
  ): Promise<RetrievalResult> {
    await this.ensureReady();

    const t0 = performance.now();
    const query = [q.intent, ...q.conditions, ...q.activeMeds].join(' ');
    const kChunks = q.kChunks ?? 8;
    const overFetch = Math.max(kChunks * 3, 12);

    // Tool search (BM25 only)
    const toolRank = this.toolBm25.search(query, q.kTools ?? 3);
    const tools = toolRank
      .map((r) => this.toolMap.get(r.docId))
      .filter((t): t is McpToolSummary => Boolean(t));

    // Clinical chunk BM25 seed list.
    let chunkRank: RankHit[] = this.clinicalBm25.search(query, overFetch);

    // Live supplement if insufficient results (opt-out for chat NLU hot path).
    if (
      q.allowLiveSupplement !== false &&
      chunkRank.length < LIVE_SUPPLEMENT_THRESHOLD &&
      this.patientId &&
      this.patientConditions.length > 0
    ) {
      try {
        const supplemented = await liveSupplement(
          q.intent,
          q.conditions.length > 0 ? q.conditions : this.patientConditions,
          this.patientId,
        );

        if (supplemented.length > 0) {
          const newDocs = supplemented.map((c) => ({
            docId: c.chunkId,
            text: `${c.chunkId} ${c.text}`,
          }));
          this.clinicalBm25.add(newDocs);
          for (const c of supplemented) {
            const retrieved = knowledgeChunkToRetrievedChunk(c, 0);
            this.chunkMap.set(c.chunkId, retrieved);
          }

          chunkRank = this.clinicalBm25.search(query, overFetch);
        }
      } catch (err) {
        console.error('[CachedFusedRetriever] Live supplement failed:', err);
      }
    }

    // Evidence graph expansion (doc 36) — flag-gated.
    let relationByDoc = new Map<string, { type: string; seedId: string }>();

    if (getAppSettings().knowledgeGraphExpansion) {
      const tGraph = performance.now();
      const seedIds = chunkRank.map((r) => r.docId);
      const edges = getIncidentEdges(seedIds);
      const known = new Set(this.chunkMap.keys());
      const expanded = expandSeedsWithEdges({
        bm25Rank: chunkRank,
        edges,
        knownDocIds: known,
      });
      relationByDoc = expanded.relationByDoc;
      chunkRank = fuseBm25AndGraph(chunkRank, expanded.graphRank);
      console.log(
        `[CachedFusedRetriever] graphExpand seeds=${seedIds.length} edges=${edges.length} ` +
          `neighbors=${relationByDoc.size} ms=${Math.round(performance.now() - tGraph)}`,
      );
    }

    const rankedChunks: RetrievedChunk[] = chunkRank
      .map((r): RetrievedChunk | null => {
        const chunk = this.chunkMap.get(r.docId);
        if (!chunk) return null;
        const rel = relationByDoc.get(r.docId);
        return {
          ...chunk,
          score: r.score,
          retrievalMethod: rel
            ? 'bm25_graph'
            : chunk.retrievalMethod ?? (mode === 'deep' ? 'deep_bm25' : 'bm25'),
          ...(rel
            ? {
                graphRelation: rel.type,
                graphSeedId: rel.seedId,
              }
            : {}),
        };
      })
      .filter((c): c is RetrievedChunk => Boolean(c));

    let chunks = mergeByParent<RetrievedChunk>(rankedChunks, 1).slice(0, kChunks);

    // Deep mode (§12.4): up the chunk count and prefer long-doc chunks
    // (guideline / systematic_review / fulltext / spl_full).
    if (mode === 'deep') {
      const deepPool = Array.from(this.chunkMap.values()).filter((c) =>
        c.documentType &&
        ['guideline', 'systematic_review', 'fulltext', 'spl_full'].includes(
          c.documentType,
        ),
      );
      const longDocs = deepPool.slice(0, 2);
      const dedup = new Map<string, RetrievedChunk>();
      for (const c of [...chunks, ...longDocs]) dedup.set(c.docId, c);
      chunks = Array.from(dedup.values());
    }

    return {
      tools,
      chunks,
      citations: chunks.map((c) => c.docId),
      latencyMs: Math.round(performance.now() - t0),
    };
  }

  /**
   * Rebuild the BM25 index from the knowledge_cache table + fixtures.
   * Called after the condition-bundler completes or after cache changes.
   */
  async rebuildIndex(): Promise<void> {
    this.ready = false;
    this.chunkMap.clear();
    this.clinicalBm25 = new Bm25Index();
    this.toolBm25 = new Bm25Index();
    this.toolMap.clear();
    this.buildPromise = this.buildIndexes({
      ...this.options,
      tools: [...this.options.tools],
      patientConditions: [...(this.options.patientConditions ?? [])],
      activeMeds: [...(this.options.activeMeds ?? [])],
    });
    await this.buildPromise;
  }
}
