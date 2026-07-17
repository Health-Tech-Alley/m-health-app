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
  getAllClinicalFixtures,
  getPatientPlanFixtures,
} from '@/knowledge/corpora/fixtures';
import { getAllCpgFixtures } from '@/knowledge/corpora/cpg-fixtures';
import {
  getAllKnowledgeChunks,
  clearExpiredKnowledgeChunks,
} from '@/data/repositories/knowledgeCacheRepository';
import type { KnowledgeChunk } from '@/data/types';
import { liveSupplement } from '@/clinical-evidence/condition-bundler';

const LIVE_SUPPLEMENT_THRESHOLD = 3;

function knowledgeChunkToRetrievedChunk(chunk: KnowledgeChunk, score: number): RetrievedChunk {
  return {
    docId: chunk.chunkId,
    text: chunk.text,
    score,
    source: chunk.source as RetrievedChunk['source'],
    documentType: chunk.documentType as RetrievedChunk['documentType'],
    lengthTier: chunk.lengthTier as RetrievedChunk['lengthTier'],
    sectionHeading: chunk.sectionHeading,
  };
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
    const cachedChunks = getAllKnowledgeChunks();

    // Combine: synthetic fixtures (fallback) + cached clinical chunks
    const fixtureChunks = [
      ...getAllClinicalFixtures(),
      ...getAllCpgFixtures(),
      ...getPatientPlanFixtures(
        options.patientName ?? 'the patient',
        options.patientConditions ?? [],
        options.activeMeds ?? [],
        options.spo2Cutoff,
      ),
    ];

    // Build a combined set — fixtures first (lower priority), then cached
    const allChunks: { docId: string; text: string; chunk: RetrievedChunk }[] = [];

    for (const c of fixtureChunks) {
      const retrieved: RetrievedChunk = { ...c, score: 0 };
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

    // Tool search (BM25 only)
    const toolRank = this.toolBm25.search(query, q.kTools ?? 3);
    const tools = toolRank
      .map((r) => this.toolMap.get(r.docId))
      .filter((t): t is McpToolSummary => Boolean(t));

    // Clinical chunk search (BM25 only)
    let chunkRank = this.clinicalBm25.search(query, q.kChunks ?? 8);
    let chunks = chunkRank
      .slice(0, q.kChunks ?? 8)
      .map((r) => {
        const chunk = this.chunkMap.get(r.docId);
        if (!chunk) return null;
        return { ...chunk, score: r.score };
      })
      .filter((c): c is RetrievedChunk => Boolean(c));

    // Live supplement if insufficient results
    if (
      chunks.length < LIVE_SUPPLEMENT_THRESHOLD &&
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
          // Add new chunks to the index
          const newDocs = supplemented.map((c) => ({
            docId: c.chunkId,
            text: `${c.chunkId} ${c.text}`,
          }));
          this.clinicalBm25.add(newDocs);
          for (const c of supplemented) {
            const retrieved = knowledgeChunkToRetrievedChunk(c, 0);
            this.chunkMap.set(c.chunkId, retrieved);
          }

          // Re-search with the augmented index
          chunkRank = this.clinicalBm25.search(query, q.kChunks ?? 8);
          chunks = chunkRank
            .slice(0, q.kChunks ?? 8)
            .map((r) => {
              const chunk = this.chunkMap.get(r.docId);
              if (!chunk) return null;
              return { ...chunk, score: r.score };
            })
            .filter((c): c is RetrievedChunk => Boolean(c));
        }
      } catch (err) {
        console.error('[CachedFusedRetriever] Live supplement failed:', err);
      }
    }

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
