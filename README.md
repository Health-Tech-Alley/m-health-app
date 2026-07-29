<p align="center">
  <img src="./assets/images/hta-logo.png" alt="Health Tech Alley" height="120" />
</p>

# Caregiver Concierge: ACCESS-DP

<p>
  <img src="https://img.shields.io/badge/Platforms-iOS%20%7C%20Android-lightgrey.svg" alt="Platforms: iOS | Android" />
  &nbsp;
  <img src="https://img.shields.io/badge/Framework-React%20Native-61dafb.svg" alt="Framework: React Native" />
  &nbsp;
  <img src="https://img.shields.io/badge/Status-Active%20Development-orange.svg" alt="Status: Active Development" />
</p>

[HTA Caregiver Conciertge Unified MLTech Readiness Level Assessment](docs/documentations/HTA-Caregiver-Conciertge-Unified-MLTech-Readiness-Level-Assessment-072026.pdf)

[HTA Caregiver Concierge - ACL Challenge Readiness Guie Assessment & Performance Report](docs/documentations/HTA%20Caregiver%20Concierge%20-%20ACL%20Challenge%20Readiness%20Guie%20Assessment%20&%20Performance%20Report.pdf)

A **Health Tech Alley** project, built with **Expo + React Native**.

<p>
  <img src="./assets/images/expo-badge.png" alt="Powered by Expo" height="36" />
  &nbsp;&nbsp;
  <img src="./assets/images/react-logo.png" alt="React Native" height="36" />
</p>

A mobile health AI application that supports family caregivers of **severely disabled individuals** (disability level 3 on a 1–5 scale) with comorbidities and specialists involved. Built with **Expo SDK 56 and React Native 0.85** for iOS and Android.

The first-run experience is an **onboarding intake** that captures caregiver, patient, provider, and safety details — with optional FHIR / demo-preset import (Mike, Elena, James, Sofia). The profile seeds on-device SQLite, kicks off clinical-evidence bundling, and drives Home, the Concierge (on-device SLM) system prompt, and the Health Monitor threshold engine. After onboarding, the user lands on a **5-tab shell**: **Home**, **Care**, **Meds**, **Schedule**, **Concierge** (Settings / More is a stack screen, not a bottom tab).

**Primary use case:** Mike EHR case study — fixtures `mike-fhir-bundle-v6.2.json` / `mike-fhir-bundle-v5.9.json` (demo preset `mike-ehr-v62`).

**Target conditions:** cerebral palsy, traumatic brain injury (TBI), COPD — plus Spina Bifida, post-stroke rehabilitation, and COPD + TBI.

**Caregiver-facing names:** Concierge (not “SLM”), Health Monitor (not “ML”), Your Review (not “HITL”), Clinical Evidence (not RAG jargon).

## App Pillars

The app is organized around three caregiver-facing pillars, each backed by the same on-device AI stack
(Concierge SLM + RAG + MCP orchestration) and a deterministic rule/threshold engine that runs offline first.

### 1. Medication Management

The day-to-day heart of the app. Keeps the medication regimen safe, on schedule, and contextually informed.

- **Dosage monitoring** — Per-medication schedule (dose, route, frequency, time-of-day), adherence tracking
  with missed-dose detection, caregiver-acknowledged intake logging, and "what changed?" comparisons
  against the personalized care plan. The Medications tab shows active meds with schedule times and
  "Mark as given" buttons; structured `medication_schedules` table drives reminder notifications.
- **Pharmacy locator and communicator** *(deferred)* — Geofenced pharmacy search, hours/inventory lookups, and a
  consent-gated, tokenized message channel to the patient's preferred pharmacy. The `src/locator/` directory
  is a scaffold awaiting CBO/pharmacy data integration.
- **Drug / label awareness** — RxNorm, DailyMed, and OpenFDA clients under `src/clinical-evidence/`
  ground medication answers as **citations**, never as dosing directives. Knowledge packs bundle at
  onboarding (and can refresh live when allowed); fixture mode keeps Track A offline-safe.

### 2. Care Management

The longitudinal, patient-specific plan and the signals that watch it.

