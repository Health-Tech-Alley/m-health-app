# NLU Training Scripts

Offline training and evaluation scripts for the Pre-SLM NLU system.

## Prerequisites

```bash
pip install sentence-transformers scikit-learn numpy
```

## Scripts

| Script | Purpose | Input | Output |
|--------|---------|-------|--------|
| `train_intent_head.py` | Train chat intent classifier | `utterances-800.json` (v1.1+) | `intent-head.json` |
| `train_care_intent_head.py` | Train Care second head | `care-utterances-v1.json` | `care-intent-head.json` |
| `eval_intent.py` | Re-evaluate chat holdout metrics | `utterances-800.json` + `intent-head.json` | stdout |
| `eval_care_intent.py` | Re-evaluate Care holdout metrics | `care-utterances-v1.json` + `care-intent-head.json` | stdout |
| `eval_retrieval.py` | Evaluate retrieval quality | `retrieval-qrels.json` | stdout (MRR, Recall@k) |
| `build_entity_lexicon.py` | Build entity lexicon | `use-cases-and-conditions.md` | `entity-lexicon.json` |
| `section_chunker_eval.py` | Test section chunk convention | `retrieval-qrels.json` | stdout |
| `export_jsonl.py` | Flatten utterances to JSONL | `utterances-800.json` | `utterances-800.jsonl` |

## Usage

```bash
# Train chat intent head (must pass quality gates)
python training/nlu/train_intent_head.py

# Train Care second head (ADCP / UC3 / UC4 catalog)
python training/nlu/train_care_intent_head.py

# Re-run eval
python training/nlu/eval_intent.py
python training/nlu/eval_care_intent.py

# Evaluate retrieval (hybrid vs BM25-only)
python training/nlu/eval_retrieval.py

# Build entity lexicon from use-cases tracker
python training/nlu/build_entity_lexicon.py
```

## Quality Gates

| Metric | Target |
|--------|--------|
| Overall accuracy (held-out) | ≥ 0.85 |
| `vitals_what_if` precision | ≥ 0.90 |
| `knowledge_qa` recall | ≥ 0.80 |
| Macro-F1 | ≥ 0.80 |
| Per-persona accuracy | ≥ 0.75 |

## Authoritative Corpus

Train/eval scripts expect these corpus files (paths resolved inside each script — place them where the script looks, or pass CLI args if supported):

- `utterances-800.json` — chat-head corpus (14 chat labels)
- `care-utterances-v1.json` — Care second-head corpus (9 Care intents + `out_of_care`)
- `retrieval-qrels.json` — retrieval relevance judgments + doc catalog
- `use-cases-and-conditions.md` — persona/condition tracker for lexicon build
