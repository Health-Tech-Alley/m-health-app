"""
Intent head trainer — trains a linear classifier on frozen leaf-ir embeddings.

Loads utterances-800.json, embeds each text with MongoDB/mdbr-leaf-ir,
fits a multinomial logistic regression, and exports intent-head.json.

planning/35 §8.3
"""

import json
import sys
import os
import hashlib
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

# --- Configuration ---
UTTERANCES_PATH = Path(__file__).resolve().parent.parent.parent / "planning" / "nlu-training" / "utterances-800.json"
OUTPUT_PATH = Path(__file__).resolve().parent.parent.parent / "assets" / "models" / "nlu" / "intent-head.json"
MIN_UTTERANCES = 800
EMBEDDER_MODEL = "MongoDB/mdbr-leaf-ir"
DIM = 768
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
TRAIN_RATIO = 0.8
RANDOM_SEED = 42
LABEL_SET = [
    "knowledge_qa",
    "vitals_what_if",
    "med_check",
    "explain_anomaly",
    "clarifying_qa",
    "next_steps",
    "schedule_care",
    "visit_prep",
    "portal_draft",
    "summarize_ehr",
    "detect_care_gaps",
    "draft_care_plan",
    "caregiver_chat_general",
    "other",
]

# Quality bar from planning/35 §7.3
MIN_OVERALL_ACCURACY = 0.85
MIN_MACRO_F1 = 0.80
MIN_VITALS_PRECISION = 0.90
MIN_KNOWLEDGE_QA_RECALL = 0.80
MIN_PER_PERSONA_ACCURACY = 0.75


def load_utterances(path: Path) -> list[dict]:
    """Load and validate utterances from JSON."""
    with open(path, "r") as f:
        data = json.load(f)

    assert data["count"] >= MIN_UTTERANCES, f"Expected ≥{MIN_UTTERANCES} utterances, got {data['count']}"
    assert set(data["label_set"]) == set(LABEL_SET), "Label set mismatch"

    utterances = data["utterances"]
    assert len(utterances) == data["count"], f"count field {data['count']} != len {len(utterances)}"
    assert len(utterances) >= MIN_UTTERANCES, f"Expected ≥{MIN_UTTERANCES} items, got {len(utterances)}"

    # Validate all labels are in label_set
    for u in utterances:
        assert u["label"] in LABEL_SET, f"Unknown label: {u['label']}"

    return utterances


def stratified_split(
    utterances: list[dict], train_ratio: float, seed: int
) -> tuple[list[dict], list[dict]]:
    """Stratified split by (label, persona)."""
    rng = np.random.RandomState(seed)

    # Group by (label, persona)
    groups: dict[tuple[str, str], list[dict]] = {}
    for u in utterances:
        key = (u["label"], u["persona"])
        groups.setdefault(key, []).append(u)

    train, holdout = [], []
    for key, items in groups.items():
        rng.shuffle(items)
        n_train = max(1, int(len(items) * train_ratio))
        train.extend(items[:n_train])
        holdout.extend(items[n_train:])

    return train, holdout


def embed_texts(texts: list[str], model_name: str, dim: int) -> np.ndarray:
    """Embed texts using SentenceTransformer with query prefix."""
    try:
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer(model_name)
        # Apply query prefix to all texts (training utterances are queries)
        prefixed = [QUERY_PREFIX + t for t in texts]
        embeddings = model.encode(prefixed, show_progress_bar=True, normalize_embeddings=True)
        assert embeddings.shape[1] == dim, f"Expected dim {dim}, got {embeddings.shape[1]}"
        return embeddings
    except ImportError:
        print("ERROR: sentence-transformers not installed. Run: pip install sentence-transformers")
        sys.exit(1)