- **Personal care plan (Care tab)** — Living **ADCP** plan spine: Plan Pulse / What changed, priorities,
  Your Review (pending proposals), therapy trajectory, goals, safety rules, monitoring, and backup/restore.
  Soft **Care ask** routes free text (intent head + app-surface phrases) into catalog intents or Concierge
  handoff; proposals never auto-apply. Profile seeds SQLite via `seedDatabaseFromProfile`; caregiver
  actions refine the plan over time ("Netflix model"). FHIR `CarePlan` + C-CDA export remain available.
- **Anomalies (Health Monitor)** — Rule/threshold engine + UC2 decision layer watch vitals. Home shows
  the alerts log and active-alert card; severity-3 opens a critical dialog (incl. caregiver-reported
  emergencies from Care ask). Concierge is invoked **after** ground-truth or on explicit **Ask the
  Concierge** (on alert-detail, via `SlmInsightSheet` — stays on the alert). Severity-3 short-circuits
  generative load; next steps (Call 911, Go to ER, Contact PCP, …) use deep-links / in-app flows.
- **Concierge (chat tab)** — Full-tab chat (`slm.tsx`): Pre-SLM NLU → deterministic safety refuses →
  Concierge generation with care-plan context and clinical-evidence citations. Mock fallback on Track A.
  Demo/auto policy loads/unloads the model around use.

### 3. Scheduling and Tracking Center

The caregiver's calendar view of the care plan in motion.

- **Appointments** — Full CRUD on Schedule (`appointmentRepository`), reminders, alert timeline, and
  notifications (incl. athenahealth appointment-request notify). Consent-gated record share remains
  available via C-CDA / FHIR export paths.
- **Tracking** — Adherence, weekly vitals trends (with reading time), alert timeline, and audit trail.
- **Home** — Patient summary, priorities, non-emergency insights, alerts log, and active-alert card.
  Your Review / HITL confirm-override is required for AI-proposed clinical plan changes.

## Cross-Cutting Features

- **On-device AI** — Clinical decision support runs locally; PHI never leaves the device
- **Human-in-the-loop** — AI proposes; caregiver confirms or overrides every clinical action; nothing clinical auto-executes
- **Offline-first** — Core functionality (reminders, rule engine, dashboards) works with zero connectivity
- **HIPAA-compliant** — Encrypted local storage (SQLCipher + Keychain/Keystore), consent-gated data egress, tamper-evident audit log
- **Transparency** — Clinical Evidence citations + orchestration trace on AI suggestions
- **Live RAM dashboard** — The Performance screen polls device memory at 1 Hz and shows
  total / used / free RAM plus a breakdown of how much of the used bucket is owned by
  the on-device SLM model. Color-coded severity (`ok` / `warn` / `crit`, labeled Healthy /
  Elevated / Critical) flags when the device is approaching OOM. The same data is mirrored
  on the SLM and Care Management screens while a model is loaded.
- **Model Manager** — The Models screen lists the GGUF catalog, downloads from Hugging Face
  with live progress, supports a gated-repo access token via `expo-secure-store`, and can
  delete individual models or wipe the on-device `models/` directory. In Demo mode, model
  management is auto-handled; in Developer mode, full manual control is in Settings.
- **MCP orchestration layer** — A single in-process orchestrator receives events from
  the event bus, runs a deterministic CEP engine (with 3-second debouncing for vitals bursts),
  calls four agents (caregiver / patient-state / coordinator / safety-reviewer) through an
  MCP-style tool contract, and decides when to invoke the SLM. A **confidence router**
  returns preliminary guidance for severity-3 alerts without loading the SLM. A
  **prompt-budget guard** truncates the explain prompt to fit the model's context window.
  Per-turn RAM + token attribution is logged to `slm_turns`.
- **Hybrid fused RAG** — One hop returns tool schemas and clinical chunks. Track A: hash
  embedder + fixtures; Track B: TFLite leaf-ir embedder + live clients when enabled.
  Knowledge-bundle runner coordinates condition / medication / SDOH packs at onboarding.
- **Pre-SLM NLU** — Intent heads (chat + Care) and app-surface entity linking run before
  Concierge generation; safety refuses block unknown protocols, dose changes, auto-911, and diagnosis asks.
