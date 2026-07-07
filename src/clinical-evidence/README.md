# `src/clinical-evidence/` — External Clinical API Clients

> **Status:** implemented (5 NLM/FDA clients live + 4 new clients scaffolded with fixtures).

**What lives here:** the **PubMed E-utilities** client (NLM literature + abstracts), **MedlinePlus Connect** (NLM
health topics + drug info), **RxNorm** (NLM drug normalization + interactions), **DailyMed** (NLM full drug
labels), and **OpenFDA** (adverse events + drug recalls) — all using the public NLM/NIH/FDA APIs. Plus four
new clients (ClinicalTrials.gov, UMLS Metathesaurus, Orphanet, CDC PLACES) added per
`planning/26_clinical-data-sources-research.md`. Every client follows a **default-deny** pattern: requests are
logged to the audit trail and no PHI leaves the device without an active consent token (via the L2 consent
gate). All queries are de-identified via `deidentifyQuery()` before they hit the network.

**Offline posture:** patient-relevant references are cached locally in the `knowledge_cache` table so core
flows work without connectivity. On Track A (Expo Go), new clients (ClinicalTrials.gov, UMLS, Orphanet, CDC
PLACES) ship with realistic fixture data until live fetch is enabled in Track B.

**Primary owner:** Ethan.
