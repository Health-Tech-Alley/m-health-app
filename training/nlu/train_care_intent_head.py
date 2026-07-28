"""
Care intent head trainer — second head for Care soft-NLU (planning/40 §6.8).

Loads care-utterances-v1.json, embeds with frozen mdbr-leaf-ir (query prefix),
fits multinomial logistic regression, exports care-intent-head.json.

Mirrors train_intent_head.py; separate artifact so Concierge chat head stays intact.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
UTTERANCES_PATH = ROOT / "planning" / "nlu-training" / "care-utterances-v1.json"
OUTPUT_PATH = ROOT / "assets" / "models" / "nlu" / "care-intent-head.json"
EMBEDDER_MODEL = "MongoDB/mdbr-leaf-ir"
DIM = 768
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
TRAIN_RATIO = 0.8
RANDOM_SEED = 42

LABEL_SET = [
    "explain_uc2_alert",
    "review_monitoring_contract",
    "explain_uc3_result",
    "propose_therapy_contract_patch",
    "explain_uc4_card",
    "promote_uc4_to_plan_task",
    "suggest_todays_logging",
    "weekly_care_plan_review",
    "handoff_summary",
    "out_of_care",
]

MIN_OVERALL_ACCURACY = 0.85
MIN_MACRO_F1 = 0.80
MIN_PROMOTE_PRECISION = 0.90
MIN_OUT_OF_CARE_RECALL = 0.80
MIN_PER_PERSONA_ACCURACY = 0.75
MIN_UTTERANCES = 180


def load_utterances(path: Path) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert data["count"] >= MIN_UTTERANCES, f"Expected ≥{MIN_UTTERANCES}, got {data['count']}"
    assert set(data["label_set"]) == set(LABEL_SET), "Label set mismatch"
    utterances = data["utterances"]
    assert len(utterances) == data["count"]
    for u in utterances:
        assert u["label"] in LABEL_SET, f"Unknown label: {u['label']}"
    return utterances


def stratified_split(
    utterances: list[dict], train_ratio: float, seed: int
) -> tuple[list[dict], list[dict]]:
    rng = np.random.RandomState(seed)
    groups: dict[tuple[str, str], list[dict]] = {}
    for u in utterances:
        key = (u["label"], u["persona"])
        groups.setdefault(key, []).append(u)

    train, holdout = [], []
    for items in groups.values():
        rng.shuffle(items)
        n_train = max(1, int(len(items) * train_ratio))
        # Keep at least one holdout when group has ≥2
        if len(items) >= 2 and n_train >= len(items):
            n_train = len(items) - 1
        train.extend(items[:n_train])
        holdout.extend(items[n_train:])
    return train, holdout


def embed_texts(texts: list[str], model_name: str, dim: int) -> np.ndarray:
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        print("ERROR: sentence-transformers not installed.")
        sys.exit(1)

    model = SentenceTransformer(model_name)
    prefixed = [QUERY_PREFIX + t for t in texts]
    embeddings = model.encode(prefixed, show_progress_bar=True, normalize_embeddings=True)
    assert embeddings.shape[1] == dim, f"Expected dim {dim}, got {embeddings.shape[1]}"
    return embeddings


def fit_classifier(X: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    try:
        from sklearn.linear_model import LogisticRegression
    except ImportError:
        print("ERROR: scikit-learn not installed.")
        sys.exit(1)

    clf = LogisticRegression(
        max_iter=2000,
        solver="lbfgs",
        C=2.0,
        class_weight="balanced",
        random_state=RANDOM_SEED,
    )
    clf.fit(X, y)
    return clf.coef_, clf.intercept_


def evaluate(
    X: np.ndarray, y: np.ndarray, W: np.ndarray, b: np.ndarray, labels: list[str]
) -> dict:
    logits = X @ W.T + b
    exp_logits = np.exp(logits - logits.max(axis=1, keepdims=True))
    probs = exp_logits / exp_logits.sum(axis=1, keepdims=True)
    preds = probs.argmax(axis=1)

    accuracy = float((preds == y).mean())
    class_metrics = {}
    for i, label in enumerate(labels):
        tp = int(((preds == i) & (y == i)).sum())
        fp = int(((preds == i) & (y != i)).sum())
        fn = int(((preds != i) & (y == i)).sum())
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall) > 0
            else 0.0
        )
        class_metrics[label] = {"precision": precision, "recall": recall, "f1": f1}

    macro_f1 = float(np.mean([m["f1"] for m in class_metrics.values()]))
    return {"accuracy": accuracy, "macro_f1": macro_f1, "class_metrics": class_metrics}


def main() -> int:
    print("=" * 60)
    print("Care Intent Head Trainer (planning/40 §6.8)")
    print("=" * 60)

    print(f"\nLoading utterances from {UTTERANCES_PATH}...")
    utterances = load_utterances(UTTERANCES_PATH)
    print(f"  Loaded {len(utterances)} utterances")

    train_utt, holdout_utt = stratified_split(utterances, TRAIN_RATIO, RANDOM_SEED)
    print(f"  Train: {len(train_utt)}, Holdout: {len(holdout_utt)}")

    print(f"\nEmbedding with {EMBEDDER_MODEL} (dim={DIM})...")
    X_train = embed_texts([u["text"] for u in train_utt], EMBEDDER_MODEL, DIM)
    X_holdout = embed_texts([u["text"] for u in holdout_utt], EMBEDDER_MODEL, DIM)

    label_to_idx = {label: i for i, label in enumerate(LABEL_SET)}
    y_train = np.array([label_to_idx[u["label"]] for u in train_utt])
    y_holdout = np.array([label_to_idx[u["label"]] for u in holdout_utt])

    print("\nFitting multinomial logistic regression...")
    W, b = fit_classifier(X_train, y_train)
    print(f"  W shape: {W.shape}, b shape: {b.shape}")

    print("\nEvaluating on holdout...")
    metrics = evaluate(X_holdout, y_holdout, W, b, LABEL_SET)
    print(f"  Overall accuracy: {metrics['accuracy']:.4f} (target: ≥{MIN_OVERALL_ACCURACY})")
    print(f"  Macro F1:         {metrics['macro_f1']:.4f} (target: ≥{MIN_MACRO_F1})")

    promote_prec = metrics["class_metrics"]["promote_uc4_to_plan_task"]["precision"]
    ooc_recall = metrics["class_metrics"]["out_of_care"]["recall"]
    print(f"  promote_uc4 precision: {promote_prec:.4f} (target: ≥{MIN_PROMOTE_PRECISION})")
    print(f"  out_of_care recall:    {ooc_recall:.4f} (target: ≥{MIN_OUT_OF_CARE_RECALL})")

    persona_correct: dict[str, int] = {}
    persona_total: dict[str, int] = {}
    for i, u in enumerate(holdout_utt):
        p = u["persona"]
        persona_total[p] = persona_total.get(p, 0) + 1
        pred_idx = int((X_holdout[i] @ W.T + b).argmax())
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

    output = {
        "version": "1.0",
        "labels": LABEL_SET,
        "dim": DIM,
        "W": W.tolist(),
        "b": b.tolist(),
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "sourceCorpus": f"care-utterances@v1({len(utterances)})",
        "embedder": EMBEDDER_MODEL,
        "trainIds": [u["id"] for u in train_utt],
        "holdoutIds": [u["id"] for u in holdout_utt],
        "metrics": {
            "accuracy": metrics["accuracy"],
            "macro_f1": metrics["macro_f1"],
            "promote_uc4_to_plan_task_precision": promote_prec,
            "out_of_care_recall": ooc_recall,
        },
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)
    print(f"\nExported to {OUTPUT_PATH}")
    print(f"  File size: {OUTPUT_PATH.stat().st_size / 1024:.1f} KB")

    print("\n" + "=" * 60)
    passed = True
    if metrics["accuracy"] < MIN_OVERALL_ACCURACY:
        print(f"  FAIL: accuracy {metrics['accuracy']:.4f} < {MIN_OVERALL_ACCURACY}")
        passed = False
    if metrics["macro_f1"] < MIN_MACRO_F1:
        print(f"  FAIL: macro_f1 {metrics['macro_f1']:.4f} < {MIN_MACRO_F1}")
        passed = False
    if promote_prec < MIN_PROMOTE_PRECISION:
        print(f"  FAIL: promote precision {promote_prec:.4f} < {MIN_PROMOTE_PRECISION}")
        passed = False
    if ooc_recall < MIN_OUT_OF_CARE_RECALL:
        print(f"  FAIL: out_of_care recall {ooc_recall:.4f} < {MIN_OUT_OF_CARE_RECALL}")
        passed = False
    if not all_pass:
        print(f"  FAIL: per-persona accuracy < {MIN_PER_PERSONA_ACCURACY}")
        passed = False

    if passed:
        print("  ALL GATES PASSED")
    else:
        print("  SOME GATES FAILED — review corpus before shipping")
    print("=" * 60)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
