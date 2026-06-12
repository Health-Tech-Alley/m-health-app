# Caregiver Concierge — App Guide

This document describes the current state of the mobile app: how it is built, how
each screen works, and the platform-specific (iOS/Android) considerations. It is a
living document — update it as the UI evolves.

> For the project mission, architecture (L1–L7), and steel-thread methodology, see
> the root [`AGENTS.md`](../AGENTS.md) and the [`planning/`](../planning) package.
> This guide focuses on **what currently exists in the running app**.

---

## 1. Build & Runtime Setup (Expo)

The app is an **Expo (managed) project, SDK 56** using **expo-router** for
file-based routing. Source lives under `src/`.

### Two-track development

| Track | How to run | What works |
|-------|-----------|------------|
| **Track A — Expo Go** | `npx expo start`, scan QR with Expo Go | UI, navigation, deterministic logic. **No** SLM or ML (native modules absent). |
| **Track B — Dev build** | `npx expo run:ios` / `run:android`, or EAS build, then `npx expo start --dev-client` | Everything, incl. `llama.rn` (SLM) and `react-native-fast-tflite` (Alert ML). |

**Rule of thumb:** anything that imports a native module (`llama.rn`,
`react-native-fast-tflite`) only runs on Track B. The app degrades gracefully on
Track A.

### When do I need to rebuild natively?

| Change type | Rebuild needed? |
|-------------|-----------------|
| TS/TSX, React components, styles, logic | ❌ No — Metro hot-reloads (`r` to reload) |
| New native dependency in `package.json` | ✅ Yes — `npx expo prebuild --clean` + Xcode/Studio build |
| Native config (`app.json` plugins, `Info.plist`) | ✅ Yes |
| New asset extension in `metro.config.js` (e.g. `.tflite`) | ✅ Yes |
| Swift/Kotlin module code | ✅ Yes |

### Key config files

- `app.json` — Expo config. Plugins include `expo-router`, `expo-secure-store`,
  and `react-native-fast-tflite` (with `enableCoreMLDelegate: true` for iOS GPU).
- `metro.config.js` — registers `tflite` as a bundleable asset extension.
- `tsconfig.json` — path alias `@/*` → `src/*`; includes `modules/**/*.ts`.

---

## 2. Navigation & Screens

Routing is file-based under `src/app/`. The tab bar is defined in
`src/components/app-tabs.tsx` using `expo-router/unstable-native-tabs`
(`NativeTabs`), which renders a **platform-native** tab bar (UIKit tab bar on iOS,
Material bottom navigation on Android).

| Tab (route file) | Implementation | Purpose |
|------------------|----------------|---------|
| **Home** (`index.tsx`) | Inline component | Welcome / get-started screen |
| **Explore** (`explore.tsx`) | Inline component | Expo starter info + collapsibles |
| **Models** (`models.tsx`) | `src/ui/models/` (MVC) | Download / delete on-device models |
| **Playground** (`playground.tsx`) | `src/ui/playground/` (MVC) | Chat with the SLM |
| **Care** (`care-management.tsx`) | `src/ui/care-management/` (MVC) | Vitals → Alert ML → SLM explanation |

The root layout `src/app/_layout.tsx` wraps everything in the theme provider, the
splash overlay, and the **global SLM provider** (`SLMProvider`).

### MVC pattern

Feature screens follow a consistent split:

- `types.ts` — `State` + `Action` discriminated union
- `*-controller.ts` — pure logic (no React); returns action objects
- `*-screen.tsx` — `useReducer` + provider wiring; bridges async side-effects
- `*-view.tsx` — pure presentation (props in, callbacks out)

---

## 3. Screen-by-Screen

### Home (`index.tsx`)
Static welcome screen with the animated logo, "get started" hints, and a
platform-aware dev-menu hint (shake device on a real phone, `cmd+d`/`cmd+m` on
simulators). Web shows an Expo version badge.

### Models (`src/ui/models/`)
- Lists the model catalog (`src/inference/model-catalog.ts`): HealthGPT Pro 4B,
  Phi-4 Mini, Gemma 4 E2B — all GGUF Q4_K_M.
- Download from Hugging Face with live progress, cancel, delete.
- Optional Hugging Face token (stored via `expo-secure-store`) for gated repos.
- "Clear All Models" wipes the on-device `models/` directory (incl. partial
  downloads).
- Models are stored in the app's document directory and are **git-ignored**.