def fit_classifier(
    X: np.ndarray, y: np.ndarray, labels: list[str]
) -> tuple[np.ndarray, np.ndarray]:
    """Fit multinomial logistic regression. Returns (W, b)."""
    try:
        from sklearn.linear_model import LogisticRegression

        # sklearn ≥1.5 multinomial is default for multiclass; multi_class kw removed in 1.8+
        # class_weight=balanced lifts minority / safety-critical labels (e.g. vitals_what_if).
        clf = LogisticRegression(
            max_iter=2000,
            solver="lbfgs",
            C=2.0,
            class_weight="balanced",
            random_state=RANDOM_SEED,
        )
        clf.fit(X, y)
        return clf.coef_, clf.intercept_
    except ImportError:
        print("ERROR: scikit-learn not installed. Run: pip install scikit-learn")
        sys.exit(1)


def evaluate(
    X: np.ndarray, y: np.ndarray, W: np.ndarray, b: np.ndarray, labels: list[str]
) -> dict:
    """Evaluate classifier on holdout set."""
    # Compute predictions
    logits = X @ W.T + b
    # Softmax
    exp_logits = np.exp(logits - logits.max(axis=1, keepdims=True))
    probs = exp_logits / exp_logits.sum(axis=1, keepdims=True)

    preds = probs.argmax(axis=1)
    y_labels = [labels[yi] for yi in y]
    pred_labels = [labels[pi] for pi in preds]

    # Overall accuracy
    accuracy = (preds == y).mean()

    # Per-class metrics
    from collections import Counter

    class_metrics = {}
    for i, label in enumerate(labels):
        tp = ((preds == i) & (y == i)).sum()
        fp = ((preds == i) & (y != i)).sum()
        fn = ((preds != i) & (y == i)).sum()
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
        class_metrics[label] = {"precision": precision, "recall": recall, "f1": f1}

    # Macro F1
    macro_f1 = np.mean([m["f1"] for m in class_metrics.values()])

    # Per-persona accuracy (from holdout metadata)
    # Note: we need the original utterance objects for persona info
    # This is computed in the main function

    return {
        "accuracy": accuracy,
        "macro_f1": macro_f1,
        "class_metrics": class_metrics,
        "confusion": {
            pred_labels[i]: y_labels[i]
            for i in range(len(y_labels))
            if pred_labels[i] != y_labels[i]
        },
    }


