/**
 * Reciprocal Rank Fusion (RRF).
 *
 * Combines ranked lists from different retrieval methods into a single score.
 * k=60 is the classic RRF constant.
 */

export function reciprocalRankFusion(
  rankings: { docId: string; score: number }[][],
  k = 60,
): { docId: string; score: number }[] {
  const scores = new Map<string, number>();

  for (const list of rankings) {
    for (let rank = 0; rank < list.length; rank++) {
      const docId = list[rank].docId;
      const add = 1 / (k + rank + 1);
      scores.set(docId, (scores.get(docId) ?? 0) + add);
    }
  }

  return Array.from(scores.entries())
    .map(([docId, score]) => ({ docId, score }))
    .sort((a, b) => b.score - a.score);
}
