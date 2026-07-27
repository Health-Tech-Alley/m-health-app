# NLU Training Scripts

Offline training and evaluation scripts for the Pre-SLM NLU system (planning/35).

## Prerequisites

```bash
pip install sentence-transformers scikit-learn numpy
```

## Scripts

| Script | Purpose | Input | Output |
|--------|---------|-------|--------|
| `train_intent_head.py` | Train chat intent classifier | `utterances-800.json` (v1.1+) | `intent-head.json` |
| `train_care_intent_head.py` | Train Care second head (doc 40) | `care-utterances-v1.json` | `care-intent-head.json` |
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

## Quality Gates (from planning/35 §7.3)

| Metric | Target |
|--------|--------|
| Overall accuracy (held-out) | ≥ 0.85 |
| `vitals_what_if` precision | ≥ 0.90 |
| `knowledge_qa` recall | ≥ 0.80 |
| Macro-F1 | ≥ 0.80 |
| Per-persona accuracy | ≥ 0.75 |

## Authoritative Corpus

All three files live under `planning/nlu-training/`:

- `utterances-800.json` — chat-head corpus (v1.1 expands ADCP/UC3/UC4/app-surface phrasing; still 14 chat labels)
- `care-utterances-v1.json` — Care second-head corpus (~224 rows; 9 Care intents + `out_of_care`)
- `retrieval-qrels.json` — 147 retrieval relevance judgments + 61 doc catalog
- `use-cases-and-conditions.md` — Persona/condition tracker
