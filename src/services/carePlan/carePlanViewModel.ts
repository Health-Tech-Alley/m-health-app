/**
 * Care tab view-model (planning/41 §7).
 *
 * Pure-ish assembler: takes the current `PatientRecordSnapshot` and
 * `app_settings.carePlanMode`, reads the active ADCP revision + decision
 * log from the repository, and returns a flat view-model the section
 * components can render.
 *
 * Important constraints (AGENTS.md state authority):
 *   - NEVER adds fields to `PatientRecordSnapshot` (no snapshot/Redux edits).
 *   - NEVER writes back to the snapshot; output is presentational only.
 *   - All data reads go through existing repositories — same pattern as
 *     the export/audit "derivations" hooks (see completed/40 §10A).
 */

import {
  getActiveAdcpRevisionForPatient,
  listPlanDecisionLog,
  planHasTherapyContract,
} from '@/data/repositories/adcpRepository';
import type { AdcpPlanDocument } from '@/data/adcp/types';
import type {
  CarePlanGoalSummary,
  LatestUc4PriorityCardSummary,
  PatientRecordSnapshot,
} from '@/data/types';
import { getAppSettings } from '@/data/repositories/appSettingsRepository';
import { getCarePlanMode, type CarePlanMode } from './carePlanMode';

export type CarePlanSectionKey =
  | 'header'
  | 'review'
  | 'focus'
  | 'safety'
  | 'monitoring'
  | 'therapy'
  | 'goals'
  | 'history'
  | 'backup'
  | 'ask';

export interface CarePlanFocusCard {
  cardId: string;
  title: string;
  domain: string;
  weight: number;
  /** Live engine card vs durable priority already on the care plan. */
  source: 'uc4_live' | 'plan_priority';
}

export interface CarePlanSafetyLine {
  kind: 'always' | 'never' | 'note';
  text: string;
}

export interface CarePlanHistoryItem {
  id: string;
  summary: string;
  at: string;
}

export interface CarePlanViewModel {
  mode: CarePlanMode;
  writable: boolean;
  plan: AdcpPlanDocument | null;
  versionLabel: string;
  updatedLabel: string;
  sections: {
    showReview: boolean;
    showFocus: boolean;
    showSafety: boolean;
    showTherapy: boolean;
    showGoals: boolean;
    showHistory: boolean;
  };
  safetyLines: CarePlanSafetyLine[];
  focusCards: CarePlanFocusCard[];
  pendingProposalCount: number;
  decisionDigest: CarePlanHistoryItem[];
  source: AdcpPlanDocument['identity']['source'] | 'unpublished';
}

const MAX_HISTORY_ITEMS = 8;

function buildFocusCards(
  snapshot: PatientRecordSnapshot | null,
  plan: AdcpPlanDocument | null,
): CarePlanFocusCard[] {
  const liveIds = new Set(
    (snapshot?.latestUc4PriorityCards ?? []).map((c) => c.cardId),
  );
  const fromSnapshot: CarePlanFocusCard[] = (snapshot?.latestUc4PriorityCards ?? []).map(
    (c: LatestUc4PriorityCardSummary) => ({
      cardId: c.cardId,
      title: c.title,
      domain: c.domain,
      weight: c.score,
      source: 'uc4_live' as const,
    }),
  );
  const fromPlan: CarePlanFocusCard[] = (plan?.carePriorities.priorities ?? [])
    .filter((p) => p.status === 'active')
    .map((p) => ({
      cardId: p.sourceCardId ?? p.priorityId,
      title: p.title,
      domain: p.domain,
      weight: p.weight,
      source: 'plan_priority' as const,
    }))
    // Avoid double-listing a priority that is still the live top card.
    .filter((p) => !liveIds.has(p.cardId));
  // Live cards first (this week); durable plan priorities after.
  return [...fromSnapshot, ...fromPlan];
}

