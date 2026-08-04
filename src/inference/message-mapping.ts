/**
 * Model-family message mapping for llama.rn chat turns.
 *
 * Pure function so the provider stays thin and the per-family rules are
 * unit-testable:
 *
 * - Gemma 4 (`gemma4-prefix` + thinking on): prefix the first system message
 *   with `<|think|>` so llama.rn routes the reasoning channel.
 * - Qwen3 family (`template-native`) + thinking OFF: the Bonsai GGUF chat
 *   template injects `<think>\n\n</think>` unconditionally on the generation
 *   prompt, so `reasoning_format: 'none'` cannot disable thinking. Nudge the
 *   model toward a direct answer so FAST turns stay fast and the answer is
 *   not starved by the combined n_predict budget.
 */

import type { ChatMessage } from './inference-provider';
import type { ModelEntry } from './model-catalog';

export function mapMessagesForModel(
  messages: ChatMessage[],
  entry: ModelEntry | undefined,
  enableThinking: boolean,
): ChatMessage[] {
  const thinkMode = entry?.think.mode ?? 'gemma4-prefix';
  const firstSystemIndex = messages.findIndex((m) => m.role === 'system');

  return messages.map((m, index) => {
    let content = m.content;
    if (index !== firstSystemIndex || !content) {
      return { role: m.role, content };
    }

    if (enableThinking && thinkMode === 'gemma4-prefix' && !content.startsWith('<|think|>')) {
      content = `<|think|>\n${content}`;
    } else if (
      !enableThinking &&
      thinkMode === 'template-native' &&
      !content.includes('Do not include a thinking block')
    ) {
      content =
        `${content}\n\n` +
        'Answer directly and briefly. Do not include a thinking block.';
    }

    return { role: m.role, content };
  });
}
