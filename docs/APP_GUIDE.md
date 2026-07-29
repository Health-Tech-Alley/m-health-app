# Caregiver Concierge — App Guide

This document describes the current state of the mobile app: how it is built,
how each screen works, and the platform-specific (iOS/Android) considerations.
It is a living document — update it as the UI evolves.

> For a short shipped-vs-deferred snapshot, see [`CURRENT_STATE.md`](./CURRENT_STATE.md).
> For how Markdown is rendered and how Concierge is prompted to return
> Markdown, see [`MARKDOWN_GUIDE.md`](./MARKDOWN_GUIDE.md).
> For the high-level pitch, see the root [`README.md`](../README.md).
>
> **Last pass aligned to codebase:** 2026-07-27 (5-tab shell, Gemma-only catalog,
> Care ADCP spine, NLU/safety refuses, knowledge-bundle runner, 34 repos).

---

## 1. Build & Runtime Setup (Expo)

The app is an **Expo (managed) project, SDK 56** using **expo-router** for
file-based routing. Source lives under `src/`.

**Git LFS:** NLU embedder models (`mdbr-leaf-ir.tflite`, `mdbr-leaf-ir-int8.tflite`)
are tracked via Git LFS. Run `git lfs install` before cloning, or `git lfs pull`
after a fresh clone to download them.

### Two-track development

| Track | How to run | What works |
|-------|-----------|------------|
| **Track A — Expo Go** | `npx expo start`, scan QR with Expo Go | UI, navigation, all service logic. **Mocked** SLM / ML / RAG / device-memory providers. |
| **Track B — Dev build** | `npx eas build --profile development --platform ios\|android`, then `npx expo start --dev-client` | Everything, incl. real `llama.rn` (SLM), `react-native-fast-tflite` (Alert ML), and the native device-memory bridge. |

**Rule of thumb:** day-to-day UI work is Track A. Switch to Track B only when
you need to validate a real model load, a real anomaly score, or real
device-RAM numbers. Native modules **must** degrade gracefully on Track A —
they must not throw at startup when the bridge is absent.

### When do I need a native rebuild?

| Change type | Rebuild needed? |
|-------------|-----------------|
| TS/TSX, React components, styles, logic | ❌ No — Metro hot-reloads (`r` to reload) |
| New native dependency in `package.json` | ✅ Yes — `npx expo prebuild --clean` + EAS build |
| Native config (`app.json` plugins, `Info.plist`) | ✅ Yes |
| New asset extension in `metro.config.js` (e.g. `.tflite`) | ✅ Yes |
| Swift/Kotlin module code | ✅ Yes |

### Key config files

- `app.json` — Expo config + native permissions.
- `metro.config.js` — registers extra bundleable asset extensions.
- `tsconfig.json` — path alias `@/*` → `src/*`.

---

## 2. Navigation & Screens

Routing is file-based under `src/app/`. The root layout
(`src/app/_layout.tsx`) wraps Redux `Provider`, then:

`SettingsProvider → PatientRecordProvider → SLMProvider → SensorProvider →
UC2RuntimeProvider → OrchestratorProvider → CriticalAlertProvider`

plus global overlays (`InAppBanner`, `HypotheticalCriticalBanner`,
`CriticalAlertDialog`) and the `Stack` router (headers hidden).

Post-onboarding, the app uses a **5-tab** layout (`src/app/(tabs)/_layout.tsx`):

| Tab label | Route file | Role |
|-----------|------------|------|
| **Home** | `dashboard.tsx` | Patient summary, vitals, priorities, alerts |
| **Care** | `care.tsx` | Living care-plan spine (ADCP) + Care ask |
| **Meds** | `medications.tsx` | Medication CRUD + mark-as-given |
| **Schedule** | `schedule.tsx` | Appointments + timeline + notifications |
| **Concierge** | `assistant.tsx` → `slm.tsx` | Full on-device Concierge chat |

**Settings / More is not a bottom tab** — it is the stack screen `more.tsx`
(reached from Home chrome / profile entry points). Advanced prefs live at
`/settings`.

User-facing names (see `src/constants/user-terms.ts`): **Concierge**,
**Health Monitor**, **Your Review**, **Clinical Evidence** — never SLM / ML /
HITL / ADCP / UC2–4 in caregiver copy.

Every tab uses the branded `ScreenHeader` (Health Tech Alley logo + title).

