/**
 * Deterministic care-plan opportunity detector (Concierge chat auto-suggest).
 *
 * Read-only: derives suggestion chips + a compact PLAN WATCH prompt block
 * from existing snapshot / repository data. It NEVER writes — proposals are
 * drafted by the canonical intent path (runIntent → enqueue → awaiting_hitl)
 * and applied only after caregiver confirm + ML vet.
 *
 * Signals (rule-based ground truth, in line with "deterministic first"):
 *   - UC3 trajectory plateau / failure → propose_therapy_contract_patch
 *   - Active UC4 priority cards → promote_uc4_to_plan_task (cardId)
 *   - Pending threshold recommendations → review_monitoring_contract
 *
 * The medication "areas to watch" promote path is caregiver-drafted on the
 * Care tab (proposeMedicationWatchArea) and is intentionally not an SLM
 * auto-suggest signal in v1.
 */

import type { AdcpProposalIntentId, PendingPlanProposal } from '@/data/adcp/types';
import type { PatientRecordSnapshot } from '@/data/types';
import { listPendingProposals } from '@/data/repositories/adcpRepository';
import { getPendingThresholdRecommendations } from '@/data/repositories/thresholdRecommendationRepository';

export interface PlanOpportunity {
  /** Stable id (e.g. `uc4:card-123`) — used as a React key + dedupe hint. */
  id: string;
  intentId: AdcpProposalIntentId;
  args: Record<string, unknown>;
  /** Plain-language summary for the PLAN WATCH prompt block. */
  summary: string;
  dedupeKey: string;
}

const PENDING_STATUSES = new Set(['draft', 'awaiting_hitl', 'awaiting_ml_vet']);
const PROMOTABLE_UC4_STATUSES = new Set(['active', 'acknowledged']);
const PLATEAU_DAYS_THRESHOLD = 7;
const MAX_OPPORTUNITIES = 3;

function pendingForPatient(patientId: string): PendingPlanProposal[] {
  try {
    return listPendingProposals(patientId);
  } catch {
    return [];
  }
}

function isAlreadyPending(
  pending: PendingPlanProposal[],
  predicate: (payload: PendingPlanProposal['payload']) => boolean,
): boolean {
  return pending
    .filter((p) => PENDING_STATUSES.has(p.status))
    .some((p) => predicate(p.payload));
}

/**
 * Detect the current plan opportunities for the active patient.
 * Deterministic and bounded — max 3, strongest signals first.
 */
export function detectPlanOpportunities(
  snapshot: PatientRecordSnapshot | null,
  options?: { max?: number },
): PlanOpportunity[] {
  if (!snapshot?.patient?.patientId) return [];
  const patientId = snapshot.patient.patientId;
  const max = options?.max ?? MAX_OPPORTUNITIES;
  const pending = pendingForPatient(patientId);
  const out: PlanOpportunity[] = [];

  // ── UC3: therapy stalled (plateau / failure) ──
  const uc3 = snapshot.latestUc3TrajectoryResult;
  const metricPlateauDays = uc3
    ? Math.max(0, ...Object.values(uc3.metricAnalyses ?? {}).map((m) => m.plateauDays ?? 0))
    : 0;
  const uc3Stalled = Boolean(
    uc3 &&
      ((/PLATEAU|FAILURE/i.test(uc3.eventType) &&
        !/NORMAL|ON_TRACK/i.test(uc3.eventType)) ||
        metricPlateauDays >= PLATEAU_DAYS_THRESHOLD),
  );
  if (
    uc3Stalled &&
    uc3 &&
    !isAlreadyPending(pending, (payload) => payload.kind === 'therapy_patch')
  ) {
    out.push({
      id: `uc3:${uc3.resultId}`,
      intentId: 'propose_therapy_contract_patch',
      args: {},
      summary:
        `Therapy progress has stalled (${Math.max(metricPlateauDays, 0)} plateau day(s)) — ` +
        'a therapy plan update may be worth proposing.',
      dedupeKey: `therapy:${uc3.resultId}`,
    });
  }

  // ── UC4: active care-focus cards worth promoting ──
  const cards = (snapshot.latestUc4PriorityCards ?? [])
    .filter((c) => PROMOTABLE_UC4_STATUSES.has(c.status))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  for (const card of cards) {
    if (out.length >= max) break;
    if (
      isAlreadyPending(
        pending,
        (payload) =>
          payload.kind === 'priority_promote' &&
          (payload.sourceCardId === card.cardId ||
            payload.priority.sourceCardId === card.cardId),
      )
    ) {
      continue;
    }
    out.push({
      id: `uc4:${card.cardId}`,
      intentId: 'promote_uc4_to_plan_task',
      args: { cardId: card.cardId },
      summary:
        `The care focus "${card.title}" is active and could be promoted to a plan priority.`,
      dedupeKey: `promote:${card.cardId}`,
    });
  }

  // ── Threshold recommendations waiting for review ──
  let pendingRecCount = 0;
  try {
    pendingRecCount = getPendingThresholdRecommendations(patientId).length;
  } catch {
    pendingRecCount = 0;
  }
  if (
    out.length < max &&
    pendingRecCount > 0 &&
    !isAlreadyPending(pending, (payload) => payload.kind === 'threshold_patch')
  ) {
    out.push({
      id: 'thresholds:pending',
      intentId: 'review_monitoring_contract',
      args: {},
      summary:
        `${pendingRecCount} monitoring threshold recommendation(s) are waiting to be reviewed.`,
      dedupeKey: 'thresholds:pending',
    });
  }

  return out;
}

/** Count of proposals still waiting for the caregiver (HITL queue). */
export function countPendingPlanReviews(snapshot: PatientRecordSnapshot | null): number {
  return (
    snapshot?.pendingPlanProposals?.filter((p) =>
      PENDING_STATUSES.has(p.status),
    ).length ?? 0
  );
}

/**
 * Compact, budgeted PLAN WATCH block appended to the Concierge chat system
 * context. Gives the chat SLM deterministic plan ground truth and the exact
 * emission format for the propose_care_plan_update tool. Never claims state
 * the caregiver hasn't confirmed.
 */
export function buildPlanWatchBlock(
  snapshot: PatientRecordSnapshot | null,
  opportunities: PlanOpportunity[],
  maxChars = 700,
): string {
  const pendingReviews = countPendingPlanReviews(snapshot);
  if (opportunities.length === 0 && pendingReviews === 0) return '';

  const lines: string[] = [
    'PLAN WATCH (deterministic signals from the patient record — context only, never treat as facts you stated)',
  ];
  if (pendingReviews > 0) {
    lines.push(
      `- ${pendingReviews} plan proposal(s) are waiting for the caregiver's review in the plan.`,
    );
  }
  for (const o of opportunities) {
    const argsNote =
      Object.keys(o.args).length > 0 ? ` args=${JSON.stringify(o.args)}` : '';
    lines.push(`- ${o.summary} Eligible intent: ${o.intentId}${argsNote}`);
  }
  lines.push(
    '- If the caregiver asks about the plan, or one of these signals clearly fits the conversation, you may propose a plan update by emitting exactly one line:',
  );
  lines.push(
    '  ACTION: propose_care_plan_update({"intent":"<one intent above>","cardId":"<cardId from args, when present>"})',
  );
  lines.push(
    '- Propose only. Never claim anything was changed, applied, or scheduled — the caregiver must confirm every proposal before it can apply.',
  );

  let text = lines.join('\n');
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n…`;
  }
  return text;
}
