# Markdown Usage Guide

How Markdown is rendered in the app, how to use the renderer, and how it relates
to SLM output.

---

## 1. The `MarkdownRenderer` component

Location: `src/components/markdown-renderer.tsx`. It wraps
[`@believer/react-native-markdown-display`](https://www.npmjs.com/package/@believer/react-native-markdown-display)
(a maintained fork of `react-native-markdown-display`) and applies theme-aware
styles via `useTheme()`.

### Usage

```tsx
import { MarkdownRenderer } from '@/components/markdown-renderer';

// Normal body text (default 16px)
<MarkdownRenderer>{markdownString}</MarkdownRenderer>

// Prominent final answer (larger 18px body, scaled headings)
<MarkdownRenderer size="large">{markdownString}</MarkdownRenderer>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `string` | — | The raw Markdown to render |
| `size` | `'normal' \| 'large'` | `'normal'` | `large` bumps body to 18px and scales headings ~1.2× |

### Where it's used

- **SLM chat** (`slm.tsx`) — the SLM's final answer (`size="large"`) and any
  streaming / stopped text.
- **Care Management** (`care-management-view.tsx`) — the SLM explanation
  (`size="large"`) and the collapsed reasoning (`size="normal"`).
- **Acute Anomaly** (`acute-anomaly.tsx`) — the SLM alert explanation
  (`size="large"`).

---

## 2. Supported Markdown

The renderer supports CommonMark, including:

| Syntax | Example |
|--------|---------|
| Headings | `# H1`, `## H2`, `### H3` |
| Bold / italic | `**bold**`, `*italic*` |
| Lists | `- item`, `1. item` |
| Inline code | `` `code` `` |
| Code block | ```` ```\ncode\n``` ```` |
| Blockquote | `> quoted` |
| Links | `[text](https://…)` |

Styling for each element is defined in the `StyleSheet` inside
`MarkdownRenderer`. To change how (for example) headings look, edit the
`heading1`/`heading2`/`heading3` entries there. Colors come from the theme
(`theme.text`, `theme.backgroundElement`, etc.); links use the brand blue
`#3c87f7`.

---

## 3. Authoring Markdown in prompts

When you want the SLM to return formatted output, ask for Markdown explicitly in
the system prompt, e.g.:

```
Format your response in Markdown. Use **bold** for key terms and bullet lists for
steps.
```

The Care Management prompt (`care-management-controller.ts`) asks the model to
wrap its reasoning in `<THINKING>` and its answer in `<EXPLANATION>` so the two
can be separated and only the explanation is shown prominently. The SLM chat
screen relies on native parsing (`reasoning_format: 'auto'`) plus the
`stripControlTokens()` safety net.

---

## 4. SLM output: thinking vs. answer

Modern instruction/reasoning models emit **structured output** that must be
separated before display:

- **Harmony channel format** (Gemma 4 E2B, gpt-oss):
  `<|channel|>analysis … <|channel|>final …`
- **Thinking tags**: `<thinking> … </thinking>`

### How the app handles it

1. **Native parsing (primary).** `LlamaRnProvider.chat()` calls llama.rn with
   `jinja: true` and `reasoning_format: 'auto'`. llama.rn parses the structured
   output and returns:
   - `content` → the final answer
   - `reasoning_content` → the thinking
2. **Safety net (fallback).** `stripControlTokens()` in
   `src/utils/stripControlTokens.ts` removes any leftover control tokens
   (`<|channel|>…`, `<|message|>`, `<|end|>`, `<thinking>…`) if a model's output
   slips past native parsing, splitting `final`/`answer` channels from the rest.

### Display rules (consistent across models)

- **While streaming:** raw tokens render in lighter/grey italic text.
- **When complete:** reasoning (if any) stays in grey; the **final answer**
  renders below in larger, brighter Markdown (`size="large"`).
- This keeps behavior identical whether the model is HealthGPT (no thinking),
  Gemma (harmony channels), or Phi (plain output).

### Gotcha: raw control tokens showing up

If you ever see literal `<|channel|>` / `<|message|>` text or the whole reasoning
chain shown as the answer:

- Confirm the model was loaded on a **dev build** (Track B) — native parsing only
  runs there.
- Confirm `reasoning_format: 'auto'` and `jinja: true` are set in the completion
  call (`llama-rn-provider.ts`).
- The `stripControlTokens` fallback should still clean the answer; if a new token
  format appears, extend the regex there.
