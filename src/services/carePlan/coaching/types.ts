/**
 * Care soft-NLU + coaching types (planning/40).
 */

import type { AdcpProposalIntentId } from '@/data/adcp/types';

export type CareTextResolution =
  | { kind: 'emergency'; matchedPhrase?: string }
  | {
      kind: 'preselect';
      intent: AdcpProposalIntentId;
      args: Record<string, unknown>;
      confidence: number;
      source: 'care_head' | 'chat_map' | 'surface';
    }
  | {
      kind: 'single_chip' | 'multi_chip';
      chips: {
        chipId: string;
        label: string;
        intent: AdcpProposalIntentId;
        args: Record<string, unknown>;
      }[];
    }
  | { kind: 'concierge_handoff'; carryText: string; reason: string };

export type CareIntentLabel = AdcpProposalIntentId | 'out_of_care';

export const CARE_INTENT_LABELS: CareIntentLabel[] = [
  'explain_uc2_alert',
  'review_monitoring_contract',
  'explain_uc3_result',
  'propose_therapy_contract_patch',
  'explain_uc4_card',
  'promote_uc4_to_plan_task',
  'suggest_todays_logging',
  'weekly_care_plan_review',
  'handoff_summary',
  'out_of_care',
];

/** ≥ this → pre-select intent (caregiver still taps to run). */
export const CARE_PRESELECT_CONFIDENCE = 0.7;
/** Mid band → single confirmation chip. */
export const CARE_CHIP_CONFIDENCE = 0.55;
