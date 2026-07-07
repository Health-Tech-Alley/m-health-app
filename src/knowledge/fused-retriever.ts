/**
 * Fused retriever: one entry point that returns both MCP tool schemas and
 * clinical knowledge chunks in a single retrieval hop.
 *
 * Track A uses in-memory BM25 + a deterministic hash embedder + RRF over
 * synthetic fixtures. Track B will swap the embedder and corpora for real
 * models and live NLM / FDA / ClinicalTrials.gov clients.
 */

import { Bm25Index } from '@/knowledge/bm25-index';
import { DenseIndex } from '@/knowledge/dense-index';
import { createDefaultEmbedder } from '@/knowledge/embedder';
import { reciprocalRankFusion } from '@/knowledge/rrf';
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

export type FusedRetrieverOptions = {
  tools: McpToolSummary[];
  patientName?: string;
  patientConditions?: string[];
  activeMeds?: string[];
  spo2Cutoff?: string;
};

export class TrackAFusedRetriever implements FusedRetriever {
  private clinicalBm25 = new Bm25Index();
  private clinicalDense: DenseIndex;
  private toolBm25 = new Bm25Index();
  private toolDense: DenseIndex;
  private toolMap = new Map<string, McpToolSummary>();
  private chunkMap = new Map<string, RetrievedChunk>();
  private ready = false;

  constructor(options: FusedRetrieverOptions) {
    const embedder = createDefaultEmbedder();
    this.clinicalDense = new DenseIndex(embedder);
    this.toolDense = new DenseIndex(embedder);
    this.buildIndexes(options);
  }

  private async buildIndexes(options: FusedRetrieverOptions): Promise<void> {
    const clinicalChunks = [
      ...getAllClinicalFixtures(),
      ...getPatientPlanFixtures(
        options.patientName ?? 'the patient',
        options.patientConditions ?? [],
        options.activeMeds ?? [],
        options.spo2Cutoff,
      ),
    ];

    for (const c of clinicalChunks) {
      this.chunkMap.set(c.docId, c);
    }

    const clinicalDocs = clinicalChunks.map((c) => ({
      docId: c.docId,
      text: `${c.docId} ${c.text}`,
    }));
    this.clinicalBm25.add(clinicalDocs);
    await this.clinicalDense.add(clinicalDocs);

    const toolDocs = options.tools.map((t) => ({
      docId: t.name,
      text: `${t.name} ${t.description}`,
    }));
    for (const t of options.tools) {
      this.toolMap.set(t.name, t);
    }
    this.toolBm25.add(toolDocs);
    await this.toolDense.add(toolDocs);

    this.ready = true;
  }

  async retrieve(q: RetrievalQuery): Promise<RetrievalResult> {
    if (!this.ready) {
      // Index building is async; if called too early, wait briefly.
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (!this.ready) {
        return { tools: [], chunks: [], citations: [], latencyMs: 0 };
      }
    }

    const t0 = performance.now();
    const query = [q.intent, ...q.conditions, ...q.activeMeds].join(' ');

    const toolBm25Rank = this.toolBm25.search(query, q.kTools ?? 3);
    const toolDenseRank = await this.toolDense.search(query, q.kTools ?? 3);
    const toolFused = reciprocalRankFusion([toolBm25Rank, toolDenseRank]);
    const tools = toolFused
      .map((r) => this.toolMap.get(r.docId))
      .filter((t): t is McpToolSummary => Boolean(t));

    const clinicalBm25Rank = this.clinicalBm25.search(query, q.kChunks ?? 8);
    const clinicalDenseRank = await this.clinicalDense.search(query, q.kChunks ?? 8);
    const clinicalFused = reciprocalRankFusion([clinicalBm25Rank, clinicalDenseRank]);
    const chunks = clinicalFused
      .slice(0, q.kChunks ?? 8)
      .map((r) => {
        const chunk = this.chunkMap.get(r.docId);
        if (!chunk) return null;
        return { ...chunk, score: r.score };
      })
      .filter((c): c is RetrievedChunk => Boolean(c));

    return {
      tools,
      chunks,
      citations: chunks.map((c) => c.docId),
      latencyMs: Math.round(performance.now() - t0),
    };
  }
}
