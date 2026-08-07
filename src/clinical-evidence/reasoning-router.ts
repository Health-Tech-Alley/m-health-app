/**
 * Reasoning router — the "prompt interface" decision layer.
 *
 * Decides whether a given SLM invocation should run with reasoning ON (deep)
 * or OFF (fast). The decision is made from deterministic signals on the
 * prompt + context, not vibes.
 *
 * Two selectors:
 *   - `selectChatGeneration` — intent-first (NLU-driven); used by chat tab.
 *     FAST for simple intents (caregiver_chat_general, schedule_care, other)
 *     when confidence is high; DEEP for clinical intents, low confidence,
 *     or NLU failures (fail-closed to DEEP). See planning/37 §6.3.
 *   - `decideReasoningMode` — keyword/chunk-first; legacy for surfaces that
 *     do not have an NLU packet yet.
 *
 * See planning/32 §6 and planning/37 §6.3.
 */

import type { GenerateOptions } from '@/inference/inference-provider';
import type { ReasoningMode } from '@/constants/concierge';
import {
  CONCIERGE_GENERATION_DEEP,
  CONCIERGE_GENERATION_FAST,
  getConciergeGeneration,
} from '@/constants/concierge';
import { CONFIDENCE_THRESHOLD } from '@/nlu/intent-labels';
import type { NluIntent, NluIntentLabel } from '@/nlu/types';
import { messageHasClinicalKeywords } from './retrieval-helper';

const COMPLEX_QUESTION_PATTERN = /why|how|should|when to|risk|interact|side effect|explain|tell me more/i;
const COMPLEX_QUESTION_MIN_CHARS = 120;

/** Intents that may use FAST when confidence is high enough. */
export const FAST_ELIGIBLE_INTENTS: ReadonlySet<NluIntentLabel> = new Set([
  'caregiver_chat_general',
  'schedule_care',
  'other',
]);

/**
 * Intents that always use DEEP (clinical / multi-step / structured).
 * knowledge_qa is DEEP in v1 (D6) even when high confidence.
 */
export const ALWAYS_DEEP_INTENTS: ReadonlySet<NluIntentLabel> = new Set([
  'knowledge_qa',
  'med_check',
  'vitals_what_if',
  'explain_anomaly',
  'clarifying_qa',
  'next_steps',
  'visit_prep',
  'portal_draft',
  'summarize_ehr',
  'detect_care_gaps',
  'draft_care_plan',
]);

export type ChatGenerationDecision = {
  profile: Required<GenerateOptions>;
  mode: ReasoningMode;
  reason: string;
};

/**
 * Select a generation profile for a chat turn using NLU intent + confidence.
 * Fail-closed: missing NLU, low confidence, or clinical intents → DEEP.
 * FAST_ELIGIBLE intents with high confidence → FAST.
 * Optional safety: clinical-chunk override for misclassified turns.
 *
 * When `modelId` is provided, sampling follows that catalog model's profile
 * (e.g. Bonsai 8B); when omitted, the shared Gemma defaults apply.
 */
export function selectChatGeneration(args: {
  intent?: NluIntent | null;
  message?: string;
  conditions?: string[];
  meds?: string[];
  citedChunkCount?: number;
  forceDeep?: boolean;
  modelId?: string | null;
}): ChatGenerationDecision {
  const deepProfile = args.modelId
    ? getConciergeGeneration(args.modelId, 'deep')
    : CONCIERGE_GENERATION_DEEP;
  const fastProfile = args.modelId
    ? getConciergeGeneration(args.modelId, 'fast')
    : CONCIERGE_GENERATION_FAST;
  const deep = (reason: string): ChatGenerationDecision => ({
    profile: deepProfile,
    mode: 'auto',
    reason,
  });
  const fast = (reason: string): ChatGenerationDecision => ({
    profile: fastProfile,
    mode: 'none',
    reason,
  });

  // Template-native families (LFM2.5 / Bonsai) flow through the same NLU
  // intent/confidence/chunk logic as Gemma. The family-aware profiles in
  // getConciergeGeneration carry the difference: FAST for these families
  // means reasoningFormat 'none' with an UNLIMITED answer budget, and the
  // provider swaps in a no-think chat template — so skipping the think pass
  // is the only 'fast' lever and answers are never starved.
  if (args.forceDeep) {
    return deep('forceDeep');
  }

  if (!args.intent) {
    return deep('no_nlu_packet');
  }

  if (args.intent.confidence < CONFIDENCE_THRESHOLD) {
    return deep(`low_confidence:${args.intent.confidence.toFixed(2)}`);
  }

  if (ALWAYS_DEEP_INTENTS.has(args.intent.primary)) {
    return deep(`always_deep_intent:${args.intent.primary}`);
  }

  if (FAST_ELIGIBLE_INTENTS.has(args.intent.primary)) {
    const chunks = args.citedChunkCount ?? 0;
    if (
      chunks >= 2 &&
      messageHasClinicalKeywords(
        args.message ?? '',
        args.conditions ?? [],
        args.meds ?? [],
      )
    ) {
      return deep('fast_intent_overridden_by_clinical_chunks');
    }

    return fast(`fast_intent:${args.intent.primary}`);
  }

  return deep(`default_deep:${args.intent.primary}`);
}

/**
 * Pick the reasoning mode for a single SLM call.
 *
 * Keyword/chunk-first legacy selector for surfaces that do not have an
 * NLU packet yet (rare service fallback; sheets use prepareSlmTurn).
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