| Route file | Purpose |
|------------|---------|
| `index.tsx` | Onboarding gate → Home or `/onboarding` |
| `onboarding.tsx` | Welcome + 5 form steps; demo presets + FHIR import |
| `(tabs)/_layout.tsx` | **5-tab** shell (Home, Care, Meds, Schedule, Concierge) |
| `(tabs)/dashboard.tsx` | **Home** — summary, weekly vitals (with reading time), alerts log, priorities |
| `(tabs)/care.tsx` | Care-plan spine: Plan Pulse, priorities, Your Review, therapy, goals, safety, monitoring, backup, **Care ask** |
| `(tabs)/medications.tsx` | Med list, schedules, confirm / custom-med Concierge check |
| `(tabs)/schedule.tsx` | Appointment CRUD, reminders, alert timeline, notifications |
| `(tabs)/assistant.tsx` | Concierge tab (re-exports `slm.tsx`, no back button) |
| `more.tsx` | Settings hub (stack) — profile, prefs, secure messaging, privacy, FHIR import, developer hub |
| `alert-detail.tsx` | Alert metrics + **Ask the Concierge** via on-screen `SlmInsightSheet` |
| `slm-explain.tsx` | Legacy/standalone orchestrator explain + next-steps path |
| `slm.tsx` | Full Concierge chat (also Concierge tab) |
| `secure-messaging.tsx` | Local encrypted messaging UI |
| `select-fhir-profile.tsx` / `ehr-complete.tsx` | FHIR persona pick + post-import |
| `profile.tsx` | Caregiver & patient profile (stack) |
| `models.tsx` | Concierge Brain download manager (Gemma 4 E2B only) |
| `care-management.tsx` / `health-monitor-demo.tsx` | Health Monitor harness |
| `acute-anomaly.tsx` | Orchestration E2E demo (developer) |
| `performance.tsx` | 1 Hz RAM dashboard |
| `notifications-reminders.tsx` / `logs.tsx` / `advanced-developer-settings.tsx` | Prefs / logs / dev |

### Service-layer rule

UI screens **never** import directly from `inference/`, native module
wrappers, `services/model-storage`, or `services/model-download`. They go through
the corresponding service module:

- SLM chat → `src/services/slm/slmService.ts`
- Device RAM → `src/services/performance/performanceService.ts` (on top of
  `src/services/device-memory.ts`)
- Onboarding profile → `src/services/onboarding/onboardingService.ts`
- Alert ML → `src/services/ml/alert-ml-service.ts`
- Audit / consent → `src/services/audit/auditService.ts`, `src/services/consent/consentGate.ts`

This keeps the UI swappable across providers and keeps the Track A / Track B
fallback in one place.

---

## 3. Screen-by-Screen

### Onboarding (`onboarding.tsx`)

First-run intake that populates `OnboardingProfile` via `onboardingService`.
Flow: **Welcome** + five form steps (Caregiver, Caregiving, Patient,
Safety/Provider, Wearable) + final **Device setup** slide. Optional **demo
presets** (Mike `mike-ehr-v62`, Elena, James, Sofia) and **FHIR import**.
After profile seed, Device setup shows two shared cards: **Concierge model**
(HF catalog, one download at a time) and **Clinical knowledge** (on-device pack
with section progress). **Continue to Home** stays disabled until the knowledge
pack is ready; leaving without a Concierge model shows a confirm dialog.
Keep-awake is active while downloads run. Seeded data drives Home, Concierge
system context, Health Monitor thresholds, and the Care plan spine.

### Home (`(tabs)/dashboard.tsx`)

Main caregiver home. Branded header, **patient summary** (bundle status),
**Alerts log** (Active / Inactive; open `alert-detail`; remove keeps audit row),
**Active alert card** (severity-aware metrics: SpO₂, SpO₂ cutoff, baseline HR;
Apple Watch vitals envelope; Path/Pattern including emergency fast path and
caregiver-reported), **Weekly vitals** (trends + selected reading **time**),
**Non-emergency insight**, priorities / activity, quick actions.

### Alert Detail (`alert-detail.tsx`)

Unified alert screen for all severities:

- **Severity 3:** Emergency actions — Call 911, Go to ER, Contact Provider,
  Acknowledge, Add Note — via `executeNextStep()` deep-links / in-app flows.
- **All severities:** Health Monitor metrics (top features, anomaly type,
  rule engine when present). **Ask the Concierge** opens `SlmInsightSheet` **on
  this screen** (prompt from `buildAlertExplainPrompt`) — it does **not**
  navigate away to a separate chat route. `slm-explain` remains available as a
  legacy/orchestrator path from developer flows.
- Acknowledge / Dismiss update alert status.

### SLM Explain (`slm-explain.tsx`)

The shared SLM explanation screen for all three steel threads. Takes an
`alertId` param. The flow:

1. Auto-loads the SLM if not ready (in Demo mode, this is automatic).
2. Calls `orchestrator.explainAlert(alertId, caregiverId)`.
3. Renders the explanation via `<MarkdownRenderer size="large">`.
4. Shows clinical citations (docIds from the fused retriever).
5. If `proposal.clarifyingQuestion` exists: shows the question + multiple-choice
   option buttons. On select, calls `orchestrator.answerClarifyingQuestion()`
   and re-renders.
6. If `proposal.nextSteps` exists: shows next-step options as buttons. On tap,
   calls `executeNextStep()` (native deep-link / consent-gated share / in-app
   scheduling). Shows the result message.
7. HITL: "Override" button opens a note modal; the override is logged as a
   `caregiver_action` + trigger event.
8. In Demo mode, `slm.scheduleAutoUnload()` is called after the flow completes.

### Care (`(tabs)/care.tsx`)

