/**
 * No-think chat template overrides for template-native model families.
 *
 * LFM2.5 and Qwen3 (Bonsai) GGUFs force a `<think>` open on EVERY generation
 * prompt and ignore llama.cpp's `enable_thinking`/`reasoning_format` knobs.
 * The only way to skip the think pass for those families is to hand llama.rn
 * a replacement `chat_template` string at completion time that renders the
 * same ChatML turns without injecting the think block.
 *
 * Both families share the ChatML special-token set (`<|im_start|>` /
 * `<|im_end|>`), so one minimal ChatML template serves both. It is
 * deliberately small: the app always sends string-content messages and
 * renders tool calls as plain text, so the full tool-macro machinery of the
 * GGUF templates is not needed here.
 */

import type { ModelFamily } from './model-catalog';

/**
 * ChatML template that never opens a think block. Roles are rendered as-is;
 * `bos_token`/`eos_token` come from the model's vocab (jinja context).
 * No `<think>` is injected after `<|im_start|>assistant`, so template-native
 * models answer directly. Stray `<think>` tokens the model emits anyway are
 * stripped downstream by LlamaRnProvider's marker splitter.
 */
export const NO_THINK_CHATML_TEMPLATE = [
  '{%- if messages[0][\'role\'] == \'system\' -%}',
  "{{- '<|im_start|>system\\n' + messages[0]['content'] + '<|im_end|>\\n' -}}",
  '{%- set messages = messages[1:] -%}',
  '{%- endif -%}',
  '{%- for message in messages -%}',
  "{{- '<|im_start|>' + message['role'] + '\\n' + message['content'] + '<|im_end|>\\n' -}}",
  '{%- endfor -%}',
  "{{- '<|im_start|>assistant\\n' -}}",
].join('\n');

/** Families that ignore enable_thinking and need the template override. */
export const NO_THINK_TEMPLATE_FAMILIES: ReadonlySet<ModelFamily> = new Set<ModelFamily>([
  'lfm2',
  'qwen3',
]);

/** Resolve the no-think chat template for a family (undefined = not needed). */
export function noThinkChatTemplateForFamily(family: ModelFamily | undefined): string | undefined {
  if (!family || !NO_THINK_TEMPLATE_FAMILIES.has(family)) return undefined;
  return NO_THINK_CHATML_TEMPLATE;
}
