/**
 * Reasoning router — the "prompt interface" decision layer.
 *
 * Decides whether a given SLM invocation should run with reasoning ON (deep)
 * or OFF (fast). The decision is made from deterministic signals on the
 * prompt + context, not vibes.
 *
 * Used by every SLM surface that takes a free-form user message + a clinical
 * context:
 *   - Chat tab         — fast by default; deep when messageHasClinicalKeywords
 *                        + (complex-question proxy OR ≥2 cited chunks)
 *   - Explain          — always deep
 *   - SlmInsightSheet  — fast by default; deep when interactions cited
 *   - Tell-me-more     — deep (explicit deep follow-up)
 *
 * See planning/32 §6.
 */

import type { ReasoningMode } from '@/constants/concierge';
import { messageHasClinicalKeywords } from './retrieval-helper';

const COMPLEX_QUESTION_PATTERN = /why|how|should|when to|risk|interact|side effect|explain|tell me more/i;
const COMPLEX_QUESTION_MIN_CHARS = 120;

/**
 * Pick the reasoning mode for a single SLM call.
 *
 * @param args.message        The user's free-form message (after any prepending
 *                            retrieval context or instruction).
 * @param args.conditions     Patient's confirmed conditions.
 * @param args.meds           Patient's active medications.
 * @param args.citedChunkCount Number of clinical chunks the prompt actually
 *                            cites (e.g. PubMed/MedlinePlus hits surfaced
 *                            in the prompt).
 * @param args.forceDeep      When true, always returns 'auto' (used by
 *                            explain + clarifying + tell-me-more paths).
 */
export function decideReasoningMode(args: {
  message: string;
  conditions?: string[];
  meds?: string[];
  citedChunkCount?: number;
  forceDeep?: boolean;
}): ReasoningMode {
  if (args.forceDeep) return 'auto';

  if (args.citedChunkCount !== undefined && args.citedChunkCount >= 2) {
    return 'auto';
  }

  if (
    messageHasClinicalKeywords(
      args.message,
      args.conditions ?? [],
      args.meds ?? [],
    )
  ) {
    const isComplex =
      COMPLEX_QUESTION_PATTERN.test(args.message) ||
      args.message.length > COMPLEX_QUESTION_MIN_CHARS;
    if (isComplex) return 'auto';
  }

  return 'none';
}