Living **care-plan spine** (ADCP `accessdp.careplan.v1` via `adcpRepository` +
`src/services/carePlan/`). Typical sections top-to-bottom:

1. **Hero / Plan Pulse** — ring + “What changed”
2. **Priorities** — UC4 micro-priorities (caregiver-facing cards; promote-to-plan HITL)
3. **Your Review** — pending plan proposals (confirm / reject; never silent apply)
4. **Therapy** — UC3 trajectory + daily care entry; in-card Concierge with compact therapy context
5. **Goals & activities** / **Safety rules** / **Monitoring**
6. **Backup & restore** — ADCP export/import
7. **Care ask** — free-text soft-NLU (`src/services/carePlan/coaching/`) +
   `CarePlanAskChat` / chips: emergency screen → care-intent head → preselect/chips →
   Concierge handoff. **Never auto-runs** clinical actions. Confirmed emergencies call
   `presentCaregiverReportedEmergency` (severity-3 dialog, path
   `caregiver_reported_emergency`).

Catalog intents include explain alert/monitoring/therapy/priorities, propose
therapy patch, promote priority, today’s logging, weekly review, handoff summary
(`intentCatalog.ts`). Proposal enqueue only accepts valid ADCP proposal kinds.

### Critical alert popup + Alerts log

Severity-3 is a **transient red dialog** (`CriticalAlertDialog` via
`CriticalAlertProvider`) — not a permanent card. Triggers: Health Monitor
emergency fast path, Care-ask caregiver-reported emergency, etc. Metrics show
SpO₂ when present, plus SpO₂ cutoff / baseline HR for sensor emergencies; Path
labels include **emergency fast path** and **caregiver reported**. Re-opens on
Care focus until dismissed. Actions: Call 911 / Go to ER / Contact Provider /
Close (session) / Dismiss / View full alert.

The **Dashboard** shows an **Alerts Log** (`AlertsLogCard`) instead of a
persistent card: alerts are grouped **Active** (`open` / `acknowledged`) and
**Inactive** (`dismissed` / `resolved` / `escalated`). Tapping a row opens
`alert-detail` (notes, actions, explain); the per-row **×** removes the alert
from the log (status `removed` — hidden from the log but retained in SQLite
for the tamper-evident audit trail). The log live-refreshes on
alert-affecting bus events.

**Non-critical alerts (severity 1–2)** fire an OS / in-app banner notification:
the orchestrator dispatches via the `dispatch_alert_notification` tool
(consent-gated), which on Track A surfaces as the global `InAppBanner`. This
lets the demo show how notifications react to dynamic data. (Severity-3 also
dispatches a notification, with DND bypass, alongside the popup.)

### Transient SLM use — `SlmInsightSheet`

A reusable bottom-sheet (`src/components/slm-insight-sheet.tsx`) for on-demand
SLM explanations that are not the main alert-explain flow (safety-note
explanations, custom-med checks). On open it acquires an SLM lease via the task
queue (auto-loads the configured default model in Demo/auto policy). If the
lease fails — Developer/manual policy with no model loaded, or the configured
default model isn't installed — the sheet explicitly loads any installed model
so the explanation works on a dev build (Track B) regardless of mode. The
status line shows the current phase plus the model id or a `(mock)` tag.

Chat output mirrors the SLM prompt demo screen: a "Loading…" → "Thinking…"
indicator, then the **raw token stream** rendered live while generating, which
is **replaced by the rendered Markdown answer** once generation completes. On
Track A (no `llama.rn`) or when no model is installed, it falls back to a
**streaming mock** (word-by-word) so the UX is still demonstrable instead of
dumping the whole answer at once. On close the lease is released and the task
queue's auto-unload timer unloads the model (auto policy); if the sheet loaded
the model itself without a queue lease, it unloads it on close (auto policy
only — in Developer/manual policy the developer manages the model). In dynamic
mode (doc 34), the model unloads **immediately** when the last lease ends
(`autoUnloadMs = 0`). The default model is configurable in **Settings →
Developer → Default SLM Model** (`demoDefaultModelId` in `app_settings`).

### Clinical knowledge pack (on-device)

Primary path is the **global knowledge pack** (`src/clinical-evidence/pack/`):
condition layers (spine, CPG digests, MedlinePlus topics, Orphanet, public
health, DME, lit_lite abstracts) install into
`Documents/knowledge-pack/pack.sqlite` once per device. **Medication layers**
(DailyMed labels, OpenFDA AE/recalls, live DDI, MedlinePlus drug pages) cover
**active chart medications only** and re-sync when meds are added/removed
(Meds tab, Concierge tools, FHIR import). Curated practical DDI pairs stay
offline. Ad-hoc drugs use on-demand overlay fetch. After install the pack
rebuilds an evidence graph and embeds **curated layers** (not PubMed
abstracts) with on-device leaf-ir (**float16**). Retrieval unions **pack ∪ patient overlay** (`knowledge_cache`
for CDA/ADCP/on-demand meds) with **BM25 → graph 1-hop → dense rerank**. Pack
updates never wipe patient overlay. The pack path is the **only** clinical
knowledge system (legacy multi-host bundling retired). Pack med/condition
inputs cover the **union of all stored patient records**, so switching
profiles only swaps the patient overlay and checks for deltas — never a full
re-download. Settings → Clinical knowledge uses the same progress card as
onboarding Device setup (install / update / reset pack vs clear patient
overlay). Developer settings hold NCBI / OpenFDA keys for higher limits.

