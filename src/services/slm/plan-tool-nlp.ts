/**
 * propose_care_plan_update tool-call parsing (Concierge chat).
 *
 * The chat SLM proposes plan updates by emitting exactly one ACTION line;
 * the chat executor validates it and routes it to the canonical intent draft
 * pass (runIntent → enqueue → awaiting_hitl). The conversation SLM never
 * supplies payload JSON itself — intent + minimal args only — so payloads
 * stay schema-validated and HITL-gated.
 *
 * Only plan-WRITE intents are draftable via this tool. Narrative intents
 * (weekly review, explains, logging, handoff) are answered inline by the
 * chat turn itself — routing them to a second intent generation would add
 * latency and duplicate proposals the caregiver did not ask for.
 */

import type { AdcpProposalIntentId } from '@/data/adcp/types';

export interface ProposePlanUpdateCall {
  intent: AdcpProposalIntentId;
  args: Record<string, unknown>;
}

/** Plan-write intents the chat SLM may route to the intent draft pass. */
const CHAT_PLAN_TOOL_INTENTS: ReadonlySet<AdcpProposalIntentId> = new Set([
  'review_monitoring_contract',
  'propose_therapy_contract_patch',
  'promote_uc4_to_plan_task',
]);

const ACTION_LINE_RE =
  /^\s*ACTION:\s*propose_care_plan_update\s*\(\s*(\{[\s\S]*?\})\s*\)\s*$/i;

/** Sanitized arg keys the conversation SLM may supply. */
const ALLOWED_ARGS = new Set(['cardId', 'resultId']);

/**
 * Parse + validate an emitted propose_care_plan_update line. Returns null for
 * malformed JSON, narrative intents, or non-whitelisted args — callers strip
 * the line from the displayed answer regardless and treat it as prose.
 */
export function parseProposeCarePlanUpdate(
  modelText: string,
): ProposePlanUpdateCall | null {
  if (!modelText) return null;
  for (const line of modelText.split('\n')) {
    const match = ACTION_LINE_RE.exec(line);
    if (!match) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const intent = obj.intent;
    if (
      typeof intent !== 'string' ||
      !CHAT_PLAN_TOOL_INTENTS.has(intent as AdcpProposalIntentId)
    ) {
      return null;
    }
    const args: Record<string, unknown> = {};
    for (const key of ALLOWED_ARGS) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) {
        args[key] = value.trim();
      }
    }
    return { intent: intent as AdcpProposalIntentId, args };
  }
  return null;
}

/** Remove a valid ACTION line from the displayed answer text. */
export function stripProposeCarePlanUpdateAction(text: string): string {
  if (!text) return text;
  const kept = text
    .split('\n')
    .filter((line) => !ACTION_LINE_RE.test(line.trim()));
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
