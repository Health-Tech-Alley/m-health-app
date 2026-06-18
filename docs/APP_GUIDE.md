# Caregiver Concierge — App Guide

This document describes the current state of the mobile app: how it is built,
how each screen works, and the platform-specific (iOS/Android) considerations.
It is a living document — update it as the UI evolves.

> For the project mission, architecture summary, and contributor conventions,
> see the root [`AGENTS.md`](../AGENTS.md).
> For how Markdown is rendered and how the SLM is prompted to return
> Markdown, see [`MARKDOWN_GUIDE.md`](./MARKDOWN_GUIDE.md).
> For the high-level pitch, see the root [`README.md`](../README.md).

---

## 1. Build & Runtime Setup (Expo)

The app is an **Expo (managed) project, SDK 56** using **expo-router** for
file-based routing. Source lives under `src/`.

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
(`src/app/_layout.tsx`) wraps everything in the Expo theme, the
`AnimatedSplashOverlay`, the **global SettingsProvider**
(`src/contexts/settings-context.tsx`), the **global SLMProvider**
(`src/contexts/slm-context.tsx`), the **global OrchestratorProvider**
(`src/contexts/orchestrator-context.tsx`), the `InAppBanner`, and the
`Stack` router with hidden headers.

Post-onboarding, the app uses a **tab-based layout** (`src/app/(tabs)/_layout.tsx`)
with five tabs: Dashboard, Care, Medications, Schedule, Settings. Stack overlay
screens (`alert-detail`, `slm-explain`, dev screens) are pushed on top of the tabs.

Every tab screen shares a consistent branded header: the **Health Tech Alley logo**
in a teal rounded square to the left of the screen title, rendered by the reusable
`ScreenHeader` component (`src/components/ui/screen-header.tsx`).

| Route file | Implementation | Purpose |
|------------|----------------|---------|
| `index.tsx` | Redirect | First route → onboarding or `/(tabs)/dashboard` |
| `onboarding.tsx` | Inline | 5-step intake (welcome + 4 data steps). Redirects to `/(tabs)/dashboard` on completion. |
| `(tabs)/_layout.tsx` | expo-router `Tabs` | 5-tab shell (Dashboard, Care, Medications, Schedule, Settings) |
| `(tabs)/dashboard.tsx` | Inline | Branded header + patient summary + weekly vitals + non-emergency insight + priority/activity |
| `(tabs)/care.tsx` | Inline | Branded header + patient snapshot + tappable safety considerations + editable care plan (daily entry persisted to `daily_care_entries`) + care analysis link |
| `(tabs)/medications.tsx` | Inline | Branded header + med list + schedules + "Mark as given" |
| `(tabs)/schedule.tsx` | Inline | Branded header + appointments placeholder + alert timeline + notifications |
| `(tabs)/settings.tsx` | `src/components/settings/settings-screen.tsx` | Branded header + full settings surface |
| `alert-detail.tsx` | Inline | Unified alert detail (ST-01/02/03, severity-based) |
| `slm-explain.tsx` | Inline | SLM explanation + clarifying Q + next-steps flow |
| `acute-anomaly.tsx` | Inline | End-to-end orchestration demo (dev) |
| `slm.tsx` | Inline | Caregiver Assistant chat (dev) |
| `models.tsx` → `models-screen.tsx` | `src/app/models/` (MVC) | Model manager (dev) |
| `care-management.tsx` → `care-management-screen.tsx` | `src/app/care-management/` (MVC) | Vitals → Alert ML → SLM "Explain" flow |
| `performance.tsx` | Inline | 1 Hz RAM dashboard (dev) |

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

First-run intake that populates the `OnboardingProfile` in the
`onboardingService`. The flow is a welcome step followed by four data steps:
About You, Your Caregiving, About Patient, and Safety & Providers. On app
start, `OrchestratorProvider` seeds the local SQLite database from the
onboarding profile via `src/data/seed/seedFromProfile.ts`. The seeded patient,
caregiver, conditions, medications, and initial thresholds drive the Care
Context card, the SLM system prompt, and the orchestrator's threshold engine.

### Dashboard (`(tabs)/dashboard.tsx`)

