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
import { DEFAULT_SLM_MODEL_ID, getModelEntry } from '@/inference/model-catalog';

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

/**
 * Model-aware generation profile.
 *
 * Keeps the FAST/DEEP semantics (answer budget + reasoning channel on/off)
 * and varies sampling per catalog model family. When the model is the
 * default Gemma (or unknown) the shared constants are returned unchanged so
 * identity comparisons against CONCIERGE_GENERATION_FAST/DEEP keep working.
 */
export function getConciergeGeneration(
  modelId: string | null | undefined,
  mode: 'fast' | 'deep' = 'deep',
): Required<GenerateOptions> {
  const entry = modelId ? getModelEntry(modelId) : undefined;

  // Qwen3-family models (Bonsai) always think: their GGUF chat template
  // injects <think> on EVERY generation prompt, so FAST has no meaning there.
  // Force DEEP thinking mode with the model's sampling so answers are never
  // starved by a shared FAST budget.
  if (entry?.family === 'qwen3') {
    return {
      maxTokens: CONCIERGE_GENERATION_DEEP.maxTokens,
      maxReasoningTokens: CONCIERGE_GENERATION_DEEP.maxReasoningTokens,
      temperature: entry.sampling.temperature,
      topP: entry.sampling.topP,
      topK: entry.sampling.topK,
      reasoningFormat: 'auto',
    };
  }

  if (mode === 'fast') {
    if (!modelId || modelId === DEFAULT_SLM_MODEL_ID) return CONCIERGE_GENERATION_FAST;
    return {
      maxTokens: CONCIERGE_GENERATION_FAST.maxTokens,
      maxReasoningTokens: CONCIERGE_GENERATION_FAST.maxReasoningTokens,
      temperature: entry?.sampling.temperature ?? CONCIERGE_GENERATION_FAST.temperature,
      topP: entry?.sampling.topP ?? CONCIERGE_GENERATION_FAST.topP,
      topK: entry?.sampling.topK ?? CONCIERGE_GENERATION_FAST.topK,
      reasoningFormat: 'none',
    };
  }
  if (!modelId || modelId === DEFAULT_SLM_MODEL_ID) return CONCIERGE_GENERATION_DEEP;
  return {
    maxTokens: CONCIERGE_GENERATION_DEEP.maxTokens,
    maxReasoningTokens: CONCIERGE_GENERATION_DEEP.maxReasoningTokens,
    temperature: entry?.sampling.temperature ?? CONCIERGE_GENERATION_DEEP.temperature,
    topP: entry?.sampling.topP ?? CONCIERGE_GENERATION_DEEP.topP,
    topK: entry?.sampling.topK ?? CONCIERGE_GENERATION_DEEP.topK,
    reasoningFormat: 'auto',
  };
}
