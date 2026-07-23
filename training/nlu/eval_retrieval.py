"""
Retrieval evaluator — measures MRR and Recall@k on retrieval-qrels.json.

Loads the qrels + document catalog, builds a mini-corpus from the catalog,
embeds with leaf-ir, and evaluates hybrid (BM25 + dense + RRF) retrieval.

Modes:
    python training/nlu/eval_retrieval.py              # default: hybrid + BM25
    python training/nlu/eval_retrieval.py --graph      # BM25 + structural expand + RRF
    python training/nlu/eval_retrieval.py --graph --bm25-only-seeds  # same but seeds only

planning/35 §8.4 + planning/36 §11 (graph expansion)
"""

import argparse
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
DEFAULT_MAX_DEGREE = 20


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
    for doc_id, tokens_ in doc_tokens.items():
        seen = set()
        for t in tokens_:
            tf[doc_id][t] += 1
            if t not in seen:
                df[t] += 1
                seen.add(t)

    scores = {}
    for doc_id, tokens_ in doc_tokens.items():
        score = 0.0
        dl = len(tokens_)
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


# ---------- Synthetic structural edges (planning/36 §11.1) ----------


def build_structural_edges(
    documents: list[dict],
    max_degree: int = DEFAULT_MAX_DEGREE,
) -> list[tuple[str, str, str, float]]:
    """Returns (from_id, to_id, type, weight). Degree-capped.
    PARENT_OF from #sN convention, SHARES_CONDITION from conditions list."""
    edges = []
    known_ids = {d["doc_id"] for d in documents}

    # PARENT_OF: if doc_id contains #s, parent is the prefix
    for doc in documents:
        doc_id = doc["doc_id"]
        if "#s" in doc_id:
            parent = doc_id.split("#s")[0]
            if parent in known_ids:
                edges.append((parent, doc_id, "PARENT_OF", 1.0))

    # SHARES_CONDITION: group by condition, connect each doc to ≤K others
    condition_to_docs = defaultdict(list)
    for doc in documents:
        for cond in doc.get("conditions", []):
            cond_lower = cond.strip().lower()
            if cond_lower:
                condition_to_docs[cond_lower].append(doc["doc_id"])

    written = set()
    for cond, doc_ids in condition_to_docs.items():
        for i, a in enumerate(doc_ids):
            connected = 0
            for b in doc_ids[i + 1:]:
                if connected >= max_degree:
                    break
                key = (a, b) if a < b else (b, a)
                if key in written:
                    continue
                written.add(key)
                edges.append((key[0], key[1], "SHARES_CONDITION", 1.0))
                connected += 1

    return edges


def expand_seeds_with_edges(
    bm25_rank: list[tuple[str, float]],
    edges: list[tuple[str, str, str, float]],
    known_doc_ids: set[str],
) -> list[tuple[str, float]]:
    """Expand BM25 seeds one hop via structural edges, then RRF fuse."""
    # graph list: seeds in BM25 order, then neighbors by score
    seed_order = {doc_id: i for i, (doc_id, _) in enumerate(bm25_rank)}
    neighbor_best: dict[str, float] = {}

    for from_id, to_id, etype, weight in edges:
        for f, t in [(from_id, to_id), (to_id, from_id)]:
            if f not in seed_order:
                continue
            if t not in known_doc_ids:
                continue
            if t in seed_order:
                continue
            seed_rank = seed_order[f]
            score = weight / (1 + seed_rank)
            prev = neighbor_best.get(t, -float("inf"))
            if score > prev:
                neighbor_best[t] = score

    graph_rank = list(bm25_rank)  # seeds keep BM25 order
    neighbors = sorted(neighbor_best.items(), key=lambda x: -x[1])
    graph_rank.extend(neighbors)

    return rrf_fusion([bm25_rank, graph_rank])


# ---------- Main ----------