### Medications (`(tabs)/medications.tsx`)

Lists active medications from `getActiveMedications(patientId)` joined with
schedule times from `getActiveMedicationSchedules(patientId)`. Shows the
**Health Tech Alley logo + branded header** ("Medication Management /
Medications"). For each med: name, dosage, frequency, schedule time, and a
status pill (Pending / Confirmed). Per-med actions:
- **Confirm Given** toggles to Confirmed (tap again to **unconfirm**) — audit-logged.
- **Edit** (note icon) opens a modal to edit name, dose, instructions, and
  **administration time** (updates the `medication_schedules` row).
- **＋ Add Medication** creates a custom med (`source='custom'`) with an optional
  schedule — audit-logged.
- Custom meds show a purple **Custom** badge and gain a **delete** (🗑) button
  (hard-delete + audit) and an **assistant check** (care icon) that opens the
  `SlmInsightSheet` (`custom_med_check` lease) to ask the SLM whether the custom
  med is a good choice, with a keep/modify/remove suggestion.

### Schedule (`(tabs)/schedule.tsx`)

Appointment scheduling persisted to the `appointments` SQLite table. Shows the
**Health Tech Alley logo + branded header** ("Scheduling & Timeline /
Schedule"). The form (type, provider, date, time, location, reason, reminder)
writes a row via `insertAppointment` + audit-logs, then shows a **fading toast**
("Appointment added — you'll be notified") and resets the form. The **Upcoming**
list reads `getUpcomingAppointments`; each row has **Edit** (opens a modal to
modify any field → `updateAppointment`) and **Delete** (confirmation dialog →
`deleteAppointment` + audit). A demo appointment is seeded on first run.

### Settings (`(tabs)/settings.tsx` → `settings-screen.tsx`)

Full settings surface with the **Health Tech Alley logo + branded header**
("Caregiver Concierge / Settings") and sections:
- **Appearance** — Theme toggle (light/dark/system)
- **Notifications** — Per-trigger toggles (anomaly, medication, appointment,
  care-task), appointment lead time, quiet hours
- **Consent Management** — Grant/revoke scopes (`ccda_export`, `location_access`,
  `fhir-share`, `pharmacy-communicator`, `provider-message`)

### More (`more.tsx` — stack, not a tab)

Settings hub: **Profile**, **Appearance**, **Preferences**, **Communication**
(secure messaging — local AES-256-GCM store), **Privacy & Records** (C-CDA
export), **EHR import** / FHIR persona select, **Developer / Demo** (mode
toggle, Health Monitor / acute-anomaly demos, Models, Performance, Concierge
chat, audit log hash-chain viewer, advanced settings → `/settings`), **About**.

### Profile (`/profile`)

An **isolated stack screen** (no bottom tab bar) reached from More →
"Caregiver & patient profile". Read-only patient / PCP / safety / preferences
cards, plus an **editable Caregiver card** — name, relationship, phone, and main
concern are tap-to-edit and persist via `upsertCaregiver` (SQLite) +
`saveOnboardingProfile` (in-memory) so the patient record snapshot stays in
sync. A "← Back" button returns to the previous screen.

### Performance (`/performance`)

Live RAM dashboard polling the device-memory bridge at 2 Hz. The used-RAM bar
is split into **SLM** vs **other** so the model's footprint is visible. On
Track A the native bridge is absent and a wandering mock supplies realistic,
visibly-changing values (sinusoidal wander in the 0.45–0.70 usage band) so the
dashboard is never static. Severity pill colors (ok/warn/crit) reflect the
current used ratio.

### Tab navigation

The **5-tab** shell (Home, Care, Meds, Schedule, Concierge) animates the active
icon (spring scale + fill). The **Concierge** tab renders `slm.tsx` without a
back button. Settings/More is stack-only.
- **Data** — Export C-CDA record (consent-gated), Reset all data
- **Developer** — Developer mode toggle, manual SLM load/unload, RAM dashboard
  link, audit log viewer with hash-chain verification, dev screen links
- **About** — Version, disclaimer

### Acute Anomaly Flow (`acute-anomaly.tsx`)

An end-to-end orchestration demo that exercises the MCP layer, the RAG system,
the SQLite data layer, and the SLM in one flow.

- **Simulate vitals** — The caregiver enters SpO2 and heart-rate values and taps
  "Send vitals to orchestrator". The screen publishes `vitals_sample` events on
  the orchestration event bus rather than writing directly to the database.
- **Orchestrator processing** — `Orchestrator.handleVitalsSample()` persists the
  sample, runs the CEP engine, checks active thresholds via the
  `safety-reviewer-agent`, and creates an alert. Severity-3 violations dispatch
  the emergency fast path immediately; severity 1–2 alerts wait for caregiver
  ground truth or an explicit "Explain" tap.
- **Explain with SLM** — For non-emergency alerts, the caregiver taps
  "Explain with SLM". The orchestrator builds an aggregated context via
  `ContextAggregator`, runs the fused retriever (`src/knowledge/fused-retriever.ts`)
  for tool-RAG + knowledge-RAG, and calls the SLM through the global
  `InferenceProvider`.
- **Multiple-choice clarifying questions** — If the SLM needs more information,
  it can return a `QUESTION:` block with `OPTIONS:`. The UI renders these as
  buttons. The caregiver's choice is logged as a `answer_clarifying_question`
  action and the orchestrator re-runs the explanation with the new fact.
- **Citations** — Every explanation shows the `docId` citations from the
  retrieved clinical chunks.

The screen is wrapped in `SafeAreaView edges={['top', 'bottom']}`.
Alerts can be swipe-dismissed (resolved) from the active list.

### Concierge chat (`slm.tsx`)

On-device Concierge chat (Gemma 4 E2B). Also the **Concierge** tab
(`assistant.tsx`, `showBackButton={false}`). Standalone `/slm` keeps Back.
Pipeline: **safety refuses** → **Pre-SLM NLU** (embedder + intent head +
retrieval packet) → generation with care context + citations. Streaming,
control-token stripping, multiline input, Care Context card.

- **Header card** — Concierge hero with subtitle.
- **Model Status card** — Current model id, size on disk, load status, and a
  horizontal chip selector of installed models + Download/Unload buttons.
- **Device RAM card** — Mini version of the Performance dashboard. Updates
  every 2 s (`useMemoryInfo(2000)`) and shows used / free / total MB and
  the model size on disk. Visible only while a model is loading or ready.
- **Care Context card** — Every field from the onboarding profile, grouped
  by section (Patient, Caregiver, Care Team, Safety). The same data is
  injected into the system prompt as ground truth.
- **Messages card** — `FlatList` of user/assistant bubbles. While
  streaming, raw tokens render in lighter/grey italic; on completion the
  reasoning (if any) stays grey and the final answer is rendered with
  `<MarkdownRenderer size="large">`.
- **Safety card** — Static reminder that the assistant is a prototype.
- **Mock fallback** — When no model is loaded, the screen returns a mock
  caregiver-specific response so the full UI is demoable in Expo Go.
- **Input row (sticky bottom)**:
  - **Multiline, auto-growing** `TextInput` driven by a custom
    `getPromptInputHeight()` helper that estimates line count from text
    length. Height is clamped to `[44, 180]` px. The input uses
    `scrollEnabled={false}` so it never fights the outer `ScrollView`, and
    `textAlignVertical="top"` for Android.
  - Wrapped in `SafeAreaView edges={['top', 'bottom']}` inside a
    `KeyboardAvoidingView` so the row never collides with the iOS home
    bar at rest, and never with the on-screen keyboard while typing.
  - **Ask** button toggles to a red **Stop** while a response is streaming.

### Models (`src/app/models/`)

- Catalog is **Gemma 4 E2B Instruct only** (`gemma-4-e2b`, Q4_K_M, ~2.4 GB) —
  `src/inference/model-catalog.ts`. HealthGPT-Pro entries were removed.
- Download from Hugging Face with progress, cancel, delete; optional HF token
  in `expo-secure-store`.
- Models live under the app documents `models/` directory (**git-ignored**).
- Shared **`SlmDownloadCard` + `useModelDownloadQueue`** power Models, Settings,
  and onboarding Device setup (one SLM download app-wide).

### Care Management (`src/app/care-management/`)

Implements the canonical ST-01-style flow:

1. **Pick a scenario** — Mock wearable scenarios in
   `src/ml-models/alert-autoencoder/mock-scenarios.ts`, each with an
   expected NORMAL / ANOMALOUS label.
2. **Vitals input** — The 6 core vitals are editable with range
   validation; derived features (pulse pressure, MAP, time-of-day, sleep
   window) are computed automatically.
3. **Run ML inference** — The real on-device `AlertAutoencoder` TFLite
   model produces an anomaly score vs. its trained threshold and an
   ANOMALOUS / NORMAL badge.
4. **Ask SLM to Explain** — Only offered when anomalous; the SLM produces
   a caregiver-facing explanation. Reasoning is wrapped in `<THINKING>`
   tags, the final answer in `<EXPLANATION>` tags; reasoning is collapsed
   under "Show reasoning process" while the final explanation is shown
   prominently in Markdown.
- SLM load/unload controls and a mini RAM monitor are mirrored here.
- Implemented as an MVC trio (`care-management-screen`,
  `care-management-controller`, `care-management-view`).

---

## 4. On-Device AI

### Concierge SLM (`llama.rn`)

- `InferenceProvider` → `LlamaRnProvider`; app-wide `SLMProvider` / `useSLM()`.
- **Single catalog model:** Gemma-4-E2B-it Q4_K_M (`DEFAULT_SLM_MODEL_ID`).
- Metal GPU when available (`n_gpu_layers: -1`).
- Reasoning channel via jinja + `reasoning_format: 'auto'`;
  `stripControlTokens()` before Markdown.
- Task queue + RAM gate control load/unload (Demo/auto vs Developer/manual).
- **Pre-SLM NLU** (`src/nlu/`): leaf-ir TFLite embedder (Track B) or hash mock
  (Track A); chat intent head + Care intent head; app-surface lexicon.
- **Safety refuses** (`safety-refuse-guardrails.ts`): unknown protocol, dose
  change, auto-emergency action, diagnosis request — before NLU/generation.

### System prompt: the caregiver assistant preamble

`buildCaregiverSystemContext()` in
`src/services/slm/slmService.ts` constructs the system prompt the SLM
sees on every turn. It has three blocks:

1. **Preamble** — Tells the model:
   - *Who it is*: an embedded caregiver-support assistant in
     "Caregiver Concierge: ACCESS-DP", built by Health Tech Alley for
     family caregivers of a severely disabled loved one (disability
     level ~3/5) with multiple comorbidities.
   - *Who the user is*: a non-clinical family caregiver using the app
     in real time, often in a stressful moment.
   - *What kind of answer is expected*: plain, calm, practical;
     Markdown; ~120–250 words; lead with the bottom line; 2–5 numbered
     or bulleted steps; concrete numbers from the care context; warm
     tone; address the caregiver by name.
   - *What it must never do*: never diagnose, never prescribe or change
     a dose, never replace a clinician or emergency services, never
     invent facts.
   - *Escalation rules*: red-flag symptoms (trouble breathing, chest
     pain, SpO2 below cutoff, etc.) → lead with "Call 911 / your local
     emergency number now".
2. **Care Context block** — Every field from the onboarding profile
   (patient demographics, conditions, medications, vitals thresholds,
   baseline routine; caregiver experience, language, comfort level,
   backup; care team; safety / emergency contact), used as ground truth.
3. **Closing reminder** — A short restatement of the personalization,
   Markdown, and escalation rules.

### Data layer (`src/data/`)

Uses `expo-sqlite` with a migration-driven schema. Tables include:
`patients`, `caregivers`, `providers`, `medications`, `medication_schedules`,
`patient_conditions`, `care_plans`, `care_plan_goals`, `health_samples`,
`thresholds`, `alerts`, `caregiver_actions`, `rag_citations`,
`slm_turns` (with `tokens_generated` + `peak_ram_bytes`), `slm_citations`,
`trigger_events`, `graph_edges`, `audit_log`, `consent_tokens`,
`fhir_resources` (FHIR cache + export queue), `notifications`,
`notification_preferences`, and `app_settings`. Repositories in
`src/data/repositories/` are the only sanctioned read/write surface.
The schema is designed so SQLCipher can be swapped in later with minimal
changes. The public API is exported from `src/data/index.ts`.

### RAG (`src/knowledge/`)

`TrackAFusedRetriever` is the public seam. One `retrieve()` call returns
both MCP tool schemas (tool-RAG) and clinical knowledge chunks
(knowledge-RAG) in a single hop using BM25 + deterministic hash
embedder + reciprocal rank fusion. Track A runs over synthetic fixtures
for PubMed/MedlinePlus, RxNorm, DailyMed, OpenFDA, and the patient plan.
Track B will use a real sub-1B embedder and live clinical clients. The
layer also contains graph helpers (`src/knowledge/graph/`) for context
subgraph projection and edge writing.

### MCP orchestration (`src/orchestration/`)

The `Orchestrator` is the single chokepoint. It subscribes to the event
bus, runs the CEP engine (with 3-second debouncing for vitals bursts),
calls four agents through an in-process MCP-style tool contract
(`caregiver`, `patient-state`, `coordinator`, `safety-reviewer`), and
invokes the SLM only after caregiver ground truth or on an explicit
"Explain" tap. A **confidence router** returns preliminary guidance for
severity-3 alerts without loading the SLM. A **prompt-budget guard**
truncates the explain prompt to fit the model's context window. The SLM
system prompt now includes **care plan goals** alongside active thresholds.
After the SLM explains, it formulates **multiple-choice next-step options**
from a constrained 8-action taxonomy, each wired to native deep-links or
in-app flows. `OrchestratorProvider` instantiates one orchestrator at app
start and seeds the SQLite profile; `useOrchestrator()` is how UI screens
access it.

### Alert ML (`react-native-fast-tflite`)

- Dense autoencoder (`tiny_uc2_autoencoder.tflite`) for vitals anomaly
  detection.
- 18 input features, `StandardScaler` normalization
  (mean/scale from `tiny_uc2_scaler.json`), threshold from
  `tiny_uc2_metadata.json`).
- Loaded with the **CoreML delegate** on iOS for GPU acceleration
  (`enableCoreMLDelegate: true` in `app.json`).
- Auto-loads when the Care Management screen mounts.
- The orchestrator uses `MockAlertAutoencoder` in Track A so the anomaly
  path is demoable without a real TFLite runtime.

### Notifications & reminders (`src/services/notifications/`)

`notificationService.ts` wraps `expo-notifications` via dynamic `require()`
(degrades to in-app banner on Track A / Expo Go). Fires for three trigger
classes: anomaly alerts (severity-3 = DND bypass), medication reminders
(from `medication_schedules` table), and appointment/care-task reminders.
60-second dedupe per trigger. `reminderEngine.ts` is a deterministic
scheduler (no SLM) that derives med-reminder schedules with quiet-hours
support. An in-app banner component (`src/components/notifications/in-app-banner.tsx`)
subscribes to the fallback emitter and shows slide-in, color-coded banners
that auto-dismiss after 8 seconds for non-critical alerts.

### C-CDA / FHIR (`src/data/fhir/`, `src/services/export/ccdaExportService.ts`)

Typed SQLite rows → FHIR R4 JSON mappers (Patient, Condition, Observation,
MedicationStatement, CarePlan per the CDA-ccda profile with problem/goal/
instruction structure). C-CDA XML is serialized only on consent-gated
export via `ccdaExportService`, which builds a CCD document with Header
(recordTarget, author, confidentiality) + Body sections (Vital Signs,
Problems, Medications, Care Plan) and enqueues to the `fhir_resources` table.
The `ccda_export` consent scope gates egress.

### Settings & Developer/Demo mode (`src/contexts/settings-context.tsx`)

`SettingsContext` persists the mode (demo/developer, demo default), theme,
notification preferences, and the **Dynamic Concierge Loading** toggle to the
`app_settings` SQLite table. In **Demo mode**, the SLM auto-loads on "Ask the
assistant" and auto-unloads after 60s idle or on app background; dev routes are
hidden. In **Developer mode**, full manual SLM load/unload, audit log viewer
with hash-chain verification, and all diagnostic surfaces are available in
Settings → Developer. The `SlmPolicySync` component in the root layout syncs
the SLM policy with the mode.

#### Dynamic Concierge Loading (doc 34)

**Concierge chat grace (10s):** Leaving the Concierge tab does **not** immediately
unload the model. A 10-second cool-down keeps the chat lease alive so mid-stream
generation can finish and accidental tab taps do not kill the answer. The header
status icon shows a depleting ring while the cool-down is active; returning to
Concierge cancels the cool-down and keeps the model loaded.

The **Dynamic SLM Loading** toggle (default: ON) controls how the Concierge
model is loaded and unloaded:

| Mode | Behavior |
|------|----------|
| **ON (default)** | No cold-start load. No foreground auto-reload. Load only when the Concierge tab is focused, an explain/insight task runs, or a warm pin fires. Immediate unload when the last lease ends. |
| **OFF (legacy)** | Load at startup (500ms delay). Reload on foreground return. 30s background unload grace. Both paths include a free-RAM gate and one delayed OOM retry. |

**Where the toggle lives:** Settings → Developer → Advanced Developer Settings
→ Concierge Management → Dynamic Concierge Loading.

**Warm pins:** When Dynamic is ON, the model speculatively loads when:
- The alert detail screen is focused (`preload_warm` lease)
- A severity-3 critical popup appears (1.5s delayed warm pin)

**Emergency short-circuit:** Severity-3 emergency actions (Call 911, Go to ER)
never wait on the SLM load. The warm pin is purely for optional follow-up
explanation.

**OOM fix (shared by both modes):** Before attempting a load, a RAM gate
checks `freeMB >= modelSize × 1.25` (or `freeMB >= modelMB + 500`). If the
gate fails, one delayed retry (4s) fires if free RAM improved by 100+ MB.
After that, the user must tap to retry manually.

---

## 5. Platform-Specific Notes (iOS / Android)

### iOS

- **Status bar / Dynamic Island** — Every screen that has a sticky top
  card is wrapped in `SafeAreaView` with at least `edges={['top']}`; the
  ones with sticky bottom inputs also include `'bottom'` so the iOS
  home bar never overlaps content.
- Tab-based navigation uses `expo-router` `Tabs` (5 tabs: Home, Care,
  Meds, Schedule, Concierge). Settings/More is a stack screen.
- Concierge uses **Metal** when available; Health Monitor TFLite may use the
  **CoreML** delegate on iOS.
- Local dev build requires macOS + Xcode. A physical device gives
  realistic SLM/ML performance; the simulator works for UI but not for
  representative inference speed or memory.
- Device RAM monitor reads physical memory via the native bridge.

### Android

- Native bottom navigation via Material (where used).
- TFLite GPU acceleration would use the NNAPI / android-gpu delegates
  (CoreML is iOS-only); revisit delegate selection per platform before
  shipping Android.
- Local dev build requires the Android SDK.
- `predictiveBackGestureEnabled` is disabled in `app.json`.

### Cross-platform

- Every native capability has a graceful fallback so Track A (Expo Go)
  doesn't crash — missing native modules surface a message instead of
  throwing at startup. The device-memory bridge falls back to a mock
  module, the SLM falls back to a mock response, and the orchestrator
  uses a mock alert autoencoder.
- Secrets (HF token) use `expo-secure-store` → iOS Keychain / Android
  Keystore.

---

## 6. Theming & UI System

- Theme colors come from `src/constants/theme.ts` and are consumed via
  `useTheme()`. Brand teal is `#0E6F68`; the dashboard currently uses
  `#008573` for its header accent. Never hardcode colors.
- Spacing is consistent across cards (16–22 px padding, 16–24 px border
  radius). `Spacing` tokens live in `src/constants/theme.ts`.
- Markdown output is rendered by
  `src/components/markdown-renderer.tsx`
  (`@believer/react-native-markdown-display`), with a `size` prop
  (`normal` / `large`) so final SLM answers render larger than inline
  / reasoning text.
- Sticky bottom inputs (chat, etc.) use the
  `SafeAreaView` + `KeyboardAvoidingView` + `multiline TextInput` pattern.
  Two height strategies are in use: `onContentSizeChange` clamped to a
  min/max, or the SLM screen's custom `getPromptInputHeight()` helper.

See [`MARKDOWN_GUIDE.md`](./MARKDOWN_GUIDE.md) for how to author and
render Markdown in the app.

---

## 7. Pre-SLM NLU

The **Pre-SLM NLU** pipeline runs *before* the Concierge SLM on every chat
and explain turn. It classifies caregiver intent, links entities, and
assembles a budgeted packet of tools + clinical evidence chunks.

### Pipeline

```
prompt → EntityLinker → leaf-ir embed (TFLite) → IntentHead (JS)
      → skill/tool filter → BM25+dense RRF → BudgetAssembler → PreSlmPacket → SLM
```

### Key files

| File | Purpose |
|------|---------|
| `src/nlu/` | NLU module (types, facade, entity linker, intent head, section chunker, budget assembler) |
| `src/nlu/pre-slm-nlu.ts` | Main facade — orchestrates the full pipeline |
| `src/nlu/entity-linker.ts` | Dictionary-based entity extraction |
| `src/nlu/intent-head.ts` | Linear classifier on 768-d leaf-ir embeddings |
| `src/nlu/section-chunker.ts` | Splits long knowledge rows into section-aware children |
| `src/nlu/budget-assembler.ts` | Enforces per-intent tool/chunk budgets |
| `src/nlu/patient-nlu-context.ts` | Builds NLU context from patient snapshot + static lexicon |
| `src/nlu/lexicons/entity-lexicon.json` | Static entity dictionaries from use-cases tracker |
| `src/knowledge/embedder.ts` | TfliteEmbedder (mdbr-leaf-ir, 768-d) + HashMockEmbedder (Track A) |
| `assets/models/nlu/mdbr-leaf-ir-int8.tflite` | Primary embedder model (~59 MB, weight-only INT8) |
| `assets/models/nlu/intent-head.json` | Trained intent classifier coefficients |
| `assets/models/nlu/care-intent-head.json` | Care soft-NLU second head |
| `training/nlu/` | Offline Python training + eval scripts (expects local utterance / qrel corpora) |

### Intent labels (14)

`knowledge_qa`, `vitals_what_if`, `med_check`, `explain_anomaly`,
`clarifying_qa`, `next_steps`, `schedule_care`, `visit_prep`,
`portal_draft`, `summarize_ehr`, `detect_care_gaps`, `draft_care_plan`,
`caregiver_chat_general`, `other`

### Track A vs Track B

| Feature | Track A (Expo Go) | Track B (dev build) |
|---------|-------------------|---------------------|
| Embedder | HashMockEmbedder (128-d) | TfliteEmbedder (768-d, leaf-ir INT8) |
| Intent classifier | Keyword fallback | Trained linear head on embeddings |
| Entity linker | Dictionary-based | Same |
| Retrieval | BM25-only | BM25 + dense RRF |

### Training

```bash
# venv with sentence-transformers + scikit-learn
python training/nlu/train_intent_head.py
python training/nlu/eval_intent.py
python training/nlu/eval_retrieval.py
python training/nlu/build_entity_lexicon.py
python training/nlu/train_care_intent_head.py
python training/nlu/eval_care_intent.py
```

See `training/nlu/README.md` and `assets/models/nlu/README.md` for corpus paths and quality gates.

### Latest offline metrics (2026-07-13)

| Gate | Result |
|------|--------|
| Intent holdout accuracy | **0.96** (≥ 0.85) |
| Macro-F1 | **0.97** (≥ 0.80) |
| `vitals_what_if` precision | **0.91** (≥ 0.90) |
| `knowledge_qa` recall | **0.91** (≥ 0.80) |
| Hybrid vs BM25 Recall@5 | **0.75 > 0.63** (PASS) |
| Hybrid vs BM25 MRR | **0.89 > 0.84** (PASS) |

Watch Metro logs for: `[PreSlmNlu] intent=… conf=…` and `[SLM Chat] NLU: …`.
