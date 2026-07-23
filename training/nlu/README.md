# NLU Training Scripts

Offline training and evaluation scripts for the Pre-SLM NLU system (planning/35).

## Prerequisites

```bash
pip install sentence-transformers scikit-learn numpy
```

## Scripts

| Script | Purpose | Input | Output |
|--------|---------|-------|--------|
| `train_intent_head.py` | Train intent classifier | `utterances-800.json` | `intent-head.json` |
| `eval_intent.py` | Re-evaluate holdout metrics | `utterances-800.json` + `intent-head.json` | stdout |
| `eval_retrieval.py` | Evaluate retrieval quality | `retrieval-qrels.json` | stdout (MRR, Recall@k) |
| `build_entity_lexicon.py` | Build entity lexicon | `use-cases-and-conditions.md` | `entity-lexicon.json` |
| `section_chunker_eval.py` | Test section chunk convention | `retrieval-qrels.json` | stdout |
| `export_jsonl.py` | Flatten utterances to JSONL | `utterances-800.json` | `utterances-800.jsonl` |

## Usage

```bash
# Train intent head (must pass quality gates)
python training/nlu/train_intent_head.py

# Re-run eval
python training/nlu/eval_intent.py

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

- `utterances-800.json` — 800 labeled caregiver prompts (200 × 4 personas)
- `retrieval-qrels.json` — 147 retrieval relevance judgments + 61 doc catalog
- `use-cases-and-conditions.md` — Persona/condition tracker
