<p align="center">
  <img src="./assets/images/hta-logo.png" alt="Health Tech Alley" height="120" />
</p>

# Caregiver Concierge: ACCESS-DP

<p>
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" />
  &nbsp;
  <img src="https://img.shields.io/badge/Platforms-iOS%20%7C%20Android-lightgrey.svg" alt="Platforms: iOS | Android" />
  &nbsp;
  <img src="https://img.shields.io/badge/Framework-React%20Native-61dafb.svg" alt="Framework: React Native" />
  &nbsp;
  <img src="https://img.shields.io/badge/Status-Active%20Development-orange.svg" alt="Status: Active Development" />
</p>

A **Health Tech Alley** project, built with **Expo + React Native**.

<p>
  <img src="./assets/images/expo-badge.png" alt="Powered by Expo" height="36" />
  &nbsp;&nbsp;
  <img src="./assets/images/react-logo.png" alt="React Native" height="36" />
</p>

A mobile health AI application that supports family caregivers of **severely disabled individuals** (disability level 3 on a 1–5 scale) with comorbidities and specialists involved. Built with **Expo and React Native** for iOS and Android.

**Target conditions:** cerebral palsy, traumatic brain injury (TBI), COPD — plus the three use-case conditions: Spina Bifida, post-stroke rehabilitation, COPD + TBI. *(Diabetes is no longer the primary condition.)*

## App Pillars

The app is organized around three caregiver-facing pillars, each backed by the same on-device AI stack
(SLM + RAG + MCP orchestration) and a deterministic rule/threshold engine that runs offline first.

### 1. Medication Management

The day-to-day heart of the app. Keeps the medication regimen safe, on schedule, and contextually informed.

- **Dosage monitoring** — Per-medication schedule (dose, route, frequency, time-of-day), adherence tracking
  with missed-dose detection, caregiver-acknowledged intake logging, and "what changed?" comparisons
  against the personalized care plan.
- **Pharmacy locator and communicator** — Geofenced pharmacy search, hours/inventory lookups, and a
  consent-gated, tokenized message channel to the patient's preferred pharmacy (refill requests, dosage
  clarifications, side-effect notes). Location fuses into the orchestrator's Context Aggregator so the
  SLM can reason about the closest open pharmacy in the same turn.
- **Drug-interaction awareness** — On-demand RxNorm / OpenFDA lookups grounded in the patient's active
  medication list; surfaced as **citations**, never as a directive.

### 2. Care Management

The longitudinal, patient-specific plan and the signals that watch it.

- **Personal care plan** — A first-run onboarding flow generates a structured care plan
  (demographics, conditions, medications, vitals cadence, recovery milestones, emergency thresholds,
  service preferences). The SLM personalizes the draft over OpenEvidence + RxNorm + FDA labels, and
  every caregiver action becomes a **trigger event** that refines the plan over time
  (the "Netflix model" of continuous personalization).
- **Anomalies** — The deterministic rule/threshold engine and a separate Alert ML model watch vitals
  + wearable trends against the care plan. Anomalies surface in the dashboard with a transparency
  trace showing exactly how the ML factored in; the SLM is invoked **only after the caregiver
  provides ground-truth** (physical check-in, logged observations). Emergencies short-circuit the SLM
  path (Severity 3 fast-path) — the alert fires first, "Explain" comes after.

### 3. Scheduling and Tracking Center

The caregiver's calendar view of the care plan in motion.

- **Appointments** — Physician + specialist + therapy appointments, tracking, reminders, and a consent-gated,
  encrypted record-share path (FHIR R4) to push a clinician-facing trajectory summary to a therapist or
  PCP when the caregiver escalates.
- **Tracking** — Adherence history, vitals trends, alert timeline, and audit trail in one place. The same
  view is what the personalization loop and the eval harness (notebooks) read from.
- **Dashboard** — Summary card + alert feed; HITL confirm / override / escalate controls are present on
  **every** AI-suggested action.

## Cross-Cutting Features

- **On-device AI** — Clinical decision support runs locally; PHI never leaves the device
- **Human-in-the-loop** — AI proposes; caregiver confirms or overrides every clinical action; nothing clinical auto-executes
- **Offline-first** — Core functionality (reminders, rule engine, dashboards) works with zero connectivity
- **HIPAA-compliant** — Encrypted local storage (SQLCipher + Keychain/Keystore), consent-gated data egress, tamper-evident audit log
- **Transparency trace** — OpenEvidence citations + orchestration trace on every AI suggestion

## Tech Stack

- **Framework:** Expo (React Native) + expo-router
- **On-device SLM:** llama.cpp via llama.rn (~8B parameter, Q4_K_M quantized, behind an `InferenceProvider` seam)
- **Orchestration:** Model Context Protocol (MCP) — 4 agents (caregiver / patient-state / coordinator / safety-reviewer) mediated by a single L4 orchestrator
- **Retrieval:** Hybrid RAG (BM25 + dense embeddings + reciprocal rank fusion) — fused tool-RAG + knowledge-RAG in a single hop
- **Knowledge base:** OpenEvidence (primary clinical evidence), RxNorm, DailyMed, OpenFDA
- **Local storage:** SQLite + SQLCipher (encrypted at rest)
- **Wearables:** HealthKit (iOS), Health Connect (Android)
- **State management:** Zustand / Redux
- **CEP:** Custom TypeScript Complex Event Processing bus (L3) correlates sensor + UI + state events before the SLM is called

## Getting Started

### Prerequisites

