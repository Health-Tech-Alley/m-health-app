"""
Re-evaluate the Care intent head on the holdout split recorded in care-intent-head.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
UTTERANCES_PATH = ROOT / "planning" / "nlu-training" / "care-utterances-v1.json"
HEAD_PATH = ROOT / "assets" / "models" / "nlu" / "care-intent-head.json"
EMBEDDER_MODEL = "MongoDB/mdbr-leaf-ir"
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


def main() -> int:
    with open(HEAD_PATH, encoding="utf-8") as f:
        head = json.load(f)
    with open(UTTERANCES_PATH, encoding="utf-8") as f:
        corpus = json.load(f)

    by_id = {u["id"]: u for u in corpus["utterances"]}
    holdout_ids = head.get("holdoutIds") or []
    if not holdout_ids:
        print("No holdoutIds in care-intent-head.json")
        return 1

    holdout = [by_id[i] for i in holdout_ids if i in by_id]
    labels = head["labels"]
    label_to_idx = {l: i for i, l in enumerate(labels)}
    W = np.array(head["W"], dtype=np.float64)
    b = np.array(head["b"], dtype=np.float64)

    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(head.get("embedder") or EMBEDDER_MODEL)
    texts = [QUERY_PREFIX + u["text"] for u in holdout]
    X = model.encode(texts, show_progress_bar=True, normalize_embeddings=True)
    y = np.array([label_to_idx[u["label"]] for u in holdout])

    logits = X @ W.T + b
    preds = logits.argmax(axis=1)
    acc = float((preds == y).mean())
    print(f"Holdout n={len(holdout)} accuracy={acc:.4f}")

    for i, label in enumerate(labels):
        tp = int(((preds == i) & (y == i)).sum())
        fp = int(((preds == i) & (y != i)).sum())
        fn = int(((preds != i) & (y == i)).sum())
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        print(f"  {label:32s} P={prec:.3f} R={rec:.3f} support={int((y == i).sum())}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
