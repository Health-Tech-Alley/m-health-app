/**
 * Care free-text router: emergency screen → Care head → chat-map → surface chips.
 * Never auto-runs SLM; never auto-navigates. Returns a resolution for UI.
 */

import type { AdcpProposalIntentId } from '@/data/adcp/types';
import type { PatientRecordSnapshot } from '@/data/types';
import { buildPatientNluContext } from '@/nlu/patient-nlu-context';
import { DEFAULT_NLU_STAGE_TIMEOUT_MS } from '@/nlu/pre-slm-nlu';
import type { NluEmbedder, NluIntentLabel, LinkedEntity } from '@/nlu/types';
import { linkEntities } from '@/nlu/entity-linker';
import { CareIntentClassifier } from './careIntentClassifier';
import {
  caregiverLabelForIntent,
  fillArgsForCareIntent,
  mapChatLabelToCareIntent,
} from './careIntentMapper';
import { screenForEmergency } from './emergencyScreen';
import {
  CARE_CHIP_CONFIDENCE,
  CARE_PRESELECT_CONFIDENCE,
  type CareTextResolution,
} from './types';

const DEFAULT_NLU_TIMEOUT_MS = DEFAULT_NLU_STAGE_TIMEOUT_MS;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('care_nlu_timeout')), ms),
    ),
  ]);
}

function chip(
  intent: AdcpProposalIntentId,
  args: Record<string, unknown>,
  suffix = '',
) {
  return {
    chipId: `care:${intent}${suffix ? `:${suffix}` : ''}`,
    label: caregiverLabelForIntent(intent),
    intent,
    args,
  };
}

function gateMapped(
  intent: AdcpProposalIntentId,
  args: Record<string, unknown>,
  confidence: number,
  source: 'care_head' | 'chat_map' | 'surface',
): CareTextResolution {
  if (confidence >= CARE_PRESELECT_CONFIDENCE) {
    return { kind: 'preselect', intent, args, confidence, source };
  }
  if (confidence >= CARE_CHIP_CONFIDENCE) {
    return {
      kind: 'single_chip',
      chips: [chip(intent, args)],
    };
  }
  return {
    kind: 'multi_chip',
    chips: [chip(intent, args), chip('suggest_todays_logging', {}), chip('weekly_care_plan_review', { windowDays: 7 })],
  };
}

export type ResolveCareTextDeps = {
  snapshot: PatientRecordSnapshot | null;
  embedder?: NluEmbedder | null;
  /** Optional tier-2: already-run chat head primary + conf + entities. */
  chatHead?: {
    primary: NluIntentLabel;
    confidence: number;
    entities: LinkedEntity[];
  };
  timeoutMs?: number;
  /** Injected classifier (tests). */
  classifier?: CareIntentClassifier;
};

/**
 * Resolve free-text against the Care catalog.
 * Safe to call from Concierge or Care ask input.
 */
export async function resolveCareText(
  text: string,
  deps: ResolveCareTextDeps,
): Promise<CareTextResolution> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: 'concierge_handoff', carryText: text, reason: 'empty' };
  }

  const emergency = screenForEmergency(trimmed);
  if (emergency.hit) {
    return { kind: 'emergency', matchedPhrase: emergency.matchedPhrase };
  }

  const ctx = buildPatientNluContext(deps.snapshot);
  const entities = deps.chatHead?.entities ?? linkEntities(trimmed, ctx);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_NLU_TIMEOUT_MS;

  // Tier 1 — Care head
  if (deps.embedder || deps.classifier) {
    try {
      const classifier =
        deps.classifier ?? new CareIntentClassifier(deps.embedder as NluEmbedder);
      const result = await withTimeout(classifier.classify(trimmed, ctx), timeoutMs);
      if (result.label === 'out_of_care') {
        // Fall through to chat map / handoff rather than trapping
      } else {
        const intent = result.label as AdcpProposalIntentId;
        const args = fillArgsForCareIntent(intent, result.entities, deps.snapshot);
        return gateMapped(intent, args, result.confidence, 'care_head');
      }
    } catch {
      // Tier 2 / 3
    }
  }

  // Tier 2 — chat-head mapping
  if (deps.chatHead) {
    const mapped = mapChatLabelToCareIntent({
      chatLabel: deps.chatHead.primary,
      confidence: deps.chatHead.confidence,
      entities: deps.chatHead.entities,
      snapshot: deps.snapshot,
      text: trimmed,
    });
    if (mapped) {
      return gateMapped(mapped.intent, mapped.args, mapped.confidence, mapped.source);
    }
    // Chat labels that stay on Concierge
    if (
      ['knowledge_qa', 'med_check', 'vitals_what_if', 'schedule_care', 'visit_prep', 'portal_draft', 'other'].includes(
        deps.chatHead.primary,
      )
    ) {
      return {
        kind: 'concierge_handoff',
        carryText: trimmed,
        reason: `chat_first:${deps.chatHead.primary}`,
      };
    }
  }

  // Phrase-only map without chat head
  const phraseMap = mapChatLabelToCareIntent({
    chatLabel: 'caregiver_chat_general',
    confidence: 0.55,
    entities,
    snapshot: deps.snapshot,
    text: trimmed,
  });
  if (phraseMap && phraseMap.confidence >= CARE_CHIP_CONFIDENCE) {
    return gateMapped(phraseMap.intent, phraseMap.args, phraseMap.confidence, phraseMap.source);
  }

  // No strong Care match — stay on Concierge instead of inventing chips.
  return {
    kind: 'concierge_handoff',
    carryText: trimmed,
    reason: 'no_care_match',
  };
}