The main caregiver home dashboard. Shows the **Health Tech Alley logo + branded
header** ("Caregiver Concierge / Dashboard"), a patient summary card with latest
SpO2 and heart rate, then **severity-colored alert cards** that subscribe to the
event bus for `ml_alert_created` and `vitals_sample` events. Each alert card has
a severity dot (red for 3, orange for 2, teal for 1), title, body, and a "View"
button that pushes to `alert-detail`. A quick-actions grid links to Care,
Medications, and Schedule. For severity-3 alerts, a red emergency banner appears
at the top.

### Alert Detail (`alert-detail.tsx`)

A unified screen pushed on top of the tabs that handles all three steel
threads, parameterized by alert severity:

- **Severity 3 (ST-03 acute):** Big red emergency banner with options — Call
  911, Go to ER, Contact Provider, Acknowledge, Explain, Add Note. Each option
  (except Acknowledge/Explain) is wired to `executeNextStep()` which fires
  native deep-links (dialer, maps) or in-app flows. The "Explain" button pushes
  to `slm-explain`.
- **Severity 1–2 (ST-01 anomaly):** Shows vitals info and an "Ask the
  assistant" button that pushes to `slm-explain?alertId=...`.
- Acknowledge and Dismiss buttons update the alert status.

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

Care management hub. Shows the **Health Tech Alley logo + branded header**
("Care Management / Care"), a patient snapshot (name, conditions), and the
**Safety Considerations** card: each consideration renders on its own line
(no trailing period). Tapping a consideration opens a combined explanation
dialog (safety note + why it matters + recommendation) with an
**Explain with assistant** button that opens the shared `SlmInsightSheet`
(controlled SLM load/unload — see below). The **Care Plan** card shows the
therapy day's progress; pain before/after, fatigue, and the caregiver note are
**tappable and persisted** to the `daily_care_entries` SQLite table via
`upsertDailyCareEntry`. The legacy "Your Response" action block was removed
(those actions now live in the active-alert pop-up).

### Active alert pop-up (Home + Care)

The severity-3 active alert is no longer an inline section in the dashboard
scroll — it is an **in-app modal pop-up shown once per app cold-start**
(`ActiveAlertProvider` + `ActiveAlertModal`, mounted globally in `_layout.tsx`).
Actions: **Call 911** opens the phone dialer with `911` populated (does not
place the call) and audit-logs; **Acknowledge** opens a severity-stressing
dialog then audit-logs; **Add Note** shows an inline audit-logged note input;
**Remind me later** = temp-dismiss (hides for the session, reappears next cold
start); **Clear without rectifying** = confirmation dialog → persistently
cleared in `app_settings` + audit-logged. The dashboard bell reopens the modal
while an alert is active.

### Transient SLM use — `SlmInsightSheet`

A reusable bottom-sheet (`src/components/slm-insight-sheet.tsx`) for on-demand
SLM explanations that are not the main alert-explain flow (safety-note
explanations, future custom-med checks). On open it acquires an SLM lease via
the task queue (auto-loads the configured default model in Demo mode), shows a
"Loading…" → "Thinking…" indicator, then streams the answer (which occupies the
thinking space). On close the lease is released and the task queue's auto-unload
timer unloads the model. Falls back to the mock assistant on Track A. The
default model is configurable in **Settings → Developer → Default SLM Model**
(`demoDefaultModelId` in `app_settings`).

### Clinical-evidence bundle status

The condition bundler (`src/clinical-evidence/condition-bundler.ts`) now wraps
its run in try/finally and records a 3-state `BundleStatus`
(`in_flight` / `complete` / `failed`) in `app_settings`, so the dashboard never
gets stuck on "Enrichment in progress…" — if the live PubMed/MedlinePlus fetch
fails (e.g. offline on Track A), the Patient Summary shows
"Live fetch unavailable — using offline knowledge" and the bundle is retried
once on the next cold start. **Settings → Developer → Clinical Evidence API
Keys** exposes NCBI (PubMed) and OpenFDA key fields; MedlinePlus, RxNorm, and
DailyMed require no key.

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

### More (`(tabs)/more.tsx`)

