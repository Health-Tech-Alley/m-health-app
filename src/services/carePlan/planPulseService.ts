/**
 * Plan Pulse service (Care tab hero rework).
 *
 * A deterministic, read-only derivation over the existing patient snapshot +
 * active ADCP revision that answers two questions for the hero card:
 *   - "How complete is this plan right now?" → score (0–100)
 *   - "Does anything need the caregiver?"    → attention state
 *
 * State-management compliance: pure functions, no snapshot/provider/Redux
 * changes, no writes. Same approved derivation pattern as carePlanViewModel.
 */

import type { AdcpPlanDocument } from '@/data/adcp/types';
import { planHasTherapyContract } from '@/data/repositories/adcpRepository';
import type { PatientRecordSnapshot } from '@/data/types';
import type { CarePlanMode } from './carePlanMode';

export type PlanPulseAttention = 'calm' | 'review' | 'urgent';
export type PlanPulseStatusWord = 'activated' | 'needs_review' | 'view_only';

export interface PlanPulse {
  /** 0–100 completeness of the live care plan. */
  score: number;
  attention: PlanPulseAttention;
  statusWord: PlanPulseStatusWord;
  /** Per-signal breakdown, useful for tests and future tooltips. */
  signals: PlanPulseSignal[];
}

export interface PlanPulseSignal {
  key: string;
  /** Points earned out of `max`. */
  earned: number;
  max: number;
  /** True when this signal is active (drives earned > 0). */
  active: boolean;
}

/** Full credit when the latest UC4 run is this recent; half credit within the stale window. */
export const UC4_FRESH_MS = 24 * 60 * 60 * 1000;
export const UC4_STALE_MS = 72 * 60 * 60 * 1000;

const WEIGHTS = {
  publishedPlan: 20,
  goals: 15,
  monitoring: 15,
  uc4Freshness: 15,
  engagement: 15,
  priorities: 10,
  caregiverResponses: 10,
} as const;

function msSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return nowMs - ms;
}

export function computePlanPulse(
  snapshot: PatientRecordSnapshot | null,
  plan: AdcpPlanDocument | null,
  mode: CarePlanMode,
  nowMs: number = Date.now(),
): PlanPulse {
  const hasPlan = Boolean(plan);
  const goals = snapshot?.carePlanGoals ?? [];
  const thresholds = snapshot?.thresholds ?? [];
  const latestRun = snapshot?.latestUc4Run ?? null;
  const liveCards = snapshot?.latestUc4PriorityCards ?? [];
  const therapy = Boolean(snapshot?.therapyContractPresent) || planHasTherapyContract(plan);
  const todayEntry = snapshot?.todayDailyCareEntry ?? null;
  const planPriorities = (plan?.carePriorities.priorities ?? []).filter(
    (priority) => priority.status === 'active',
  );
  const responses = snapshot?.recentUc4CaregiverResponses ?? [];
  const pendingProposals = (snapshot?.pendingPlanProposals ?? []).filter((proposal) =>
    ['draft', 'awaiting_hitl', 'awaiting_ml_vet'].includes(proposal.status),
  );

  const runAge = msSince(latestRun?.generatedAt, nowMs);
  const uc4Fresh = runAge != null && runAge <= UC4_FRESH_MS;
  const uc4Stale = !uc4Fresh && runAge != null && runAge <= UC4_STALE_MS;

  const signals: PlanPulseSignal[] = [
    { key: 'published_plan', max: WEIGHTS.publishedPlan, active: hasPlan, earned: 0 },
    { key: 'goals', max: WEIGHTS.goals, active: goals.length > 0, earned: 0 },
    { key: 'monitoring', max: WEIGHTS.monitoring, active: thresholds.length > 0, earned: 0 },
    {
      key: 'uc4_freshness',
      max: WEIGHTS.uc4Freshness,
      active: uc4Fresh || uc4Stale,
      earned: uc4Fresh ? WEIGHTS.uc4Freshness : uc4Stale ? Math.round(WEIGHTS.uc4Freshness / 2) : 0,
    },
    // Engagement only counts when a therapy contract exists; without one the
    // weight is redistributed to the plan-structure signals above.
    {
      key: 'engagement',
      max: therapy ? WEIGHTS.engagement : 0,
      active: therapy && Boolean(todayEntry),
      earned: therapy && todayEntry ? WEIGHTS.engagement : 0,
    },
    {
      key: 'priorities',
      max: WEIGHTS.priorities,
      active: liveCards.length > 0 || planPriorities.length > 0,
      earned: 0,
    },
    {
      key: 'caregiver_responses',
      max: WEIGHTS.caregiverResponses,
      active: responses.length > 0,
      earned: 0,
    },
  ];

  for (const signal of signals) {
    if (signal.key === 'uc4_freshness' || signal.key === 'engagement') continue;
    signal.earned = signal.active ? signal.max : 0;
  }

  // Redistribute the engagement weight when there is no therapy contract so a
  // non-rehab patient is not structurally capped below 85.
  if (!therapy) {
    const boost = Math.round(WEIGHTS.engagement / 3);
    for (const key of ['published_plan', 'goals', 'monitoring'] as const) {
      const signal = signals.find((candidate) => candidate.key === key)!;
      signal.max += key === 'published_plan' ? boost + (WEIGHTS.engagement - boost * 3) : boost;
      signal.earned = signal.active ? signal.max : 0;
    }
  }

  const rawScore = signals.reduce((sum, signal) => sum + signal.earned, 0);
  const score = Math.max(0, Math.min(100, rawScore));

  // Attention: what needs the caregiver right now.
  let attention: PlanPulseAttention = 'calm';
  const unactionedCards = liveCards.filter((card) => card.status === 'active').length;
  if (latestRun?.status === 'paused' || latestRun?.paused) {
    attention = 'urgent';
  } else if (
    pendingProposals.length > 0 ||
    unactionedCards > 0 ||
    (therapy && !todayEntry)
  ) {
    attention = 'review';
  }

  const statusWord: PlanPulseStatusWord =
    mode === 'read_only' ? 'view_only' : attention === 'calm' ? 'activated' : 'needs_review';

  return { score, attention, statusWord, signals };
}
