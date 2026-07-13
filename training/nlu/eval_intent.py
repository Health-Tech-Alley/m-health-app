"""
Intent head evaluator — re-runs holdout metrics from intent-head.json.

planning/35 §8.3 (optional re-run)
"""

import json
import sys
from pathlib import Path

import numpy as np

UTTERANCES_PATH = Path(__file__).resolve().parent.parent.parent / "planning" / "nlu-training" / "utterances-800.json"
INTENT_HEAD_PATH = Path(__file__).resolve().parent.parent.parent / "assets" / "models" / "nlu" / "intent-head.json"
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


def softmax(logits: np.ndarray) -> np.ndarray:
    exp = np.exp(logits - logits.max(axis=1, keepdims=True))
    return exp / exp.sum(axis=1, keepdims=True)


def main():
    # Load intent head
    with open(INTENT_HEAD_PATH, "r") as f:
        head = json.load(f)

    W = np.array(head["W"])
    b = np.array(head["b"])
    labels = head["labels"]
    holdout_ids = set(head.get("holdoutIds", []))

    print(f"Intent head: dim={head['dim']}, labels={len(labels)}, trained={head['trainedAt']}")

    # Load utterances
    with open(UTTERANCES_PATH, "r") as f:
        data = json.load(f)

    # Filter to holdout
    holdout = [u for u in data["utterances"] if u["id"] in holdout_ids]
    if not holdout:
        print("No holdout IDs found in intent-head.json; evaluating all utterances.")
        holdout = data["utterances"]

    print(f"Evaluating {len(holdout)} utterances...")

    # Embed with sentence-transformers
    try:
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer(head["embedder"])
        texts = [QUERY_PREFIX + u["text"] for u in holdout]
        X = model.encode(texts, normalize_embeddings=True)
    except ImportError:
        print("ERROR: sentence-transformers not installed")
        sys.exit(1)

    # Predict
    logits = X @ W.T + b
    probs = softmax(logits)
    preds = probs.argmax(axis=1)

    label_to_idx = {l: i for i, l in enumerate(labels)}
    y = np.array([label_to_idx[u["label"]] for u in holdout])

    # Metrics
    accuracy = (preds == y).mean()
    print(f"\nOverall accuracy: {accuracy:.4f}")

    # Per-class
    for i, label in enumerate(labels):
        tp = ((preds == i) & (y == i)).sum()
        fp = ((preds == i) & (y != i)).sum()
        fn = ((preds != i) & (y == i)).sum()
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0
        if tp + fp + fn > 0:
            print(f"  {label:30s} P={prec:.3f} R={rec:.3f} F1={f1:.3f}")

    # Per-persona
    persona_correct = {}
    persona_total = {}
    for i, u in enumerate(holdout):
        p = u["persona"]
        persona_total[p] = persona_total.get(p, 0) + 1
        if preds[i] == y[i]:
            persona_correct[p] = persona_correct.get(p, 0) + 1

    print("\nPer-persona accuracy:")
    for p in sorted(persona_total):
        acc = persona_correct.get(p, 0) / persona_total[p]
        print(f"  {p}: {acc:.4f}")


if __name__ == "__main__":
    main()
