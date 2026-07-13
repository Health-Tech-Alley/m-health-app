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
import { getAppSettings } from '@/data/repositories/appSettingsRepository';
import type {
  FusedRetriever,
  McpToolSummary,
  RetrievalQuery,
  RetrievalResult,
  RetrievedChunk,
} from '@/knowledge/types';
<<<<<<< HEAD
=======
import {
  getAllClinicalFixtures,
  getPatientPlanFixtures,
} from '@/knowledge/corpora/fixtures';
>>>>>>> 2ed5e76 (Optimize SLM prompt engineering and dynamic load behavior)
import { mergeByParent } from '@/nlu/section-chunker';

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
    const settings = getAppSettings();
    if (
      !__DEV__ ||
      settings.evidenceDevelopmentFallback !== true ||
      settings.nluDevelopmentFallback !== true
    ) {
      throw new Error('TrackAFusedRetriever is available only with explicit development fallbacks enabled');
    }
    const embedder = createDefaultEmbedder({ allowDevelopmentFallback: true });
    this.clinicalDense = new DenseIndex(embedder);
    this.toolDense = new DenseIndex(embedder);
    this.buildIndexes(options);
  }

  private async buildIndexes(options: FusedRetrieverOptions): Promise<void> {
    const {
      getAllClinicalFixtures,
      getPatientPlanFixtures,
    } = await import('@/knowledge/corpora/fixtures');
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

    // Over-fetch so parent-merge of #sN section children can still fill k.
    const kChunks = q.kChunks ?? 8;
    const overFetch = Math.max(kChunks * 3, 12);
    const clinicalBm25Rank = this.clinicalBm25.search(query, overFetch);
    const clinicalDenseRank = await this.clinicalDense.search(query, overFetch);
    const clinicalFused = reciprocalRankFusion([clinicalBm25Rank, clinicalDenseRank]);
    const rawChunks = clinicalFused
      .map((r) => {
        const chunk = this.chunkMap.get(r.docId);
        if (!chunk) return null;
        return { ...chunk, score: r.score };
      })
      .filter((c): c is RetrievedChunk => Boolean(c));
    const chunks = mergeByParent(rawChunks, 1).slice(0, kChunks);

    return {
      tools,
      chunks,
      citations: chunks.map((c) => c.docId),
      latencyMs: Math.round(performance.now() - t0),
    };
  }
}
