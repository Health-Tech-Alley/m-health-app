# Playground Screen

> **Track B only** — requires a dev build (`expo-dev-client`). Not available in Expo Go.

This screen provides a chat interface for testing on-device LLM inference via `llama.rn`.

## Requirements

- GGUF model files must be placed at `FileSystem.documentDirectory + 'models/'` before use.
- Build with `eas build --profile development --platform <ios|android>`.
- Run with `npx expo start --dev-client`.

## Architecture

- **Controller** (`playground-controller.ts`) — pure state machine, no React/RN imports.
- **View** (`playground-view.tsx`) — all RN/UI rendering.
- **Screen** (`playground-screen.tsx`) — `useReducer` + provider glue.
- **Provider** (`src/inference/llama-rn-provider.ts`) — wraps `llama.rn` behind `InferenceProvider`.
