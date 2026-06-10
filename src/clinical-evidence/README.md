# `src/clinical-evidence/` — External Clinical API Clients

> **Status:** scaffold (empty).

**What lives here:** the **OpenEvidence** client (primary clinical evidence base), plus **RxNorm**,
**DailyMed**, and **OpenFDA** clients. Every client follows a **default-deny** pattern: requests are logged to
the audit trail and no PHI leaves the device without an active consent token (via the L2 consent gate).

**Offline posture:** patient-relevant references are cached locally so core flows work without connectivity.
On Track A (Expo Go), clients are mocked against cached/synthetic fixtures.

**Primary owner:** Ethan.