- **On-device SQLite** — 34 repositories (patient, ADCP, alerts, meds, appointments, UC3/UC4,
  secure messaging, knowledge cache, …). SQLCipher-ready schema.
- **Audit + consent spine** — Every egress-bearing action must pass a default-deny consent
  gate; all decisions and clinically significant events are written to a tamper-evident
  audit log (`audit_log` + `consent_tokens` tables, `src/services/audit`,
  `src/services/consent`).
- **C-CDA / FHIR record format** — Typed SQLite rows remain the source of truth; a FHIR
  resource layer (`src/data/fhir/`) derives FHIR R4 JSON (Patient, Condition, Observation,
  MedicationStatement, CarePlan per the CDA-ccda profile). C-CDA XML is serialized only on
  consent-gated export/share via `ccdaExportService`. The personal care plan is a FHIR
  `CarePlan` resource with problem/goal/instruction structure.
- **Notifications & reminders** — `expo-notifications` (dynamic require, degrades to in-app
  banner on Track A) fires for three trigger classes: anomaly alerts (severity-3 = DND bypass),
  medication reminders (from structured `medication_schedules`), and appointment/care-task
  reminders. A deterministic reminder engine (no SLM) derives schedules with quiet-hours
  support. Per-trigger toggles in Settings.
- **Anomaly detection next-steps flow** — After the SLM explains an alert, the caregiver
  sees SLM-formulated multiple-choice next-step options from a constrained 8-action taxonomy
  (Call 911, Go to ER, Contact PCP, Find nearby service, Schedule appointment, Share record,
  Monitor at home, Add note). Each is wired to a real action via native deep-links (`tel:`,
  `maps://`/`geo:`) or in-app flows. Severity-3 always injects Call 911 + Go to ER first.
- **Settings & Developer/Demo mode** — A full Settings screen (model management, notification
  preferences, profile editing, consent management, audit log viewer with hash-chain
  verification, data reset/export, theme). **Demo mode** (default, persisted): auto SLM
  management, simplified UI. **Developer mode**: full diagnostics, manual SLM load/unload,
  raw demo screens, audit viewer.
- **Acute anomaly flow** — Simulated vitals feed the orchestrator; threshold violations
  create alerts; severity-3 emergencies short-circuit to the emergency fast path;
  lower-severity alerts can be explained by the SLM on demand, including multiple-choice
  clarifying questions and next-step actions. Alerts can be swipe-dismissed.

## Tech Stack

- **Framework:** Expo SDK ~56.0.12 + React Native 0.85.3 + expo-router
- **On-device Concierge:** llama.cpp via `llama.rn` — **Gemma-4-E2B-it Q4_K_M only** (`InferenceProvider`)
- **Pre-SLM NLU:** TFLite leaf-ir embedder + chat/care intent heads (`src/nlu/`)
- **Orchestration:** In-process MCP — 4 agents, CEP debounce, confidence router, prompt-budget guard
- **Retrieval:** CachedFusedRetriever — BM25 → graph 1-hop → dense rerank over global pack ∪ patient overlay
- **Clinical evidence:** On-device knowledge pack runner (`src/clinical-evidence/pack/`) + NLM clients (MedlinePlus, DailyMed, RxNorm, PubMed lit_lite, Orphanet, …); legacy live bundle behind flag
- **Local storage:** `expo-sqlite` patient DB (**34 repositories**, ADCP) + global `Documents/knowledge-pack/pack.sqlite`
- **Health Monitor / UC2–4:** TFLite autoencoder + decision / rehab-trajectory / micro-priorities engines
- **Wearables:** Apple Health bridge (iOS) + mock; Health Connect still scaffold
- **Notifications:** `expo-notifications` + in-app banner; deterministic reminder engine
- **FHIR/C-CDA:** R4 mappers + import + C-CDA export; fixtures Mike (v5.9/v6.2), Elena, James, Sofia
- **State management:** Redux Toolkit + Context (`Settings → PatientRecord → SLM → Sensor → UC2Runtime → Orchestrator → CriticalAlert`)
- **CEP:** Typed event bus before Alert ML / Concierge
- **Secure messaging:** Local AES-256-GCM; no transport (real E2EE post-v1.0)
- **Security:** `expo-secure-store`; default-deny consent gate; tamper-evident audit log

