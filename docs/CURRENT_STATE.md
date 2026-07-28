# Current project state (snapshot)

> **Date edited:** 2026-07-28  
> Living summary of what is shipped in the codebase. Prefer this + `APP_GUIDE.md` + root `README.md` when docs disagree.

## Product surface

| Surface | Status |
|---------|--------|
| **5 bottom tabs** — Home, Care, Meds, Schedule, Concierge | Shipped |
| Settings / More | Stack screen (`more.tsx`), not a tab |
| Onboarding | Welcome + 5 form steps + **Device setup** (Concierge model + clinical knowledge pack); Mike/Elena/James/Sofia presets; FHIR import |
| Care plan spine (ADCP) | Plan Pulse, priorities (UC4), Your Review, therapy (UC3), goals, safety, monitoring, backup |
| Care ask soft-NLU | Coaching router + in-card Concierge; caregiver-reported emergency path |
| Concierge chat | Gemma 4 E2B only; Pre-SLM NLU; safety refuses; citations |
| Health Monitor (UC2) | Decision layer + TFLite autoencoder; Home critical dialog + alert detail |
| Secure messaging | Local AES-256-GCM store only (no relay) |
| Appointments | Full CRUD + reminders on Schedule |
| Clinical evidence | **On-device knowledge pack** (global `pack.sqlite` + patient overlay); pack inputs = union of all stored records; profile switch = overlay swap + delta check; med layers re-sync on med change; BM25 → graph → dense rerank (curated layers only); legacy bundler retired |

## Stack (implemented)

- Expo SDK ~56.0.12, React Native 0.85.3, expo-router
- Concierge: `llama.rn` / **Gemma-4-E2B-it Q4_K_M** only (`src/inference/model-catalog.ts`)
- NLU: TFLite `mdbr-leaf-ir` + chat/care intent heads (`src/nlu/`, `assets/models/nlu/`)
- Knowledge pack: `src/clinical-evidence/pack/` — global pack DB, layer fetchers, float16 leaf-ir vectors, pack evidence graph
- Retrieval: `CachedFusedRetriever` unions pack ∪ patient overlay; graph expand default ON; dense rerank over candidates
- Redux Toolkit + React Context hybrid (SQLite repos → `PatientRecordSnapshot` → UI; Redux for workflow slices)
- SQLite: **34** repositories under `src/data/repositories/` (+ separate `Documents/knowledge-pack/pack.sqlite`)
- Sensors: Apple Health bridge (iOS) + mock; Health Connect still scaffold
- Locator / pharmacy geofence: scaffold only (`src/locator/`)
- SQLCipher at rest: planned, not landed

## Primary demo patient

**Mike** — CP GMFCS V; fixtures `mike-fhir-bundle-v6.2.json` / `v5.9.json`; preset `mike-ehr-v62`. Athena-aligned synthetic patient id in profile JSON.

## Caregiver terminology

`src/constants/user-terms.ts` — Concierge, Health Monitor, Your Review, Clinical Evidence, Health Record. Never expose SLM / ML / HITL / ADCP / UC2–4 in caregiver UI strings.

## Doc map

| Doc | Role |
|-----|------|
| [`../README.md`](../README.md) | Pitch + getting started + architecture snapshot |
| [`APP_GUIDE.md`](./APP_GUIDE.md) | Screen-by-screen living guide |
| [`MARKDOWN_GUIDE.md`](./MARKDOWN_GUIDE.md) | Markdown renderer + Concierge output |
| [`handoffs/`](./handoffs/) | Point-in-time handoff notes (may be stale) |
| [`integration/`](./integration/) | Point-in-time integration reviews (may be stale) |

## Still deferred / partial

- Pharmacy locator / CBO geofence product (`src/locator/`)
- Android Health Connect source (types only)
- SQLCipher encryption-at-rest
- Network E2EE messaging relay
- Full multi-hop GraphRAG
