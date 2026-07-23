/**
 * Tiny in-memory BM25 index for sparse retrieval.
 */

export type Bm25Document = {
  docId: string;
  text: string;
};

export class Bm25Index {
  private docs: Bm25Document[] = [];
  private termFrequency: Map<string, Map<number, number>> = new Map();
  private documentFrequency: Map<string, number> = new Map();
  private avgDocLen = 0;
  private readonly k1 = 1.5;
  private readonly b = 0.75;

  add(docs: Bm25Document[]): void {
    for (const doc of docs) {
      const idx = this.docs.length;
      this.docs.push(doc);
      const tokens = tokenize(doc.text);
      const freqs = new Map<string, number>();
      for (const t of tokens) {
        freqs.set(t, (freqs.get(t) ?? 0) + 1);
      }
      for (const [term, count] of freqs.entries()) {
        const docMap = this.termFrequency.get(term) ?? new Map<number, number>();
        docMap.set(idx, count);
        this.termFrequency.set(term, docMap);
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
    }
    const totalLen = this.docs.reduce((sum, d) => sum + tokenize(d.text).length, 0);
    this.avgDocLen = this.docs.length ? totalLen / this.docs.length : 0;
  }

  search(query: string, k = 10): { docId: string; score: number }[] {
    const tokens = tokenize(query);
    const scores = new Array(this.docs.length).fill(0);
    const N = this.docs.length;

    for (const term of tokens) {
      const df = this.documentFrequency.get(term) ?? 0;
      if (df === 0) continue;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const docMap = this.termFrequency.get(term);
      if (!docMap) continue;
      for (const [docIdx, tf] of docMap.entries()) {
        const docLen = tokenize(this.docs[docIdx].text).length;
        const denom = tf + this.k1 * (1 - this.b + this.b * (docLen / (this.avgDocLen || 1)));
        scores[docIdx] += idf * ((tf * (this.k1 + 1)) / denom);
      }
    }

    return scores
      .map((score, idx) => ({ docId: this.docs[idx].docId, score }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}
