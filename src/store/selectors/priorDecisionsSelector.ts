/**
 * priorDecisionsSelector — the SLM↔Redux bridge (planning/32 §9.2).
 *
 * The SLM is a guest in the control loop and never subscribes to the Redux
 * store directly. Instead, the orchestrator receives a `priorDecisionsProvider`
 * callback at construction time; the callback reads the relevant slice
 * (audit + nonEmergencyDecision) and returns a compact 3–5 line summary
 * suitable for prompt injection.
 *
 * Keeping the orchestrator ignorant of Redux preserves its testability and
 * ensures the safety-reviewer verdict remains the single chokepoint.
 */

import type { RootState } from '@/store';
import { selectNonEmergencyDecisionForAlert } from '@/store/reducers/nonEmergencyDecisionSlice';
import { listCaregiverDecisions } from '@/hooks/usePendingReviews';
import type { PriorDecisionEntry } from '@/orchestration/prompt-fragments';

export interface PriorDecisionsProviderArgs {
  patientId: string;
  /** Optional alert id — when set, the current non-emergency decision
   *  (if any) is folded into the entries as the leading "currently flagged"
   *  item. */
  alertId?: string;
}

/**
 * Selector function. Pass it the Redux state + provider args, get a compact
 * prompt-ready block. The orchestrator-context wires this up to the live store.
 */
export function selectPriorDecisionsForPrompt(
  state: RootState,
  args: PriorDecisionsProviderArgs,
): PriorDecisionEntry[] {
  const recent = listCaregiverDecisions(5).map<PriorDecisionEntry>((row) => ({
    verb: row.verb,
    summary: row.summary || row.alertTitle || 'decision',
    at: row.createdAt,
  }));

  if (args.alertId) {
    const workflow = selectNonEmergencyDecisionForAlert(state, args.patientId, args.alertId);
    if (workflow.decision) {
      const lead: PriorDecisionEntry = {
        verb: 'flagged',
        summary: `${workflow.decision.finalAnomalyType} (sev ${workflow.decision.finalSeverity})`,
        at: new Date().toISOString(),
      };
      return [lead, ...recent].slice(0, 5);
    }
  }
  return recent;
}

/**
 * Provider-factory. Returns a closure the orchestrator can invoke per-explain.
 * The closure binds the Redux store via `getState()` (a thunk-style accessor).
 */
export function makePriorDecisionsProvider(
  getState: () => RootState,
): (args: PriorDecisionsProviderArgs) => PriorDecisionEntry[] {
  return (args) => selectPriorDecisionsForPrompt(getState(), args);
}
