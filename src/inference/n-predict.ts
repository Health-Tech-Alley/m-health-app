/**
 * Compute the effective `n_predict` value for llama.rn from a GenerateOptions
 * payload.
 *
 * When capped, ALWAYS adds `maxReasoningTokens` as headroom — even if
 * `reasoningFormat` is `'none'` — because chat templates / models may still
 * emit `<think>` markers (Gemma 4 E2B). Thinking routed to
 * `onReasoningToken` does not need a separate intentional budget, but it
 * still consumes `n_predict`.
 *
 * `maxTokens === -1` is unlimited — returns `-1`.
 */
import type { GenerateOptions } from './inference-provider';

export function effectiveNPredict(options?: GenerateOptions): number {
  const answerBudget = options?.maxTokens ?? 192;
  if (answerBudget < 0) return -1;
  const headroom = Math.max(0, options?.maxReasoningTokens ?? 0);
  return answerBudget + headroom;
}
