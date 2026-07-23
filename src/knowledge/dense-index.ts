/**
 * In-memory dense vector index using a pluggable embedder.
 */

import { cosineSimilarity } from './embedder';
import type { Embedder } from './types';

export type DenseDocument = {
  docId: string;
  text: string;
  vector?: number[];
};

export class DenseIndex {
  private docs: DenseDocument[] = [];
  private embedder: Embedder;

  constructor(embedder: Embedder) {
    this.embedder = embedder;
  }

  async add(docs: DenseDocument[]): Promise<void> {
    for (const doc of docs) {
      const vector = doc.vector ?? (await this.embedder.embed(doc.text));
      this.docs.push({ ...doc, vector });
    }
  }

  async search(query: string, k = 10): Promise<{ docId: string; score: number }[]> {
    // leaf-ir requires the IR query prefix on query strings only (docs already
    // embedded without it in add()).
    const qVec = await this.embedder.embed(query, { isQuery: true });
    const scored = this.docs
      .filter((d) => d.vector)
      .map((d) => ({ docId: d.docId, score: cosineSimilarity(qVec, d.vector!) }))
      .filter((r) => Number.isFinite(r.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    return scored;
  }
}
