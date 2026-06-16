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
`AnimatedSplashOverlay`, the `Stack` router with hidden headers, the
**global SLMProvider** (`src/contexts/slm-context.tsx`), and the
**global OrchestratorProvider** (`src/contexts/orchestrator-context.tsx`).
A separate `app-tabs.tsx` component exists but is **not currently wired into the
root layout**.

| Route file | Implementation | Purpose |
|------------|----------------|---------|
| `index.tsx` | Re-exports `onboarding.tsx` | First-run caregiver + patient intake. |
| `onboarding.tsx` | Inline | 5-step intake (welcome + 4 data steps). |
| `dashboard.tsx` | `src/components/dashboard/CaregiverDashboardScreen.tsx` | Main caregiver home dashboard. |
| `medications.tsx` | Inline | Medication Management placeholder. |
| `care.tsx` | Inline | Care Management placeholder. |
| `schedule.tsx` | Inline | Scheduling & Tracking placeholder. |
| `models.tsx` → `models-screen.tsx` | `src/app/models/` (MVC, themed) | Download / delete on-device SLM models. |
| `slm.tsx` | Inline | Caregiver Assistant chat (streaming, mock fallback). |
| `care-management.tsx` → `care-management-screen.tsx` | `src/app/care-management/` (MVC) | Vitals → Alert ML → SLM "Explain" flow. |
| `acute-anomaly.tsx` | Inline | End-to-end orchestration demo with swipe-to-dismiss alerts. |
| `performance.tsx` | Inline | 1 Hz RAM dashboard with SLM/other breakdown. |
| `profile.tsx` | Inline | Lightweight profile view used by some routes. |
| `explore.tsx` | Inline | Expo starter info + collapsibles. |
| `ai.tsx` | Inline | Auxiliary mock AI chat surface. |

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

### Dashboard (`dashboard.tsx` → `CaregiverDashboardScreen`)

The main caregiver home dashboard. Lives inside a top-safe
`SafeAreaView` (`edges={['top']}`) so the header card clears the iOS status
bar / Dynamic Island. The header card shows the **Health Tech Alley logo** on
the left and "Caregiver Concierge / ACCESS-DP" on the right.

Below the header:

- **PatientSummaryCard** — one-line summary of the patient in the active
  onboarding profile.
- **Main Features** section — `MainFeatureCard`s for Medication Management,
  Care Management, and Scheduling Management. Each links to the matching
  placeholder route.
- **AI & Insights** section — Models, SLM Prompt, Care Management (Alert ML
  flow).
- **Prototype Tools** section — Acute Anomaly, RAM / Performance Check.
- **RecentActivityCard** + **QuickActionsCard**.

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

### Performance / RAM Dashboard (`performance.tsx`)

A live, 1 Hz RAM dashboard backed by
`src/services/performance/performanceService.ts`.

- **Hero summary card** — Three big numbers (Used / Free / Total) plus a
  color-coded severity pill (`ok` / `warn` / `crit`, labeled Healthy /
  Elevated / Critical) and a progress bar. The bar recolors green → amber →
  red as `usedRatio` crosses 0.75 / 0.9. When a model is loaded, the SLM
  portion of the bar is overlaid in brand teal.
- **Used RAM breakdown card** — A legend (SLM model vs Other) and a
  stacked bar showing the two pieces in MB. "Other" = everything else
  (system, foreground app, other apps).
- **SLM status card** — Mirrors the SLM provider's state: `loadStatus`,
  `currentModelId`, `modelSizeGB` on disk, and whether the native memory
  bridge is present (vs the Track A mock).
- **Safe-area aware** — Wrapped in `SafeAreaView` with
  `edges={['top', 'bottom']}`.

Data flow:

```
useRamSnapshot(1000, modelSizeGB)
  → NativeModules.DeviceMemory.getMemoryInfo()  (Track B)
  → mock module (Track A) when the native bridge is absent
  → RamSnapshot { usedMB, freeMB, totalMB, appMB, slmMB, otherMB, ... }
```

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

### Other screens

- **Medications / `medications.tsx`**, **Care / `care.tsx`**, **Schedule /
  `schedule.tsx`** — Pillar entry point placeholders with a title,
  description, and Back button.
- **Profile / `profile.tsx`** — Lightweight profile view that accepts an
  optional `name` search param.
- **Explore / `explore.tsx`** — Expo starter info + collapsibles, using
  `ThemedText` / `ThemedView` and the `Collapsible` component.
- **AI / `ai.tsx`** — Auxiliary mock AI chat surface.

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
`patients`, `caregivers`, `providers`, `medications`,
`patient_conditions`, `care_plans`, `care_plan_goals`, `health_samples`,
`thresholds`, `alerts`, `caregiver_actions`, `rag_citations`,
`slm_turns`, `slm_citations`, `trigger_events`, `graph_edges`,
`audit_log`, and `consent_tokens`. Repositories in
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
bus, runs the CEP engine, calls four agents through an in-process
MCP-style tool contract (`caregiver`, `patient-state`, `coordinator`,
`safety-reviewer`), and invokes the SLM only after caregiver ground
truth or on an explicit "Explain" tap. It builds a transparency trace
and surfaces citations from the fused retriever. `OrchestratorProvider`
instantiates one orchestrator at app start and seeds the SQLite
profile; `useOrchestrator()` is how UI screens access it.

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

---

## 5. Platform-Specific Notes (iOS / Android)

### iOS

- **Status bar / Dynamic Island** — Every screen that has a sticky top
  card is wrapped in `SafeAreaView` with at least `edges={['top']}`; the
  ones with sticky bottom inputs also include `'bottom'` so the iOS
  home bar never overlaps content.
- A separate `app-tabs.tsx` component uses `expo-router/unstable-native-tabs`
  but is **not wired into the root layout**.
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