Profile + preferences hub. **Profile** row combines caregiver + patient into a
single link to `/profile` (previously two rows navigated to the same screen).
**Notification preferences** opens an in-app modal with live toggles backed by
`SettingsContext` (anomaly, medication, appointment, care-task). Developer/Demo
section links to the acute-anomaly demo, model management, and the
**Performance** dashboard.

### Profile (`/profile`)

Read-only patient / PCP / safety / preferences cards, plus an **editable
Caregiver card** — name, relationship, phone, and main concern are tap-to-edit
and persist via `upsertCaregiver` (SQLite) + `saveOnboardingProfile`
(in-memory) so the patient record snapshot stays in sync.

### Performance (`/performance`)

Live RAM dashboard polling the device-memory bridge at 2 Hz. The used-RAM bar
is split into **SLM** vs **other** so the model's footprint is visible. On
Track A the native bridge is absent and a wandering mock supplies realistic,
visibly-changing values (sinusoidal wander in the 0.45–0.70 usage band) so the
dashboard is never static. Severity pill colors (ok/warn/crit) reflect the
current used ratio.

### Tab navigation

The 5-tab shell animates the active icon: a spring scales the icon up and a
timing transition fills the circle background, giving a tactile transition
between tabs.
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

### SLM Prompt / Caregiver Assistant (`slm.tsx`)

The on-device SLM chat playground. Streaming output, control-token stripping,
multiline auto-growing input, and a detailed Care Context card.

- **Header card** — "Caregiver Assistant / SLM Support" hero with subtitle.
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

- Lists the model catalog (`src/inference/model-catalog.ts`): HealthGPT Pro
  4B (Q4_K_M), Gemma 4 E4B (UD-Q2_K_XL), Gemma 4 E2B (UD-Q2_K_XL).
- Download from Hugging Face with live progress, cancel, delete.
- Optional Hugging Face token (stored via `expo-secure-store`) for gated
  repos; token can be shown/hidden and saved from the same screen.
- "Clear All Models" wipes the on-device `models/` directory (incl.
  partial downloads).
- Models are stored in the app's document directory and are **git-ignored**.
- Implemented as an MVC trio (`models-screen`, `models-controller`,
  `models-view`) using `ThemedText` / `ThemedView`.

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

### SLM (`llama.rn`)

- Wrapped behind `InferenceProvider`
  (`src/inference/inference-provider.ts`); the real impl is
  `LlamaRnProvider`.
- A single instance is shared app-wide via `SLMProvider`
  (`src/contexts/slm-context.tsx`) and consumed with the `useSLM()` hook.
- **Metal GPU acceleration** is enabled (`n_gpu_layers: -1`).
- Model catalog lives in `src/inference/model-catalog.ts`: HealthGPT Pro
  4B, Gemma 4 E4B, Gemma 4 E2B.
- Structured-output models (Gemma "harmony" channels, `<thinking>` tags)
  are parsed by llama.rn into `content` (answer) + `reasoning_content`
  (thinking). A `stripControlTokens()` safety net in
  `src/utils/stripControlTokens.ts` removes any leftover control tokens
  before Markdown rendering.

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
for OpenEvidence, RxNorm, DailyMed, OpenFDA, and the patient plan.
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
and notification preferences to the `app_settings` SQLite table. In **Demo
mode**, the SLM auto-loads on "Ask the assistant" and auto-unloads after
60s idle or on app background; dev routes are hidden. In **Developer mode**,
full manual SLM load/unload, audit log viewer with hash-chain verification,
and all diagnostic surfaces are available in Settings → Developer. The
`SlmPolicySync` component in the root layout syncs the SLM policy with
the mode.

---

## 5. Platform-Specific Notes (iOS / Android)

### iOS

- **Status bar / Dynamic Island** — Every screen that has a sticky top
  card is wrapped in `SafeAreaView` with at least `edges={['top']}`; the
  ones with sticky bottom inputs also include `'bottom'` so the iOS
  home bar never overlaps content.
- Tab-based navigation uses `expo-router` `Tabs` (5 tabs: Dashboard, Care,
  Medications, Schedule, Settings).
- SLM uses **Metal**; Alert ML uses the **CoreML delegate**.
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
