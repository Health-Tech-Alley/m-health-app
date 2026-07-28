/**
 * CachedFusedRetriever — BM25 → graph 1-hop → dense rerank over
 * global pack ∪ patient overlay (doc 42).
 *
 * Live supplement remains a residual path when the pack runner flag is off
 * or BM25 is sparse.
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
  getKnowledgeChunksForPatient,
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
import { cosineSimilarity, createReadyEmbedder } from '@/knowledge/embedder';
import {
  float16BufferToFloat32Array,
  getAllPackChunks,
  getPackIncidentEdges,
  getPackVectorsForChunks,
  isKnowledgePackRunnerEnabled,
  PACK_EMBEDDER_ID,
} from '@/clinical-evidence/pack';

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

function knowledgeChunkToRetrievedChunk(
  chunk: KnowledgeChunk,
  score: number,
  retrievalMethod = 'bm25',
): RetrievedChunk & { feedbackScore?: number } {
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
    feedbackScore: chunk.feedbackScore ?? 0,
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
    // Fail closed: no patient → empty clinical corpus (never load all patients).
    if (!this.patientId?.trim()) {
      this.ready = true;
      return;
    }

    // Clear expired OpenFDA chunks for this patient before building
    clearExpiredKnowledgeChunks(this.patientId);

    // Patient overlay only (CDA, ADCP, pinned on-demand meds, legacy cache)
    const cachedChunks = getKnowledgeChunksForPatient(this.patientId);

    // Global pack corpus (Approach C) — no patient_id; shared across patients
    const packChunks = isKnowledgePackRunnerEnabled()
      ? (() => {
          try {
            return getAllPackChunks();
          } catch {
            return [];
          }
        })()
      : [];

    // Optional dev fixtures are tagged with this patient id so they don't
    // pollute other profiles' indexes.
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

    const allChunks: { docId: string; text: string; chunk: RetrievedChunk }[] = [];

    for (const c of fixtureChunks) {
      const retrieved: RetrievedChunk = {
        ...c,
        score: 0,
        synthetic: true,
        retrievalMethod: 'development_fixture',
        patientId: this.patientId,
      };
      this.chunkMap.set(c.docId, retrieved);
      allChunks.push({ docId: c.docId, text: `${c.docId} ${c.text}`, chunk: retrieved });
    }

    for (const p of packChunks) {
      const retrieved: RetrievedChunk = {
        docId: p.chunkId,
        text: p.text,
        score: 0,
        source: p.source as RetrievedChunk['source'],
        documentType: p.documentType as RetrievedChunk['documentType'],
        lengthTier: p.lengthTier as RetrievedChunk['lengthTier'],
        sectionHeading: p.sectionHeading,
        sourceId: p.externalId ?? p.chunkId,
        sourceType: p.source,
        resourceId: p.externalId,
        createdAt: p.retrievedAt,
        synthetic: false,
        retrievalMethod: 'pack',
      };
      if (!this.chunkMap.has(p.chunkId)) {
        this.chunkMap.set(p.chunkId, retrieved);
        allChunks.push({
          docId: p.chunkId,
          text: `${p.chunkId} ${p.text}`,
          chunk: retrieved,
        });
      }
    }

    for (const c of cachedChunks) {
      const retrieved = knowledgeChunkToRetrievedChunk(c, 0);
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
    // Prefer intent text; only append caller-scoped conditions/meds (NLU
    // passes turn entities or primary-only — never the full EHR dump).
    const query = [q.intent, ...q.conditions, ...q.activeMeds]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ');
    const kChunks = q.kChunks ?? 8;
    const overFetch = Math.max(kChunks * 3, 12);

    // Tool search (BM25 only)
    const toolRank = this.toolBm25.search(query, q.kTools ?? 3);
    const tools = toolRank
      .map((r) => this.toolMap.get(r.docId))
      .filter((t): t is McpToolSummary => Boolean(t));

    // Clinical chunk BM25 seed list.
    let chunkRank: RankHit[] = this.clinicalBm25.search(query, overFetch);

    // Live supplement residual — only when pack path is off or still sparse.
    const allowLive =
      q.allowLiveSupplement !== false &&
      (!isKnowledgePackRunnerEnabled() || chunkRank.length < LIVE_SUPPLEMENT_THRESHOLD);
    if (
      allowLive &&
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

    // Evidence graph expansion (doc 36/42) — pack edges ∪ overlay edges.
    let relationByDoc = new Map<string, { type: string; seedId: string }>();

    if (getAppSettings().knowledgeGraphExpansion) {
      const tGraph = performance.now();
      const seedIds = chunkRank.map((r) => r.docId);
      const overlayEdges = getIncidentEdges(seedIds);
      let packEdges: ReturnType<typeof getPackIncidentEdges> = [];
      if (isKnowledgePackRunnerEnabled()) {
        try {
          packEdges = getPackIncidentEdges(seedIds);
        } catch {
          packEdges = [];
        }
      }
      const edges = [
        ...overlayEdges,
        ...packEdges.map((e) => ({
          fromChunkId: e.fromChunkId,
          toChunkId: e.toChunkId,
          type: e.type,
          weight: e.weight,
          source: e.source,
          metadataJson: e.metadataJson,
          createdAt: '',
        })),
      ];
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

    // Dense rerank over BM25/graph candidates only (never full pack scan).
    // Only curated layers carry vectors (PACK_EMBED_LAYER_IDS); candidates
    // without vectors keep a scaled BM25 score and no dense bonus.
    if (isKnowledgePackRunnerEnabled() && chunkRank.length > 0) {
      try {
        const candidateIds = chunkRank.slice(0, Math.max(overFetch, 50)).map((r) => r.docId);
        const vectors = getPackVectorsForChunks(candidateIds, PACK_EMBEDDER_ID);
        // Also try mock embedder id used on Track A
        const mockVectors =
          vectors.size === 0
            ? getPackVectorsForChunks(candidateIds, `${PACK_EMBEDDER_ID}-mock`)
            : vectors;
        const vecMap = vectors.size > 0 ? vectors : mockVectors;
        if (vecMap.size > 0) {
          const emb = await createReadyEmbedder(4_000, { allowDevelopmentFallback: true });
          const qVec = await emb.embed(query, { isQuery: true });
          // Pad/truncate query vec to match stored dim if needed
          const qAligned =
            qVec.length === 768
              ? qVec
              : (() => {
                  const out = new Array(768).fill(0);
                  for (let i = 0; i < 768; i++) out[i] = qVec[i % qVec.length] ?? 0;
                  return out;
                })();
          chunkRank = chunkRank
            .map((r) => {
              const blob = vecMap.get(r.docId);
              // Keep the same 0.55 BM25 base for un-embedded candidates
              // (lit_lite has no vectors by design) so scores stay comparable.
              if (!blob) return { docId: r.docId, score: r.score * 0.55 };
              const docVec = float16BufferToFloat32Array(blob);
              const cos = cosineSimilarity(qAligned, docVec);
              // Blend BM25 rank score with dense cosine
              return { docId: r.docId, score: r.score * 0.55 + Math.max(0, cos) * 0.45 };
            })
            .sort((a, b) => b.score - a.score);
        }
      } catch (err) {
        console.warn('[CachedFusedRetriever] dense rerank skipped:', err);
      }
    }

    // Patient-conditioned boosts for NLU relevance:
    // condition/med token overlap + caregiver feedback on this patient's corpus.
    const conditionTokens = new Set(
      [...q.conditions, ...this.patientConditions]
        .flatMap((c) => c.toLowerCase().split(/[^a-z0-9]+/))
        .filter((t) => t.length >= 3),
    );
    const medTokens = new Set(
      [...q.activeMeds, ...(this.options.activeMeds ?? [])]
        .flatMap((m) => m.toLowerCase().split(/[^a-z0-9]+/))
        .filter((t) => t.length >= 3),
    );

    const rankedChunks: RetrievedChunk[] = chunkRank
      .map((r): RetrievedChunk | null => {
        const chunk = this.chunkMap.get(r.docId);
        if (!chunk) return null;
        // Hard isolation: never return another patient's chunk.
        if (chunk.patientId && this.patientId && chunk.patientId !== this.patientId) {
          return null;
        }
        const rel = relationByDoc.get(r.docId);
        const hay = `${chunk.docId} ${chunk.text}`.toLowerCase();
        let boost = 0;
        for (const t of conditionTokens) {
          if (hay.includes(t)) boost += 0.08;
        }
        for (const t of medTokens) {
          if (hay.includes(t)) boost += 0.06;
        }
        // feedbackScore lives on KnowledgeChunk → RetrievedChunk via map if present
        const fb = (chunk as RetrievedChunk & { feedbackScore?: number }).feedbackScore ?? 0;
        boost += fb * 0.25;
        // Cap boost so BM25 remains primary
        boost = Math.max(-0.4, Math.min(0.6, boost));
        return {
          ...chunk,
          score: r.score * (1 + boost),
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
      .filter((c): c is RetrievedChunk => Boolean(c))
      .sort((a, b) => b.score - a.score);

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
