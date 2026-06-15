# `src/data/` — L6 Local Data + Adapters + Sensors

> **Status:** scaffold (empty).

**What lives here (the single source of truth):** **SQLite + SQLCipher** (encrypted care-plan profile,
vitals history, audit mirror), the repositories (`MedicationRepo`, `AppointmentRepo`, `AlertRepo` — the only
sanctioned read/write surface), the **vector index**, the **FHIR adapter** (HAPI/MedAgentBench sandbox), and
the **HealthKit (iOS) / Health Connect (Android)** wearable bridges.

**Two-track providers:**
- **Mock repositories + `MockSensorSource`** — Track A (Expo Go). Plain (or in-memory) storage seeded from
  synthetic persona packs; synthetic vitals streams per use case.
- **SQLCipher repos + real Health bridges** — Track B (dev build). Encrypted at rest; real wearable ingestion.

**Never commit** `*.db` / `*.sqlite` (git-ignored) — even synthetic data stays out of git.

**Primary owners:** Rahal (schema/FHIR/appointments) + Ethan (vector index/care-plan events) + Jay (wearables).
