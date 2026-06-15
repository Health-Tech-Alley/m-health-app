# `src/knowledge/` — L5 Hybrid RAG + Fused Retrieval

> **Status:** scaffold (empty).

**What lives here:** the **BM25** sparse index, the **dense vector index** (sub-1B embedder), **RRF** fusion,
an optional post-RAG **re-ranker**, and the **fused retriever** that collapses tool-RAG + knowledge-RAG into a
single hop. Knowledge sources: **OpenEvidence** (primary) + RxNorm + DailyMed + OpenFDA.

**Corpus focus:** the three use-case conditions — **Spina Bifida** (autonomic dysreflexia), **post-stroke**
(ROM recovery milestones), **COPD + TBI** (respiratory distress). Every grounded answer carries citations.

**Track A (Expo Go):** retrieval runs over a small cached/synthetic corpus behind a mock retriever; the
on-device embedder is a Track B (dev build) concern.

**Primary owner:** Ethan.