## Getting Started

### Prerequisites

- **Node.js LTS** (includes npm) — no global Expo CLI needed; use `npx expo`
- **Git LFS** — NLU embedder models (`.tflite`) are tracked via Git LFS. Run `git lfs install` before cloning, or `git lfs pull` after a fresh clone to download them.
- The **Expo Go** app on a physical iOS/Android device (for Track A)
- *(Track B only)* an **Expo account** for EAS cloud builds — no local Xcode / Android Studio required

### Two-track development

Because the project's core native modules (`llama.rn`, `react-native-fast-tflite`, SQLCipher, HealthKit /
Health Connect, the device-memory bridge) don't load in Expo Go, development runs on two tracks:

- **Track A — Expo Go (no native tooling):** all UI + the deterministic rule/threshold engine + event bus +
  **mocked** SLM / ML / RAG / wearable / device-memory providers. Covers most steel-thread UI work and
  demos the full click-paths. **This is the default day-to-day track.**
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

## Run the App from Scratch

These steps are for a clean local environment. The current project is an Expo SDK 56 / React Native 0.85 app with `expo-dev-client`, `llama.rn`, `react-native-fast-tflite`, a local native device-memory module, and notification plugins. Expo Go is useful for Track A UI/mock flows, but real native-module behavior requires a development build.

### Prerequisites

- **Node.js:** use the current Node.js LTS release. The repo does not define a stricter `engines.node` value in `package.json`.
- **npm or yarn:** npm is included with Node.js and is what the checked-in scripts use. A `package-lock.json` is present, so prefer npm for reproducible installs.
- **Git:** required to clone and switch branches.
- **Expo CLI:** no global install is required; use `npx expo ...`.
- **Android simulator:** install Android Studio, the Android SDK Platform Tools, and at least one Android Virtual Device through Device Manager.
- **iOS simulator:** macOS only. Install Xcode from Apple and open it once so command-line tools and simulators are available.
- **Local configuration:** no `.env`, `.env.example`, or required build-time environment file is present in this repo. Hugging Face, NCBI, and OpenFDA tokens are optional and are entered in-app through Settings/Models, then stored with `expo-secure-store`.

### Clone and Install

```bash
git clone <repository-url>
cd <project-folder>
git checkout development   # or your personal branch rebased onto development
npm install
```

If your workflow requires environment files later, create them from team-provided values only. This repository does not currently include a required env template to copy.

### Start Metro

```bash
npx expo start
```

Use a clean Metro cache if the bundler behaves strangely after dependency or native changes:

```bash
npx expo start --clear
```

### Android Simulator

Start an Android emulator from Android Studio Device Manager, or from a terminal if the Android SDK emulator is on your PATH:

```bash
emulator -list-avds
emulator -avd <avd-name>
```

For Expo Go / Track A, start Metro and press `a` in the Expo terminal to open Android:

```bash
npx expo start
```

For a development build with native modules, use the repo script:

```bash
npm run android
```

### iOS Simulator

iOS simulator support requires macOS and Xcode.

```bash
open -a Simulator
```

For Expo Go / Track A, start Metro and press `i` in the Expo terminal to open iOS:

```bash
npx expo start
```

For a development build with native modules, use the repo script:

```bash
npm run ios
```

### Expo Go vs. Development Build

- **Expo Go:** works for Track A UI, mock SLM/ML/RAG/wearable/device-memory paths, SQLite-backed app flows, and most navigation/debug work.
- **Development build:** required for real native modules such as `llama.rn`, `react-native-fast-tflite`, the local device-memory bridge, native notification behavior, and other custom native integration. Run `npm run android` or `npm run ios` locally, or use EAS development builds if that is your team workflow.

### Troubleshooting

