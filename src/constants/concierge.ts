/**
 * Generation defaults for the on-device Concierge (SLM).
 *
 * Dual-mode: FAST and DEEP (restored in planning/37).
 *
 * FAST — simple chat turns (greetings, schedule, small talk).
 * - Small answer budget for concise caregiver replies.
 * - reasoningFormat 'none' (do not invite think channel).
 * - maxReasoningTokens acts as SAFETY HEADROOM: Gemma 4 E2B may emit
 *   <think> anyway; the provider adds this to n_predict so the answer
 *   channel is never starved. See `effectiveNPredict()` in
 *   src/inference/n-predict.ts.
 *
 * DEEP — clinical / complex turns (knowledge QA, med checks, explain).
 * - maxTokens=-1 — unlimited; model generates until EOS or context window
 *   full.
 * - maxReasoningTokens=0 — no separate reservation needed when unlimited.
 * - reasoning_format='auto' — model uses the <|think|> channel, then
 *   answers.
 * - temperature=0.6 / topP=0.9 — nuanced, slightly wider sampling.
 *
 * Token budgeting: llama.rn's `n_predict` is a SINGLE combined cap over
 * the reasoning (`<think>`) channel AND the answer channel. With
 * maxTokens=-1 the model runs until EOS, so thinking is free.
 */

import type { GenerateOptions } from '@/inference/inference-provider';

export type ReasoningMode = 'none' | 'auto';

export const CONCIERGE_GENERATION_FAST: Required<GenerateOptions> = {
  maxTokens: 256,
  maxReasoningTokens: 192,
  temperature: 0.4,
  topP: 0.8,
  reasoningFormat: 'none',
};

export const CONCIERGE_GENERATION_DEEP: Required<GenerateOptions> = {
  maxTokens: -1,
  maxReasoningTokens: 0,
  temperature: 0.6,
  topP: 0.9,
  reasoningFormat: 'auto',
};

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
