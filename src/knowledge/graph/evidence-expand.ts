/**
 * Evidence graph expansion for RAG seed expansion (doc 36).
 *
 * Given a BM25 ranked list and incident knowledge_chunk_edges, expands
 * seeds one hop and fuses the result via reciprocal rank fusion.
 */

import { reciprocalRankFusion } from '@/knowledge/rrf';
import type { KnowledgeChunkEdge } from '@/data/types';

export type RankHit = { docId: string; score: number };

export function expandSeedsWithEdges(opts: {
  bm25Rank: RankHit[];
  edges: KnowledgeChunkEdge[];
  knownDocIds: Set<string>;
}): {
  graphRank: RankHit[];
  relationByDoc: Map<string, { type: string; seedId: string }>;
} {
  const seedOrder = new Map(opts.bm25Rank.map((h, i) => [h.docId, i]));
  const relationByDoc = new Map<string, { type: string; seedId: string }>();
  const neighborBest = new Map<string, number>();

  for (const e of opts.edges) {
    const endpoints: [string, string][] = [
      [e.fromChunkId, e.toChunkId],
      [e.toChunkId, e.fromChunkId],
    ];
    for (const [from, to] of endpoints) {
      if (!seedOrder.has(from)) continue;
      if (!opts.knownDocIds.has(to)) continue;
      if (seedOrder.has(to)) continue;
      const seedRank = seedOrder.get(from)!;
      const score = e.weight / (1 + seedRank);
      const prev = neighborBest.get(to) ?? -Infinity;
      if (score > prev) {
        neighborBest.set(to, score);
        relationByDoc.set(to, { type: e.type, seedId: from });
      }
    }
  }

  const graphRank: RankHit[] = [
    ...opts.bm25Rank.map((h) => ({ docId: h.docId, score: h.score })),
    ...Array.from(neighborBest.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([docId, score]) => ({ docId, score })),
  ];

  return { graphRank, relationByDoc };
}

export function fuseBm25AndGraph(
  bm25Rank: RankHit[],
  graphRank: RankHit[],
): RankHit[] {
  return reciprocalRankFusion([bm25Rank, graphRank]);
}