function collectSafetyLines(
  plan: AdcpPlanDocument | null,
  snapshot: PatientRecordSnapshot | null,
): CarePlanSafetyLine[] {
  const lines: CarePlanSafetyLine[] = [];
  if (plan?.safetyEnvelope.alwaysDo?.length) {
    for (const s of plan.safetyEnvelope.alwaysDo) {
      lines.push({ kind: 'always', text: s });
    }
  }
  if (plan?.safetyEnvelope.neverDo?.length) {
    for (const s of plan.safetyEnvelope.neverDo) {
      lines.push({ kind: 'never', text: s });
    }
  }
  const notes =
    plan?.safetyEnvelope.safetyNotes ?? snapshot?.safetyNotes ?? snapshot?.carePlan?.safetyNotes;
  if (notes) {
    lines.push({ kind: 'note', text: notes });
  }
  return lines;
}

function hasPlanGoals(plan: AdcpPlanDocument | null): boolean {
  return Boolean(plan && plan.goals.goals.length > 0);
}

function hasSnapshotGoals(snapshot: PatientRecordSnapshot | null): boolean {
  if (!snapshot) return false;
  const goals = snapshot.carePlanGoals as CarePlanGoalSummary[] | undefined;
  return Boolean(goals && goals.length > 0);
}

function hasCareTeamActivities(snapshot: PatientRecordSnapshot | null): boolean {
  if (!snapshot) return false;
  const plan = snapshot.carePlan;
  return Boolean(plan?.activities && plan.activities.length > 0);
}

export function buildCarePlanViewModel(
  snapshot: PatientRecordSnapshot | null,
): CarePlanViewModel {
  const patientId = snapshot?.patient?.patientId ?? '';
  const mode = getCarePlanMode();
  const plan = patientId ? getActiveAdcpRevisionForPatient(patientId) : null;
  const therapyFromSnapshot = Boolean(snapshot?.therapyContractPresent);
  const therapyFromPlan = planHasTherapyContract(plan);
  const therapy = therapyFromSnapshot || therapyFromPlan;
  const focusCards = buildFocusCards(snapshot, plan);

  const pending = (snapshot?.pendingPlanProposals ?? []).filter((p) =>
    ['draft', 'awaiting_hitl', 'awaiting_ml_vet'].includes(p.status),
  );

  const safetyLines = collectSafetyLines(plan, snapshot);

  const decisions = patientId ? listPlanDecisionLog(patientId, MAX_HISTORY_ITEMS) : [];

  const version = snapshot?.activeAdcpVersion?.version ?? plan?.identity.version;
  const publishedAt =
    snapshot?.activeAdcpVersion?.publishedAt ??
    plan?.identity.publishedAt ??
    plan?.identity.effectiveAt ??
    '';

  return {
    mode,
    writable: mode === 'full',
    plan,
    versionLabel: version != null ? `Care plan v${version}` : 'Care plan',
    updatedLabel: publishedAt ? publishedAt.slice(0, 10) : 'Not published yet',
    sections: {
      // Review (Pending Proposals) only when there ARE pending AND we can act
      // on them — read-only mode suppresses the "needs your review" surface
      // because there is no action available until Living updates is on.
      showReview: pending.length > 0 && mode === 'full',
      showFocus: focusCards.length > 0,
      // Safety is always shown when there is anything to say; otherwise the
      // section is hidden by the section component itself.
      showSafety: safetyLines.length > 0,
      showTherapy: therapy,
      showGoals:
        hasPlanGoals(plan) || hasSnapshotGoals(snapshot) || hasCareTeamActivities(snapshot),
      showHistory: decisions.length > 0,
    },
    safetyLines,
    focusCards,
    pendingProposalCount: pending.length,
    decisionDigest: decisions.map((d) => ({
      id: d.decisionId,
      summary: d.summary,
      at: d.createdAt,
    })),
    source: plan?.identity.source ?? 'unpublished',
  };
}

/**
 * Read-only helper for non-React consumers. Same source as the React hook but
 * doesn't use `useSyncExternalStore`. Callers should re-invoke this when
 * `app_settings` mutates (the hook does that for React callers).
 */
export function readCarePlanViewModelFromSettings(
  snapshot: PatientRecordSnapshot | null,
): CarePlanViewModel {
  // Settings is already in the snapshot's implicit dep — calling this
  // function reads the latest app_settings on every invocation. Used by
  // non-React call sites (e.g. intent input builders) that don't need
  // memoization.
  void getAppSettings();
  return buildCarePlanViewModel(snapshot);
}
