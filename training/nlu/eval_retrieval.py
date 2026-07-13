"""
Retrieval evaluator — measures MRR and Recall@k on retrieval-qrels.json.

Loads the qrels + document catalog, builds a mini-corpus from the catalog,
embeds with leaf-ir, and evaluates hybrid (BM25 + dense + RRF) retrieval.

planning/35 §8.4
"""

import json
import sys
import re
from pathlib import Path
from collections import defaultdict

import numpy as np

QRELS_PATH = Path(__file__).resolve().parent.parent.parent / "planning" / "nlu-training" / "retrieval-qrels.json"
EMBEDDER_MODEL = "MongoDB/mdbr-leaf-ir"
DIM = 768
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


def tokenize(text: str) -> list[str]:
    """Simple whitespace + punctuation tokenizer."""
    return re.sub(r"[^a-z0-9\s]", " ", text.lower()).split()


def bm25_search(
    query_tokens: list[str],
    doc_tokens: dict[str, list[str]],
    k: int = 10,
    k1: float = 1.5,
    b: float = 0.75,
) -> list[tuple[str, float]]:
    """BM25 search over tokenized documents."""
    N = len(doc_tokens)
    if N == 0:
        return []

    avg_dl = np.mean([len(t) for t in doc_tokens.values()])

    # Document frequency
    df = defaultdict(int)
    tf = defaultdict(lambda: defaultdict(int))
    for doc_id, tokens in doc_tokens.items():
        seen = set()
        for t in tokens:
            tf[doc_id][t] += 1
            if t not in seen:
                df[t] += 1
                seen.add(t)

    scores = {}
    for doc_id, tokens in doc_tokens.items():
        score = 0.0
        dl = len(tokens)
        for qt in query_tokens:
            if qt not in df:
                continue
            idf = np.log(1 + (N - df[qt] + 0.5) / (df[qt] + 0.5))
            term_tf = tf[doc_id].get(qt, 0)
            denom = term_tf + k1 * (1 - b + b * dl / avg_dl)
            score += idf * (term_tf * (k1 + 1)) / denom
        if score > 0:
            scores[doc_id] = score

    ranked = sorted(scores.items(), key=lambda x: -x[1])[:k]
    return ranked


def rrf_fusion(
    rankings: list[list[tuple[str, float]]], k: int = 60
) -> list[tuple[str, float]]:
    """Reciprocal Rank Fusion."""
    scores = defaultdict(float)
    for ranking in rankings:
        for rank, (doc_id, _) in enumerate(ranking):
            scores[doc_id] += 1 / (k + rank + 1)
    return sorted(scores.items(), key=lambda x: -x[1])