### Playground (`src/ui/playground/`)
- Chat UI for the SLM. Select an installed model to **load** it; **Unload**
  frees device RAM.
- Streaming token output. **Thinking vs. answer separation**: while generating,
  raw output streams in lighter/grey italic text; once complete, the model's
  reasoning (if any) stays in grey and the **final answer** is shown below in
  larger, brighter text with full **Markdown rendering**.
- Live **device RAM monitor** while a model is loaded (Track B / native only).
- Uses the global SLM provider, so a model loaded here stays loaded when you
  switch to the Care tab.

### Care (`src/ui/care-management/`)
Implements the canonical ST-01-style flow:
1. **Pick a scenario** (mock wearable data) or start from one and edit values.
2. **Vitals input** — the 6 core vitals are editable with range validation;
   derived features (pulse pressure, MAP, time-of-day, sleep window) are computed
   automatically.
3. **Run ML inference** — the on-device autoencoder
   (`src/ml-models/alert-autoencoder`) produces an anomaly score vs. its trained
   threshold and an ANOMALOUS/NORMAL badge.
4. **Ask SLM to Explain** — only offered when anomalous; the SLM produces a
   caregiver-facing explanation. Reasoning is collapsed under "Show reasoning
   process"; the final explanation is shown prominently in Markdown.
- SLM load/unload controls and the RAM monitor are mirrored here.

---

## 4. On-Device AI

### SLM (`llama.rn`)
- Wrapped behind `InferenceProvider` (`src/inference/inference-provider.ts`); the
  real impl is `LlamaRnProvider`.
- A single instance is shared app-wide via `SLMProvider`
  (`src/contexts/slm-context.tsx`) and consumed with the `useSLM()` hook.
- **Metal GPU acceleration** is enabled (`n_gpu_layers: -1`).
- Structured-output models (Gemma/gpt-oss "harmony" channels, `<thinking>` tags)
  are parsed by llama.rn into `content` (answer) + `reasoning_content` (thinking).
  A `stripControlTokens` safety net in the playground reducer removes any leftover
  control tokens.

### Alert ML (`react-native-fast-tflite`)
- Dense autoencoder (`tiny_uc2_autoencoder.tflite`) for vitals anomaly detection.
- 18 input features, `StandardScaler` normalization (mean/scale from
  `tiny_uc2_scaler.json`), threshold from `tiny_uc2_metadata.json`.
- Loaded with the **CoreML delegate** on iOS for GPU acceleration.
- Auto-loads when the Care screen mounts.

---

## 5. Platform-Specific Notes (iOS / Android)

### iOS
- Native tab bar via UIKit.
- SLM uses **Metal**; Alert ML uses the **CoreML delegate** (enabled through the
  `react-native-fast-tflite` config plugin in `app.json`). The CoreML framework is
  added during prebuild.
- Local dev build requires macOS + Xcode (`npx expo run:ios`). A physical device
  gives realistic SLM/ML performance; the simulator works for UI but not for
  representative inference speed/memory.
- Device RAM monitor reads physical memory via the native bridge.

### Android
- Native bottom navigation via Material.
- TFLite GPU acceleration would use the NNAPI/android-gpu delegates (CoreML is
  iOS-only); the model currently requests `core-ml` — revisit delegate selection
  per platform before shipping Android.
- Local dev build requires the Android SDK (`npx expo run:android`).
- `predictiveBackGestureEnabled` is disabled in `app.json`.

### Cross-platform
- Every native capability has a graceful fallback so Track A (Expo Go) doesn't
  crash — missing native modules surface a message instead of throwing at startup.
- Secrets (HF token) use `expo-secure-store` → iOS Keychain / Android Keystore.

---

## 6. Theming & UI System

- `ThemedText` (typed text variants: `title`, `subtitle`, `default`, `small`,
  `smallBold`, `link`, `code`) and `ThemedView` (background variants) drive all
  styling. Never hardcode colors — use `useTheme()`.
- Spacing uses the `Spacing.*` scale from `src/constants/theme.ts`.
- Markdown output is rendered by `src/components/markdown-renderer.tsx`
  (`@believer/react-native-markdown-display`), with a `size` prop (`normal` /
  `large`) so final answers render larger than inline text.

See [`MARKDOWN_GUIDE.md`](./MARKDOWN_GUIDE.md) for how to author and render
Markdown in the app.