def main():
    parser = argparse.ArgumentParser(description="Retrieval Evaluator")
    parser.add_argument(
        "--graph",
        action="store_true",
        help="Evaluate BM25 + structural graph expansion + RRF",
    )
    parser.add_argument(
        "--bm25-only-seeds",
        action="store_true",
        help="With --graph: restrict seeds to BM25-only (no dense prepended)",
    )
    args = parser.parse_args()

    mode_label = "BM25+graph" if args.graph else "hybrid"
    print("=" * 60)
    print(f"Retrieval Evaluator — {mode_label} mode (planning/35–36)")
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

    known_ids = set(doc_texts.keys())

    if args.graph:
        # Build synthetic structural edges
        struct_edges = build_structural_edges(documents)
        print(f"Built {len(struct_edges)} synthetic structural edges")
    else:
        struct_edges = []

    # Embed documents (skip in bm25-only-seeds mode)
    model = None
    doc_embeddings = None
    doc_ids = list(doc_texts.keys())
    if not args.bm25_only_seeds:
        print(f"\nEmbedding {len(documents)} documents with {EMBEDDER_MODEL}...")
        try:
            from sentence_transformers import SentenceTransformer

            model = SentenceTransformer(EMBEDDER_MODEL)
            doc_text_list = [doc_texts[did] for did in doc_ids]
            doc_embeddings = model.encode(doc_text_list, normalize_embeddings=True)
            print(f"  Doc embeddings: {doc_embeddings.shape}")
        except ImportError:
            print("ERROR: sentence-transformers not installed")
            if not args.graph:
                sys.exit(1)

    # Evaluate per-persona and aggregate
    personas = set(q.get("persona", "cross") for q in qrels)
    results_by_persona: dict[str, list[dict]] = {p: [] for p in personas}

    print(f"\nEvaluating {len(qrels)} queries ({mode_label})...")

    for qrel in qrels:
        query = qrel["query"]
        relevant_ids = set(qrel["relevant_doc_ids"])
        persona = qrel.get("persona", "cross")

        # BM25 search
        query_tokens = tokenize(query)
        bm25_results = bm25_search(query_tokens, doc_tokens, k=20)

        if args.graph:
            # BM25 + graph expansion + RRF
            graph_fused = expand_seeds_with_edges(bm25_results, struct_edges, known_ids)
            merged = merge_by_parent(graph_fused)
            retrieved_ids = [doc_id for doc_id, _ in merged]

            if not args.bm25_only_seeds and doc_embeddings is not None:
                # Dense search
                query_prefixed = QUERY_PREFIX + query
                query_emb = model.encode([query_prefixed], normalize_embeddings=True)[0]
                similarities = doc_embeddings @ query_emb
                dense_ranked_idx = np.argsort(-similarities)[:20]
                dense_results = [(doc_ids[i], float(similarities[i])) for i in dense_ranked_idx]

                # Hybrid + graph: BM25 + dense + graph
                fused = rrf_fusion([bm25_results, dense_results])
                hybrid_graph_fused = expand_seeds_with_edges(fused, struct_edges, known_ids)
                merged = merge_by_parent(hybrid_graph_fused)
                retrieved_ids = [doc_id for doc_id, _ in merged]
        else:
            if doc_embeddings is not None:
                # Dense search
                query_prefixed = QUERY_PREFIX + query
                query_emb = model.encode([query_prefixed], normalize_embeddings=True)[0]
                similarities = doc_embeddings @ query_emb
                dense_ranked_idx = np.argsort(-similarities)[:20]
                dense_results = [(doc_ids[i], float(similarities[i])) for i in dense_ranked_idx]

                # RRF fusion (hybrid)
                fused = rrf_fusion([bm25_results, dense_results])
            else:
                fused = bm25_results

            # Merge by parent
            merged = merge_by_parent(fused)
            retrieved_ids = [doc_id for doc_id, _ in merged]

        # Metrics
        r5 = recall_at_k(retrieved_ids, relevant_ids, 5)
        r8 = recall_at_k(retrieved_ids, relevant_ids, 8)
        mrr_score = mrr(retrieved_ids, relevant_ids)

        results_by_persona[persona].append({
            "query_id": qrel["id"],
            "recall_at_5": r5,
            "recall_at_8": r8,
            "mrr": mrr_score,
        })

    # Aggregate results
    print("\n" + "=" * 60)
    print(f"RESULTS — {mode_label}")
    print("=" * 60)

    all_r5 = []
    all_r8 = []
    all_mrr = []

    for persona in sorted(results_by_persona.keys()):
        results = results_by_persona[persona]
        if not results:
            continue
        r5 = np.mean([r["recall_at_5"] for r in results])
        r8 = np.mean([r["recall_at_8"] for r in results])
        m = np.mean([r["mrr"] for r in results])
        all_r5.extend([r["recall_at_5"] for r in results])
        all_r8.extend([r["recall_at_8"] for r in results])
        all_mrr.extend([r["mrr"] for r in results])
        print(f"  {persona:10s}  R@5={r5:.4f}  R@8={r8:.4f}  MRR={m:.4f}  (n={len(results)})")

    overall_r5 = np.mean(all_r5) if all_r5 else 0
    overall_r8 = np.mean(all_r8) if all_r8 else 0
    overall_mrr = np.mean(all_mrr) if all_mrr else 0
    print(f"\n  {'OVERALL':10s}  R@5={overall_r5:.4f}  R@8={overall_r8:.4f}  MRR={overall_mrr:.4f}  (n={len(all_r5)})")

    # BM25-only baseline (always run)
    print("\n  --- BM25-only baseline ---")
    bm25_r5_all = []
    bm25_r8_all = []
    bm25_mrr_all = []
    for qrel in qrels:
        query_tokens = tokenize(qrel["query"])
        relevant_ids = set(qrel["relevant_doc_ids"])
        bm25_results = bm25_search(query_tokens, doc_tokens, k=20)
        merged = merge_by_parent(bm25_results)
        retrieved_ids = [doc_id for doc_id, _ in merged]
        bm25_r5_all.append(recall_at_k(retrieved_ids, relevant_ids, 5))
        bm25_r8_all.append(recall_at_k(retrieved_ids, relevant_ids, 8))
        bm25_mrr_all.append(mrr(retrieved_ids, relevant_ids))

    bm25_r5 = np.mean(bm25_r5_all)
    bm25_r8 = np.mean(bm25_r8_all)
    bm25_mrr = np.mean(bm25_mrr_all)
    print(f"  {'BM25':10s}  R@5={bm25_r5:.4f}  R@8={bm25_r8:.4f}  MRR={bm25_mrr:.4f}")

    # Comparison table
    print(f"\n  --- {mode_label} vs BM25 ---")
    print(f"  R@5:  {mode_label}={overall_r5:.4f} vs BM25={bm25_r5:.4f} "
          f"({'PASS' if overall_r5 >= bm25_r5 else 'FAIL'})")
    print(f"  R@8:  {mode_label}={overall_r8:.4f} vs BM25={bm25_r8:.4f} "
          f"({'PASS' if overall_r8 >= bm25_r8 else 'FAIL'})")
    print(f"  MRR:  {mode_label}={overall_mrr:.4f} vs BM25={bm25_mrr:.4f} "
          f"({'PASS' if overall_mrr >= bm25_mrr else 'FAIL'})")
    print("=" * 60)

    return 0 if (overall_r5 >= bm25_r5 and overall_mrr >= bm25_mrr) else 1


if __name__ == "__main__":
    sys.exit(main())
