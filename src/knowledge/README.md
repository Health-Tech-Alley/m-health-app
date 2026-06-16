# `src/knowledge/` — L5 Hybrid RAG + Fused Retrieval

> **Status:** implemented for Track A. `TrackAFusedRetriever` fuses BM25 sparse
> retrieval with a deterministic hash dense embedder and RRF; graph helpers for
> context subgraph projection are also present.

**What lives here:** the **BM25** sparse index (`bm25-index.ts`), the **dense
vector index** (`dense-index.ts`) using a deterministic hash embedder
(`embedder.ts`), **RRF** fusion (`rrf.ts`), an optional post-RAG re-ranker path,
and the **fused retriever** (`fused-retriever.ts`) that collapses tool-RAG +
knowledge-RAG into a single hop. Knowledge sources: **OpenEvidence** (primary) +
RxNorm + DailyMed + OpenFDA.

**Corpus focus:** the three use-case conditions — **Spina Bifida** (autonomic
dysreflexia), **post-stroke** (ROM recovery milestones), **COPD + TBI**
(respiratory distress). Every grounded answer carries citations.

**Track A (Expo Go):** retrieval runs over a small cached/synthetic corpus
(`src/knowledge/corpora/fixtures.ts`) behind `TrackAFusedRetriever`; the
on-device sub-1B embedder is a Track B (dev build) concern.

**Graph helpers:** `src/knowledge/graph/` contains context-subgraph projection,
edge writers, and graph-projector utilities for the knowledge graph experiments.

**Primary owner:** Ethan.