def main():
    print("=" * 60)
    print("Intent Head Trainer (planning/35 §8.3)")
    print("=" * 60)

    # 1. Load utterances
    print(f"\nLoading utterances from {UTTERANCES_PATH}...")
    utterances = load_utterances(UTTERANCES_PATH)
    print(f"  Loaded {len(utterances)} utterances")

    # 2. Stratified split
    print(f"\nSplitting {TRAIN_RATIO:.0%} train / {1-TRAIN_RATIO:.0%} holdout (seed={RANDOM_SEED})...")
    train_utt, holdout_utt = stratified_split(utterances, TRAIN_RATIO, RANDOM_SEED)
    print(f"  Train: {len(train_utt)}, Holdout: {len(holdout_utt)}")

    # Verify all personas in holdout
    holdout_personas = set(u["persona"] for u in holdout_utt)
    print(f"  Holdout personas: {holdout_personas}")

    # 3. Embed
    print(f"\nEmbedding with {EMBEDDER_MODEL} (dim={DIM})...")
    train_texts = [u["text"] for u in train_utt]
    holdout_texts = [u["text"] for u in holdout_utt]

    X_train = embed_texts(train_texts, EMBEDDER_MODEL, DIM)
    X_holdout = embed_texts(holdout_texts, EMBEDDER_MODEL, DIM)
    print(f"  Train embeddings: {X_train.shape}")
    print(f"  Holdout embeddings: {X_holdout.shape}")

    # 4. Encode labels
    label_to_idx = {label: i for i, label in enumerate(LABEL_SET)}
    y_train = np.array([label_to_idx[u["label"]] for u in train_utt])
    y_holdout = np.array([label_to_idx[u["label"]] for u in holdout_utt])

    # 5. Fit classifier
    print("\nFitting multinomial logistic regression...")
    W, b = fit_classifier(X_train, y_train, LABEL_SET)
    print(f"  W shape: {W.shape}, b shape: {b.shape}")

    # 6. Evaluate
    print("\nEvaluating on holdout...")
    metrics = evaluate(X_holdout, y_holdout, W, b, LABEL_SET)

    print(f"\n  Overall accuracy: {metrics['accuracy']:.4f} (target: ≥{MIN_OVERALL_ACCURACY})")
    print(f"  Macro F1:         {metrics['macro_f1']:.4f} (target: ≥{MIN_MACRO_F1})")

    # Per-class highlights
    vitals_prec = metrics["class_metrics"]["vitals_what_if"]["precision"]
    kq_recall = metrics["class_metrics"]["knowledge_qa"]["recall"]
    print(f"  vitals_what_if precision: {vitals_prec:.4f} (target: ≥{MIN_VITALS_PRECISION})")
    print(f"  knowledge_qa recall:      {kq_recall:.4f} (target: ≥{MIN_KNOWLEDGE_QA_RECALL})")

    # Per-persona accuracy
    persona_correct: dict[str, int] = {}
    persona_total: dict[str, int] = {}
    for i, u in enumerate(holdout_utt):
        p = u["persona"]
        persona_total[p] = persona_total.get(p, 0) + 1
        pred_idx = (X_holdout[i] @ W.T + b).argmax()
        if pred_idx == label_to_idx[u["label"]]:
            persona_correct[p] = persona_correct.get(p, 0) + 1

    print("\n  Per-persona accuracy:")
    all_pass = True
    for persona in sorted(persona_total.keys()):
        acc = persona_correct.get(persona, 0) / persona_total[persona]
        status = "PASS" if acc >= MIN_PER_PERSONA_ACCURACY else "FAIL"
        if acc < MIN_PER_PERSONA_ACCURACY:
            all_pass = False
        print(f"    {persona}: {acc:.4f} ({status})")

    # 7. Export
    train_ids = [u["id"] for u in train_utt]
    holdout_ids = [u["id"] for u in holdout_utt]

    output = {
        "version": "1.0",
        "labels": LABEL_SET,
        "dim": DIM,
        "W": W.tolist(),
        "b": b.tolist(),
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "sourceCorpus": f"utterances-800@v1.1({len(utterances)})",
        "embedder": EMBEDDER_MODEL,
        "trainIds": train_ids,
        "holdoutIds": holdout_ids,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nExported to {OUTPUT_PATH}")
    print(f"  File size: {OUTPUT_PATH.stat().st_size / 1024:.1f} KB")

    # 8. Quality gate
    print("\n" + "=" * 60)
    passed = True
    if metrics["accuracy"] < MIN_OVERALL_ACCURACY:
        print(f"  FAIL: accuracy {metrics['accuracy']:.4f} < {MIN_OVERALL_ACCURACY}")
        passed = False
    if metrics["macro_f1"] < MIN_MACRO_F1:
        print(f"  FAIL: macro_f1 {metrics['macro_f1']:.4f} < {MIN_MACRO_F1}")
        passed = False
    if vitals_prec < MIN_VITALS_PRECISION:
        print(f"  FAIL: vitals_what_if precision {vitals_prec:.4f} < {MIN_VITALS_PRECISION}")
        passed = False
    if kq_recall < MIN_KNOWLEDGE_QA_RECALL:
        print(f"  FAIL: knowledge_qa recall {kq_recall:.4f} < {MIN_KNOWLEDGE_QA_RECALL}")
        passed = False
    if not all_pass:
        print(f"  FAIL: per-persona accuracy < {MIN_PER_PERSONA_ACCURACY}")
        passed = False

    if passed:
        print("  ALL GATES PASSED")
    else:
        print("  SOME GATES FAILED — review utterances or adjust thresholds")
    print("=" * 60)

    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