- **Node.js LTS** (includes npm) — no global Expo CLI needed; use `npx expo`
- The **Expo Go** app on a physical iOS/Android device (for Track A)
- *(Track B only)* an **Expo account** for EAS cloud builds — no local Xcode / Android Studio required

### Two-track development

Because the project's core native modules (`llama.rn`, SQLCipher, HealthKit / Health Connect) don't load in
Expo Go, development runs on two tracks:

- **Track A — Expo Go (no native tooling):** all UI + the deterministic rule/threshold engine + event bus +
  **mocked** SLM / ML / RAG / wearable providers. Covers most steel-thread UI work and demos the full
  click-paths. **This is the default day-to-day track.**
- **Track B — dev build (`expo-dev-client`):** needed only when wiring real native modules. Build in the
  cloud with **EAS** (no local Xcode/Android Studio), then run against the custom dev client.

### Installation

```bash
# Install dependencies
npm install
```

### Running the App (Track A — Expo Go)

```bash
# Start the Expo dev server
npx expo start

# Then scan the QR code with the Expo Go app (phone on the same Wi-Fi).
# Use --tunnel if your phone and computer aren't on the same network:
npx expo start --tunnel

# Or run in a browser:
npx expo start --web
```

### Running the App (Track B — dev build, real native modules)

```bash
# One-time: create a cloud dev build (no local Xcode/Android Studio needed)
npx eas build --profile development --platform android   # or ios

# Install the resulting build on a device/simulator, then:
npx expo start --dev-client
```

> Local native builds (`npx expo run:ios` / `npx expo run:android`) are optional and require macOS+Xcode
> (iOS) or the Android SDK (Android). Prefer EAS cloud builds to avoid local native tooling.

### Development Tips

- Use `npx expo start --clear` to clear the Metro bundler cache
- Run `npm run lint` to check for code style issues

## Building for Production

```bash
# Build for iOS / Android (cloud)
npx eas build --platform ios --profile production
npx eas build --platform android --profile production

# Submit to App Store / Play Store
npx eas submit --platform ios
npx eas submit --platform android
```

## Architecture Overview

The app is organized into seven logical layers. Each pillar above (Medication / Care / Scheduling) cuts
across every layer — that's why a steel thread (e.g. ST-01 Ambient Anomaly Detection) pierces L1→L7
end-to-end rather than being built one layer at a time.

| Layer | Purpose | Pillar touchpoints |
|-------|---------|--------------------|
| L1 | React Native UI (Dashboard, Medication, Appointments, Care Plan, Settings, HITL) | All three pillars' screens |
| L2 | App Services (controllers, state, notifications, consent gate, audit log) | All three pillars |
| L3 | Event Bus — Complex Event Processing + Context Aggregator (geofence + patient state) | Medication (pharmacy locator), Care (anomaly CEP) |
| L4 | Intelligent Orchestration — MCP agents, fused tool-RAG + knowledge-RAG, FHIR adapter | All three pillars |
| L5 | Decision Engine — on-device SLM (`InferenceProvider`), Alert ML model, re-ranker | All three pillars |
| L6 | Knowledge — hybrid RAG, OpenEvidence, RxNorm, DailyMed, OpenFDA, vector index | Medication (interactions), Care (care-plan personalization) |
| L7 | Local Data — SQLite + SQLCipher, repositories, HealthKit/Health Connect, geofence, FHIR sandbox | All three pillars |

The **canonical event ordering** all three pillars share:

```
patient action / change → deterministic rule + threshold engine → Alert ML (starting context)
   → caregiver HITL (check / acknowledge / escalate) → SLM + RAG (only after ground-truth)
   → caregiver HITL confirm → persist + audit + (optional) consent-gated egress
```

The acute fast-path (Severity 3 / dashboard takeover) **short-circuits** the SLM step so the urgent
alert is never delayed; the SLM "Explain" runs on demand after the alert.

## Project Structure

```
m-health-app/
├── src/
│   ├── app/                # Expo Router file-based routes (_layout, index, ...)
│   ├── components/         # Reusable UI components
│   ├── hooks/ constants/   # Shared hooks + theme
│   ├── ui/                 # L1 — feature screens (Medication, Care Plan, Scheduling, Dashboard, Settings, HITL)
│   ├── services/           # L2 — controllers, state, notifications, consent gate, audit log
│   ├── orchestration/      # L3 — MCP, event bus, CEP, context aggregator, agents
│   ├── inference/          # L4 — InferenceProvider, llama.rn adapter, Mock provider
│   ├── knowledge/          # L5 — hybrid RAG, re-ranker, fused retrieval
│   ├── data/               # L6 — SQLite/SQLCipher, vector index, FHIR adapter, sensor bridges
│   ├── locator/            # L7 — geofence + CBO resource data (pharmacy locator, deferred)
│   └── clinical-evidence/  # OpenEvidence + NLM/FDA API clients
├── assets/                 # Images, fonts, splash, icons
├── app.json                # Expo config + native permissions
└── package.json            # "main": "expo-router/entry"
```

## Target Grants

- **ACL Caregiver AI Challenge** — Responsible AI tools that reduce caregiver burden
- **Maryland Rural Health (RMPIF FY27)** — Rural access, care coordination, NEMT

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

**MIT** — see the [`LICENSE`](./LICENSE) file for the full text. Short version: do what you want, just keep the
copyright notice and don't blame us.

## Status

Active development. The prototype uses synthetic data only — no PHI is present in any test fixtures or development environments.