def merge_by_parent(scored: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Merge section children by parent doc ID. Score = max(child scores)."""
    parent_scores = {}
    for doc_id, score in scored:
        parent_id = doc_id.split("#s")[0] if "#s" in doc_id else doc_id
        if parent_id not in parent_scores or score > parent_scores[parent_id]:
            parent_scores[parent_id] = score
    return sorted(parent_scores.items(), key=lambda x: -x[1])


def recall_at_k(retrieved_ids: list[str], relevant_ids: set[str], k: int) -> float:
    """Recall@k: fraction of relevant docs in top-k."""
    top_k = retrieved_ids[:k]
    hits = sum(1 for doc_id in top_k if doc_id in relevant_ids)
    return hits / len(relevant_ids) if relevant_ids else 0


def mrr(retrieved_ids: list[str], relevant_ids: set[str]) -> float:
    """Mean Reciprocal Rank."""
    for i, doc_id in enumerate(retrieved_ids):
        if doc_id in relevant_ids:
            return 1 / (i + 1)
    return 0


def main():
    print("=" * 60)
    print("Retrieval Evaluator (planning/35 §8.4)")
    print("=" * 60)

    # Load qrels
    with open(QRELS_PATH, "r") as f:
        data = json.load(f)

    documents = data["documents"]
    qrels = data["qrels"]
    print(f"\nLoaded {len(documents)} documents, {len(qrels)} qrels")

    # Build document text from catalog (topics + conditions)
    doc_texts: dict[str, str] = {}
    doc_tokens: dict[str, list[str]] = {}
    for doc in documents:
        doc_id = doc["doc_id"]
        text = " ".join(doc.get("topics", []) + doc.get("conditions", []))
        doc_texts[doc_id] = text
        doc_tokens[doc_id] = tokenize(text)

    # Embed documents
    print(f"\nEmbedding {len(documents)} documents with {EMBEDDER_MODEL}...")
    try:
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer(EMBEDDER_MODEL)
        # No query prefix on documents
        doc_ids = list(doc_texts.keys())
        doc_text_list = [doc_texts[did] for did in doc_ids]
        doc_embeddings = model.encode(doc_text_list, normalize_embeddings=True)
        print(f"  Doc embeddings: {doc_embeddings.shape}")
    except ImportError:
        print("ERROR: sentence-transformers not installed")
        sys.exit(1)

    # Evaluate per-persona and aggregate
    personas = set(q.get("persona", "cross") for q in qrels)
    results_by_persona: dict[str, list[dict]] = {p: [] for p in personas}

    print(f"\nEvaluating {len(qrels)} queries...")

    for qrel in qrels:
        query = qrel["query"]
        relevant_ids = set(qrel["relevant_doc_ids"])
        persona = qrel.get("persona", "cross")

        # BM25 search
        query_tokens = tokenize(query)
        bm25_results = bm25_search(query_tokens, doc_tokens, k=20)

        # Dense search
        query_prefixed = QUERY_PREFIX + query
        query_emb = model.encode([query_prefixed], normalize_embeddings=True)[0]
        similarities = doc_embeddings @ query_emb
        dense_ranked_idx = np.argsort(-similarities)[:20]
        dense_results = [(doc_ids[i], float(similarities[i])) for i in dense_ranked_idx]

        # RRF fusion
        fused = rrf_fusion([bm25_results, dense_results])

        # Merge by parent
        merged = merge_by_parent(fused)
        retrieved_ids = [doc_id for doc_id, _ in merged]

        # Metrics
        r5 = recall_at_k(retrieved_ids, relevant_ids, 5)
        mrr_score = mrr(retrieved_ids, relevant_ids)

        results_by_persona[persona].append({
            "query_id": qrel["id"],
            "recall_at_5": r5,
            "mrr": mrr_score,
        })

    # Aggregate
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)

    all_r5 = []
    all_mrr = []

    for persona in sorted(results_by_persona.keys()):
        results = results_by_persona[persona]
        if not results:
            continue
        r5 = np.mean([r["recall_at_5"] for r in results])
        m = np.mean([r["mrr"] for r in results])
        all_r5.extend([r["recall_at_5"] for r in results])
        all_mrr.extend([r["mrr"] for r in results])
        print(f"  {persona:10s}  Recall@5={r5:.4f}  MRR={m:.4f}  (n={len(results)})")

    overall_r5 = np.mean(all_r5)
    overall_mrr = np.mean(all_mrr)
    print(f"\n  {'OVERALL':10s}  Recall@5={overall_r5:.4f}  MRR={overall_mrr:.4f}  (n={len(all_r5)})")

    # BM25-only baseline
    print("\n  --- BM25-only baseline ---")
    bm25_r5_all = []
    bm25_mrr_all = []
    for qrel in qrels:
        query_tokens = tokenize(qrel["query"])
        relevant_ids = set(qrel["relevant_doc_ids"])
        bm25_results = bm25_search(query_tokens, doc_tokens, k=20)
        merged = merge_by_parent(bm25_results)
        retrieved_ids = [doc_id for doc_id, _ in merged]
        bm25_r5_all.append(recall_at_k(retrieved_ids, relevant_ids, 5))
        bm25_mrr_all.append(mrr(retrieved_ids, relevant_ids))

    bm25_r5 = np.mean(bm25_r5_all)
    bm25_mrr = np.mean(bm25_mrr_all)
    print(f"  {'BM25':10s}  Recall@5={bm25_r5:.4f}  MRR={bm25_mrr:.4f}")

    print("\n  --- Hybrid vs BM25 ---")
    print(f"  Recall@5: hybrid={overall_r5:.4f} vs BM25={bm25_r5:.4f} ({'PASS' if overall_r5 > bm25_r5 else 'FAIL'})")
    print(f"  MRR:      hybrid={overall_mrr:.4f} vs BM25={bm25_mrr:.4f} ({'PASS' if overall_mrr > bm25_mrr else 'FAIL'})")
    print("=" * 60)

    return 0 if (overall_r5 > bm25_r5 and overall_mrr > bm25_mrr) else 1


if __name__ == "__main__":
    sys.exit(main())
