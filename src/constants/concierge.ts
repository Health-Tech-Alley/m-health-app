/**
 * Generation defaults for the on-device Concierge (SLM).
 *
 * Dual-mode: FAST and DEEP (restored in planning/37).
 *
 * FAST — simple chat turns (greetings, schedule, small talk).
 * - Small answer budget for concise caregiver replies.
 * - reasoningFormat 'none' + enable_thinking false.
 *
 * DEEP — clinical / complex turns (knowledge QA, med checks, explain).
 * - maxTokens=-1 — unlimited until EOS or context full.
 * - reasoning_format='auto' + <|think|> system prefix (Gemma 4).
 * - Google/Unsloth sampling: temperature=1.0, top_p=0.95, top_k=64.
 *
 * Token budgeting: llama.rn's `n_predict` is a SINGLE combined cap over
 * the reasoning channel AND the answer channel. With maxTokens=-1 the
 * model runs until EOS, so thinking is free.
 */

import type { GenerateOptions } from '@/inference/inference-provider';

export type ReasoningMode = 'none' | 'auto';

export const CONCIERGE_GENERATION_FAST: Required<GenerateOptions> = {
  maxTokens: 256,
  maxReasoningTokens: 64,
  temperature: 1.0,
  topP: 0.95,
  topK: 64,
  reasoningFormat: 'none',
};

export const CONCIERGE_GENERATION_DEEP: Required<GenerateOptions> = {
  maxTokens: -1,
  maxReasoningTokens: 0,
  temperature: 1.0,
  topP: 0.95,
  topK: 64,
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
