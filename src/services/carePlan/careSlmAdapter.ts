/**
 * Adapter from the SLM provider to the Care Intent Router (planning/39 §2.4).
 *
 * Care Concierge is on the same SLM as the main Concierge tab, with three
 * non-functional differences:
 *   - System prompt comes from the **context assembler** (ADCP + UC2/3/4).
 *   - The reasoning channel is on (`reasoningFormat: 'auto'`). Care is not
 *     on the fast importance-router path (L8).
 *   - Streaming is supported via onToken so the Care insight sheet can show
 *     progress (same lease/load path as SlmInsightSheet).
 */

import type { InferenceProvider, GenerateOptions } from '@/inference/inference-provider';
import { CONCIERGE_GENERATION_DEEP } from '@/constants/concierge';
import { stripControlTokens } from '@/utils/stripControlTokens';

const CARE_OPTIONS: GenerateOptions = {
  ...CONCIERGE_GENERATION_DEEP,
  reasoningFormat: 'auto',
};

export async function runSlmCompletion(params: {
  provider: InferenceProvider;
  systemContext: string;
  userPrompt: string;
  signal?: AbortSignal;
  /** Stream answer tokens to the UI (control tokens are still stripped at end). */
  onToken?: (token: string) => void;
}): Promise<string> {
  const provider = params.provider;
  if (!provider.getModelInfo()) {
    throw new Error('Care Concierge requires a loaded SLM model.');
  }

  let accumulator = '';
  const result = await provider.chat(
    [
      { role: 'system', content: params.systemContext },
      { role: 'user', content: params.userPrompt },
    ],
    (token) => {
      accumulator += token;
      params.onToken?.(token);
    },
    params.signal ?? new AbortController().signal,
    CARE_OPTIONS,
  );

  const raw = result.text || accumulator;
  return stripControlTokens(raw).answer.trim();
}
