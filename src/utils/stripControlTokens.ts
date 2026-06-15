/**
 * Strip structured-output control tokens that may leak into the assistant's answer.
 *
 * Handles:
 * - gpt-oss / Gemma "harmony" channel format: <|channel|>thought ... <|channel|>final ...
 * - <thinking>...</thinking> tags
 * - stray <|...|> control tokens
 *
 * Returns the cleaned answer and optional thinking/reasoning content.
 */
export function stripControlTokens(text: string): { thinking: string | null; answer: string } {
  // gpt-oss / Gemma "harmony" channel format:
  //   <|channel>thought ... <|channel>final ...
  const channelRegex = /<!\|channel\|?>(\w+)\s*([\s\S]*?)(?=<!\|channel\|?>|<!\|end\|?>|<!\|return\|?>|$)/gi;
  const matches = [...text.matchAll(channelRegex)];

  if (matches.length > 0) {
    let thinking = '';
    let answer = '';
    for (const m of matches) {
      const channel = m[1].toLowerCase();
      const body = m[2].replace(/<!\|message\|?>/gi, '').trim();
      if (channel === 'final' || channel === 'answer') {
        answer += body;
      } else {
        thinking += (thinking ? '\n\n' : '') + body;
      }
    }
    // Clean any remaining control tokens.
    answer = answer.replace(/<!\|[^>]*\|?>/g, '').trim();
    thinking = thinking.replace(/<!\|[^>]*\|?>/g, '').trim();
    if (answer) {
      return { thinking: thinking || null, answer };
    }
  }

  // <thinking>...</thinking> tag format.
  const thinkingMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  if (thinkingMatch) {
    const thinking = thinkingMatch[1].trim();
    const answer = text.replace(/<thinking>[\s\S]*?<\/thinking>/i, '').trim();
    return { thinking, answer };
  }

  // No structured markers — return text with any stray control tokens removed.
  const cleaned = text.replace(/<!\|[^>]*\|?>/g, '').trim();
  return { thinking: null, answer: cleaned };
}