- **Metro cache problems:** restart Metro with `npx expo start --clear`.
- **Port already in use:** stop the other Metro process, or let Expo choose another port when prompted by `npx expo start`.
- **Missing dependencies:** rerun `npm install`. If dependency state is badly out of sync, remove `node_modules` and reinstall without deleting source files.
- **Android emulator not detected:** confirm an emulator is running in Android Studio Device Manager, then check `adb devices`. If `adb` is unavailable, verify Android SDK Platform Tools are installed and on your PATH.
- **iOS simulator not detected:** confirm you are on macOS, Xcode is installed, and `open -a Simulator` launches a simulator before running `npm run ios`.
- **CocoaPods installation issues:** iOS development builds may need pods installed by Expo prebuild/run. If CocoaPods is missing or fails, install/fix CocoaPods on macOS, then rerun `npm run ios`.
- **Native-module incompatibility with Expo Go:** if a screen needs `llama.rn`, `react-native-fast-tflite`, the local device-memory bridge, or custom native notification behavior, use a development build instead of Expo Go.
- **Environment variables not loading:** this repo currently has no required `.env` template. Confirm the value is actually read from code before adding env files; app tokens currently use in-app secure storage.
- **Database or seed initialization problems:** use a normal app restart first. For fresh-install testing, clear simulator app data through the simulator/device UI, then relaunch so SQLite initialization and migrations can run before onboarding. Do not delete or recreate app databases on normal startup.

## Concierge (chat)

The **Concierge** tab (`src/app/(tabs)/assistant.tsx` → `src/app/slm.tsx`) is the full
caregiver chat surface for on-device **Gemma 4 E2B**. Turns run Pre-SLM NLU and
deterministic safety refuses before generation.

- **Multiline, auto-growing input** — The chat box is a `TextInput` with a custom
  `getPromptInputHeight()` helper that estimates line count from text length. The box
  grows from ~44 px (single line) up to ~180 px (about six lines) as the caregiver
  types, and shrinks back when they delete.
- **iOS safe-area aware** — Wrapped in `SafeAreaView` with `edges={['top', 'bottom']}`
  inside a `KeyboardAvoidingView`, so the input row never collides with the iOS home
  bar at rest or with the on-screen keyboard while typing.
- **Mock fallback** — If no native model is loaded, the screen returns a mock
  caregiver-specific response so the full UI flow is demoable in Expo Go.
- **Live device RAM** — While a model is loaded, a small RAM card shows used / free /
  total MB and the model's footprint on disk. The same data, plus a 1 Hz
  breakdown between the SLM and the rest of the system, is on the Performance screen.
- **Detailed Care Context** — A "Care Context" card lists every field from the
  onboarding profile (patient demographics, conditions, medications, vitals thresholds,
  baseline routine; caregiver experience, language, comfort level, backup; care team;
  safety / emergency contact) and the same data is injected into the SLM's system
  prompt.
- **System prompt preamble** — The internal prompt begins with a preamble that tells
  the model *who it is* (an embedded caregiver-support assistant), *who the user is*
  (a non-clinical family caregiver using the app in real time), what kind of answer is
  expected (Markdown, ~120–250 words, lead with the bottom line, then numbered steps
  and red flags), and explicit "never do" rules (no diagnosis, no dosing changes,
  escalate red flags). This preamble is what makes the same model produce
  caregiver-appropriate answers instead of generic medical text.
- **Control-token stripping** — Native parsing (`reasoning_format: 'auto'`, `jinja: true`)
  separates thinking from final answer; a safety-net `stripControlTokens()` util removes
  any leftover `<|channel|>`, `<thinking>`, or harmony tags before Markdown rendering.

## Performance / RAM Dashboard

The **Performance** screen (`src/app/performance.tsx`) is a live, 1 Hz RAM dashboard
backed by `src/services/performance/performanceService.ts`.

- **1 Hz polling** — `useRamSnapshot(intervalMs, slmSizeGB)` reads
  `NativeModules.DeviceMemory.getMemoryInfo()` (with a deterministic mock fallback on
  Track A / Expo Go) every second.
- **Breakdown** — Each snapshot splits the device's used RAM into the portion owned
  by the loaded SLM model (`slmMB = slmSizeGB * 1024`) and the rest of the system
  (`otherMB = usedMB - slmMB`). The two are shown as a stacked bar with a legend.
- **Severity pill** — `ramSeverity(usedRatio)` returns `ok` / `warn` / `crit`, labeled
  Healthy / Elevated / Critical, and recolors the progress bar accordingly. Thresholds
  are 0.75 (warn) and 0.9 (crit). Useful when a multi-GB SLM is loaded on a constrained
  device.
