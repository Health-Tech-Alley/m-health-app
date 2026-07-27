/**
 * Tier-2 fallback: map chat NLU labels → Care catalog intents (planning/40 §6.4).
 * Also fills low-risk args from entities + snapshot (cardId, alertId, windowDays).
 */

import type { AdcpProposalIntentId } from '@/data/adcp/types';
import type { PatientRecordSnapshot } from '@/data/types';
import type { LinkedEntity, NluIntentLabel } from '@/nlu/types';
import { APP_SURFACE_LEXICON } from '@/nlu/app-surfaces';
import { INTENT_CATALOG } from '@/services/carePlan/intentCatalog';

export type MappedCareIntent = {
  intent: AdcpProposalIntentId;
  args: Record<string, unknown>;
  confidence: number;
  source: 'chat_map' | 'surface';
} | null;

function topUc4CardId(snapshot: PatientRecordSnapshot | null | undefined): string | undefined {
  const cards = snapshot?.latestUc4PriorityCards ?? [];
  const active = cards.find((c) => c.status === 'active') ?? cards[0];
  return active?.cardId;
}

function latestUc3ResultId(snapshot: PatientRecordSnapshot | null | undefined): string | undefined {
  return snapshot?.latestUc3TrajectoryResult?.resultId;
}

export function fillArgsForCareIntent(
  intent: AdcpProposalIntentId,
  entities: LinkedEntity[],
  snapshot: PatientRecordSnapshot | null | undefined,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const lowerEntities = entities.map((e) => e.label.toLowerCase()).join(' ');

  if (intent === 'explain_uc4_card' || intent === 'promote_uc4_to_plan_task') {
    const cardId = topUc4CardId(snapshot);
    if (cardId) args.cardId = cardId;
  }
  if (intent === 'explain_uc3_result') {
    const resultId = latestUc3ResultId(snapshot);
    if (resultId) args.resultId = resultId;
  }
  if (intent === 'weekly_care_plan_review' || intent === 'handoff_summary') {
    if (/\b(week|7\s*day|seven)\b/i.test(lowerEntities) || true) {
      args.windowDays = 7;
    }
  }
  return args;
}

/**
 * Map a chat-head primary label (+ entities) onto a Care catalog intent.
 * Returns null when the utterance should stay on Concierge chat.
 */
export function mapChatLabelToCareIntent(params: {
  chatLabel: NluIntentLabel;
  confidence: number;
  entities: LinkedEntity[];
  snapshot: PatientRecordSnapshot | null | undefined;
  text?: string;
}): MappedCareIntent {
  const { chatLabel, confidence, entities, snapshot, text = '' } = params;
  const lower = text.toLowerCase();

  // Surface entities can short-circuit to a Care intent when high enough conf.
  const surfaceEntity = entities.find((e) => e.type === 'app_surface');
  if (surfaceEntity) {
    const entry = APP_SURFACE_LEXICON.find(
      (s) => s.label === surfaceEntity.label || surfaceEntity.id.endsWith(s.id),
    );
    if (entry?.careIntentHint && confidence >= 0.45) {
      return {
        intent: entry.careIntentHint,
        args: fillArgsForCareIntent(entry.careIntentHint, entities, snapshot),
        confidence: Math.min(0.72, confidence + 0.1),
        source: 'surface',
      };
    }
  }

  // Explicit caregiver phrases (demo-critical)
  if (/\badd (this|that|the)?\s*(priority|focus|card)?\s*to (the |my |his |her )?(plan|care plan)\b/i.test(lower)) {
    return {
      intent: 'promote_uc4_to_plan_task',
      args: fillArgsForCareIntent('promote_uc4_to_plan_task', entities, snapshot),
      confidence: Math.max(confidence, 0.75),
      source: 'chat_map',
    };
  }
  if (/\b(what should i log|log today|logging checklist)\b/i.test(lower)) {
    return {
      intent: 'suggest_todays_logging',
      args: fillArgsForCareIntent('suggest_todays_logging', entities, snapshot),
      confidence: Math.max(confidence, 0.75),
      source: 'chat_map',
    };
  }
  if (/\b(handoff|backup caregiver|weekend (note|summary))\b/i.test(lower)) {
    return {
      intent: 'handoff_summary',
      args: fillArgsForCareIntent('handoff_summary', entities, snapshot),
      confidence: Math.max(confidence, 0.72),
      source: 'chat_map',
    };
  }
  if (
    /\b(therap(y|ies)|rehab|recovery trajectory)\b/i.test(lower) &&
    /\b(progress|going|result|trajectory|plateau|rom|walking)\b/i.test(lower)
  ) {
    return {
      intent: 'explain_uc3_result',
      args: fillArgsForCareIntent('explain_uc3_result', entities, snapshot),
      confidence: Math.max(confidence, 0.72),
      source: 'chat_map',
    };
  }
  if (/\b(priorit(y|ies)|care focus)\b/i.test(lower) && /\b(why|explain|mean)\b/i.test(lower)) {
    return {
      intent: 'explain_uc4_card',
      args: fillArgsForCareIntent('explain_uc4_card', entities, snapshot),
      confidence: Math.max(confidence, 0.72),
      source: 'chat_map',
    };
  }

  let intent: AdcpProposalIntentId | null = null;
  switch (chatLabel) {
    case 'explain_anomaly':
      intent = 'explain_uc2_alert';
      break;
    case 'detect_care_gaps':
      intent = /\bweek\b/i.test(lower) ? 'weekly_care_plan_review' : 'suggest_todays_logging';
      break;
    case 'draft_care_plan':
      intent = 'weekly_care_plan_review';
      break;
    case 'next_steps':
      intent = 'suggest_todays_logging';
      break;
    case 'clarifying_qa':
      intent = 'suggest_todays_logging';
      break;
    case 'summarize_ehr':
      if (/\b(plan|changed|priority|care)\b/i.test(lower)) {
        intent = 'weekly_care_plan_review';
      }
      break;
    default:
      intent = null;
  }

  if (!intent || !INTENT_CATALOG[intent]) return null;

  return {
    intent,
    args: fillArgsForCareIntent(intent, entities, snapshot),
    confidence,
    source: 'chat_map',
  };
}

export function caregiverLabelForIntent(intent: AdcpProposalIntentId): string {
  return INTENT_CATALOG[intent]?.caregiverLabel ?? intent;
}
