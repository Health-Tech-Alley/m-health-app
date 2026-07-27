# Current project state (snapshot)

> **Date edited:** 2026-07-27  
> Living summary of what is shipped in the codebase. Prefer this + `APP_GUIDE.md` + root `AGENTS.md` over older planning drafts when they disagree.

## Product surface

| Surface | Status |
|---------|--------|
| **5 bottom tabs** — Home, Care, Meds, Schedule, Concierge | Shipped |
| Settings / More | Stack screen (`more.tsx`), not a tab |
| Onboarding | Welcome + 5 form steps; Mike/Elena/James/Sofia presets; FHIR import |
| Care plan spine (ADCP) | Plan Pulse, priorities (UC4), Your Review, therapy (UC3), goals, safety, monitoring, backup |
| Care ask soft-NLU | Coaching router + in-card Concierge; caregiver-reported emergency path |
| Concierge chat | Gemma 4 E2B only; Pre-SLM NLU; safety refuses; citations |
| Health Monitor (UC2) | Decision layer + TFLite autoencoder; Home critical dialog + alert detail |
| Secure messaging | Local AES-256-GCM store only (no relay) |
| Appointments | Full CRUD + reminders on Schedule |
| Clinical evidence bundling | Clients + knowledge-bundle runner (condition/med/SDOH); fixtures Track A |

## Stack (implemented)

- Expo SDK ~56.0.12, React Native 0.85.3, expo-router
- Concierge: `llama.rn` / **Gemma-4-E2B-it Q4_K_M** only (`src/inference/model-catalog.ts`)
- NLU: TFLite `mdbr-leaf-ir` + chat/care intent heads (`src/nlu/`, `assets/models/nlu/`)
- Redux Toolkit + React Context hybrid (see AGENTS.md State Management Authority)
- SQLite: **34** repositories under `src/data/repositories/`
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
| [`../AGENTS.md`](../AGENTS.md) | Agent/contributor authority (architecture, state rules, git) |
| [`APP_GUIDE.md`](./APP_GUIDE.md) | Screen-by-screen living guide |
| [`MARKDOWN_GUIDE.md`](./MARKDOWN_GUIDE.md) | Markdown renderer + Concierge output |
| [`handoffs/`](./handoffs/) | Point-in-time handoff notes (may be stale) |
| [`integration/`](./integration/) | Point-in-time integration reviews (may be stale) |
| [`../planning/`](../planning/) | Plans + progress log — check date stamps |

## Still deferred / partial

- Pharmacy locator / CBO geofence product (`src/locator/`)
- Android Health Connect source (types only)
- SQLCipher encryption-at-rest
- Network E2EE messaging relay
- Full multi-hop GraphRAG
