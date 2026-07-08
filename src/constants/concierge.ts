/**
 * Generation defaults for the on-device Concierge (SLM).
 *
 * SINGLE MODE (deep) — the fast path was removed. Every SLM surface across the
 * app (chat, "tell me more", insight sheet, orchestrator explain, service
 * fallback) now uses one deep generation profile. The old fast profile
 * (maxTokens=192) reliably got cut off mid-thought on Gemma 4 E2B, so we no
 * longer branch on query complexity — the model always thinks fully, then
 * emits the complete answer.
 *
 * Token budgeting: llama.rn's `n_predict` is a SINGLE combined cap over the
 * reasoning (`<think>`) channel AND the answer channel. With maxTokens=-1
 * (unlimited) the model runs until EOS or the context window fills, so both
 * thinking and the answer complete. maxReasoningTokens is therefore irrelevant
 * here (0) — it only mattered for the removed capped fast path.
 *
 * Deep profile (CONCIERGE_GENERATION_DEEP — the only profile):
 * - maxTokens=-1 — unlimited; model generates until EOS or context window full
 * - maxReasoningTokens=0 — no separate reservation needed when unlimited
 * - reasoning_format='auto' — model uses the <|think|> channel, then answers
 * - temperature=0.6 / topP=0.9 — nuanced, slightly wider sampling
 */

import type { GenerateOptions } from '@/inference/inference-provider';

export type ReasoningMode = 'none' | 'auto';

export const CONCIERGE_GENERATION_DEEP: Required<GenerateOptions> = {
  maxTokens: -1,
  maxReasoningTokens: 0,
  temperature: 0.6,
  topP: 0.9,
  reasoningFormat: 'auto',
};

// Single mode: every legacy profile name now points at the one deep profile so
// existing call sites keep working without a fast/deep branch. Fast is gone.
export const CONCIERGE_GENERATION_FAST = CONCIERGE_GENERATION_DEEP;
export const CONCIERGE_GENERATION_DEFAULTS = CONCIERGE_GENERATION_DEEP;
export const CONCIERGE_GENERATION_EXPLAIN = CONCIERGE_GENERATION_DEEP;
export const CONCIERGE_GENERATION_LONG = CONCIERGE_GENERATION_DEEP;

/**
 * Reasoning format control. Both constants are 'auto' now — the app always
 * lets the model use its reasoning channel. Kept as named exports for the
 * call sites that still reference them.
 */
export const REASONING_FORMAT_CHAT: ReasoningMode = 'auto';
export const REASONING_FORMAT_EXPLAIN: ReasoningMode = 'auto';
