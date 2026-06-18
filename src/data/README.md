# `src/data/` — L6 Local Data + Adapters + Sensors

> **Status:** implemented with migration-driven SQLite schema, repositories, and
> seeding. Wearable bridges (`src/data/sensors`) are scaffolded.

**What lives here (the single source of truth):** **SQLite + SQLCipher-ready**
schema (encrypted care-plan profile, vitals history, audit mirror), the
repositories (`healthSampleRepository`, `thresholdRepository`, `alertRepository`,
`patientRepository`, `auditRepository`, `consentRepository`, `ragRepository`,
...), the **FHIR adapter** scaffold, and the **HealthKit (iOS) / Health Connect
(Android)** wearable bridges.

**Schema highlights:** `patients`, `caregivers`, `providers`, `medications`,
`patient_conditions`, `care_plans`, `care_plan_goals`, `health_samples`,
`thresholds`, `alerts`, `caregiver_actions`, `rag_citations`, `slm_turns`,
`slm_citations`, `trigger_events`, `graph_edges`, `audit_log`, `consent_tokens`.
Migrations live in `migrations.ts`; the public API is exported from `index.ts`.

**Two-track providers:**
- **SQLite repos + `MockSensorSource`** — Track A (Expo Go). Persistent
  `expo-sqlite` storage seeded from the onboarding profile; synthetic vitals
  streams are available but disabled by default.
- **SQLCipher repos + real Health bridges** — Track B (dev build). Encrypted at
  rest; real wearable ingestion.

**Never commit** `*.db` / `*.sqlite` (git-ignored) — even synthetic data stays
out of git.

**Primary owners:** Rahal (schema/FHIR/appointments) + Ethan (vector index/care-plan events) + Jay (wearables).
