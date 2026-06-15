# `src/inference/` — L4 On-Device SLM

> **Status:** `InferenceProvider` interface + `LlamaRnProvider` (Track B) implemented.

**What lives here:** the `InferenceProvider` interface, the **llama.rn / llama.cpp** adapter (`llama-rn-provider.ts`), the **GGUF model loader** (~8B Q4_K_M), the model catalog, and the cold-start benchmark hooks (notebook 01).

**Two-track providers (provider-swap rule):**
- **`MockInferenceProvider`** — Track A (Expo Go). Returns canned/templated responses so the full UI + flow
  is demoable with no native module.
- **`LlamaRnProvider`** — Track B (dev build). Wraps the real `llama.rn` native module. Requires an
  `expo-dev-client` build (EAS), not Expo Go.

App start selects the implementation from a single flag (`USE_NATIVE_PROVIDERS`); UI/orchestration depend only
on the interface.

**Model weights are never committed** — `*.gguf` is git-ignored and downloaded/verified at runtime.

**Primary owner:** Ethan.
