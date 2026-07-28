# `src/clinical-evidence/` — External Clinical API Clients

> **Status:** implemented (NLM/FDA live clients + Orphanet/CDC PLACES fixtures).

**What lives here:** **PubMed** (E-utilities), **MedlinePlus Connect**, **RxNorm**, **DailyMed** (SPL labels), and **OpenFDA** (AE summaries + recalls) — public NLM/NIH/FDA APIs. Plus **Orphanet** (fixtures-first) and **CDC PLACES** (SDOH; fixtures default). Curated offline packs (CPG digests + disability care gaps) seed via `curated-knowledge-packs.ts`.

**Removed from product path:** UMLS (API key + MeSH expand), HEDIS auto-measure packs, ClinicalTrials.gov default/re-download (poor home-care NLU fit).

Every live client follows **default-deny** egress: de-identify via `deidentifyQuery()`, audit, consent gate where applicable. Offline posture: patient-relevant rows in `knowledge_cache`.

**Primary owner:** Ethan.
