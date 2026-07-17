/**
 * Budget assembler — constrains tools/chunks to per-intent budgets.
 *
 * planning/35 §7.4 / §3.2.
 */

import type { McpToolSummary, RetrievedChunk } from '@/knowledge/types';
import type { PreSlmPacket, NluIntent, LinkedEntity } from './types';
import type { HypotheticalVitalsArgs } from '@/services/slm/vitals-tool-nlp';

export type BudgetConstraints = {
  maxTools: number;
  maxChunks: number;
  maxChunkChars: number;
  maxToolChars: number;
};

/**
 * Truncate a string to maxChars, word-aligned.
 */
function truncateToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxChars * 0.8 ? truncated.slice(0, lastSpace) + '...' : truncated + '...';
}

/**
 * Assemble a PreSlmPacket with budget enforcement.
 */
export function assembleBudgetedPacket(params: {
  prompt: string;
  entities: LinkedEntity[];
  intent: NluIntent;
  tools: McpToolSummary[];
  chunks: RetrievedChunk[];
  slots?: HypotheticalVitalsArgs;
  budget: BudgetConstraints;
  trace: PreSlmPacket['trace'];
}): PreSlmPacket {
  const { prompt, entities, intent, budget, slots, trace } = params;

  // Enforce tool budget
  const tools = params.tools.slice(0, budget.maxTools);

  // Enforce chunk budget (count + total chars)
  const chunks: RetrievedChunk[] = [];
  let totalChunkChars = 0;
  for (const chunk of params.chunks) {
    if (chunks.length >= budget.maxChunks) break;
    const remaining = budget.maxChunkChars - totalChunkChars;
    if (remaining <= 0) break;
    const text = truncateToChars(chunk.text, remaining);
    chunks.push({ ...chunk, text });
    totalChunkChars += text.length;
  }

  // Enforce tool description char budget
  let totalToolChars = 0;
  const budgetedTools: McpToolSummary[] = [];
  for (const tool of tools) {
    const desc = truncateToChars(tool.description, budget.maxToolChars - totalToolChars);
    budgetedTools.push({ ...tool, description: desc });
    totalToolChars += desc.length;
    if (totalToolChars >= budget.maxToolChars) break;
  }

  return {
    prompt,
    entities,
    intent,
    tools: budgetedTools,
    chunks,
    slots,
    budget,
    trace,
  };
}