- **SLM status card** — Mirrors the SLM provider's state (load status, current model
  id, model size on disk, whether the native memory bridge is present) so the screen
  is self-explanatory in both Track A and Track B.

## Documentation

- [`docs/CURRENT_STATE.md`](./docs/CURRENT_STATE.md) — Short shipped-vs-deferred snapshot.
- [`docs/APP_GUIDE.md`](./docs/APP_GUIDE.md) — Screen-by-screen living guide.
- [`docs/MARKDOWN_GUIDE.md`](./docs/MARKDOWN_GUIDE.md) — Markdown renderer + Concierge output.

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
| L1 | React Native UI (Home, Care plan spine, Meds, Schedule, Concierge, Settings stack, HITL) | All three pillars |
| L2 | App Services (Context + Redux, notifications, consent, audit, care-plan coaching) | All three pillars |
| L3 | Event Bus — CEP + context aggregator | Care (anomaly CEP), Schedule |
| L4 | MCP orchestration — 4 agents, fused tool-RAG + knowledge-RAG, FHIR adapter | All three pillars |
| L5 | Decision Engine — Concierge (Gemma 4 E2B), Pre-SLM NLU, Health Monitor / UC2–4 | All three pillars |
| L6 | Knowledge — on-device pack + hybrid RAG, clinical-evidence clients | Meds + Care |
| L7 | Local Data — SQLite (34 repos), ADCP, Apple Health / mock sensors, FHIR fixtures | All three pillars |

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
│   ├── app/                     # Expo Router routes
│   │   ├── _layout.tsx          # Redux + Settings → … → CriticalAlert + overlays
│   │   ├── index.tsx            # Onboarding gate → Home
│   │   ├── onboarding.tsx       # Welcome + 5 form steps + demo/FHIR import
│   │   ├── (tabs)/              # 5 tabs: Home, Care, Meds, Schedule, Concierge
│   │   │   ├── dashboard.tsx    # Home
│   │   │   ├── care.tsx         # ADCP care-plan spine + Care ask
│   │   │   ├── medications.tsx  # Meds
│   │   │   ├── schedule.tsx     # Appointments + timeline
│   │   │   └── assistant.tsx    # Concierge tab → slm.tsx
│   │   ├── more.tsx             # Settings hub (stack, not a tab)
│   │   ├── alert-detail.tsx     # Alert metrics + on-screen Concierge sheet
│   │   ├── slm.tsx              # Full Concierge chat
│   │   ├── secure-messaging.tsx
│   │   ├── models.tsx / care-management.tsx / performance.tsx / …
│   │   └── ...
│   ├── components/              # dashboard/, care/, careConcierge/, messaging/, …
│   ├── contexts/                # settings, patient-record, slm, sensor, uc2, orchestrator, critical-alert
│   ├── store/                   # Redux Toolkit slices
│   ├── inference/               # InferenceProvider, llama.rn, model-catalog (Gemma 4 E2B only)
│   ├── nlu/                     # Pre-SLM NLU, app-surfaces, intent heads
│   ├── ml-models/               # UC2 / UC3 / UC4 + alert autoencoder
│   ├── services/                # carePlan/, slm/, ml/, uc3/, uc4/, messaging/, …
│   ├── orchestration/           # MCP, CEP bus, agents, next-steps
│   ├── knowledge/               # BM25, CachedFusedRetriever, embedder (TFLite / hash)
│   ├── clinical-evidence/       # API clients + pack/ runner + knowledge-bundle-runner
│   ├── data/                    # migrations, 34 repos, adcp/, fhir/, sensors/
│   ├── locator/                 # Geofence scaffold (deferred)
│   └── utils/
├── assets/models/nlu/           # leaf-ir TFLite + intent-head JSON
├── training/nlu/                # Offline NLU train / eval scripts
├── docs/                        # CURRENT_STATE, APP_GUIDE, MARKDOWN_GUIDE, …
└── package.json
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

License is currently undetermined. A `LICENSE` file will be added once the project
selects an appropriate open-source or proprietary license.

## Status

Active development. The prototype uses synthetic data only — no PHI is present in any test fixtures or development environments.
