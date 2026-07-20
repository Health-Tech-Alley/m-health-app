/**
 * Hooks and helpers for HITL ("Your Review") UI promotion.
 *
 * Per planning/29_hitl-promotion-plan.md: aggregate the count of items that
 * need caregiver attention — pending threshold recommendations, open
 * non-emergency alerts, and unsent SLM proposals — and surface them as a
 * dashboard banner.
 *
 * Pure data: the actual rendering lives in
 * `src/components/dashboard/NeedsYourReviewBanner.tsx`.
 */

import { useCallback, useSyncExternalStore } from 'react';

import { getPendingThresholdRecommendations } from '@/data/repositories/thresholdRecommendationRepository';
import { getActiveCareAlerts } from '@/services/care/careService';
import { useFocusEffect } from 'expo-router';
import { getAuditEntriesForResource } from '@/data/repositories/auditRepository';
import { getAlertById } from '@/data';
import { listPendingProposalSummaries } from '@/data/repositories/adcpRepository';

export type PendingReview = {
  thresholdRecommendations: number;
  openNonEmergencyAlerts: number;
  planProposals: number;
  total: number;
};

const EMPTY: PendingReview = {
  thresholdRecommendations: 0,
  openNonEmergencyAlerts: 0,
  planProposals: 0,
  total: 0,
};

/**
 * Compute the count of pending HITL items for the active patient.
 *
 * "Pending" is intentionally broad: anything that requires the caregiver
 * to look at the app, decide, and act. Severity-3 alerts short-circuit the
 * HITL flow (confidence router), so they don't count. Plan proposals in
 * `awaiting_hitl` count toward HITL review (planning/39 §4.3 + L18).
 */
export function countPendingReviews(patientId: string | null): PendingReview {
  if (!patientId) return EMPTY;
  const recs = getPendingThresholdRecommendations(patientId).filter((r) => r.status === 'pending');
  const alerts = getActiveCareAlerts(patientId);
  const openAlerts = alerts.filter((a) => a.severity <= 2 && a.status === 'open');
  const proposals = listPendingProposalSummaries(patientId).filter(
    (p) =>
      p.status === 'draft' || p.status === 'awaiting_hitl' || p.status === 'awaiting_ml_vet',
  );
  return {
    thresholdRecommendations: recs.length,
    openNonEmergencyAlerts: openAlerts.length,
    planProposals: proposals.length,
    total: recs.length + openAlerts.length + proposals.length,
  };
}

// Simple in-process pub/sub that the dashboard's "recompute" effect drives
// (via useFocusEffect). Avoids the cascading-render antipattern of
// setState-in-effect while still letting the count refresh on focus.
const reviewListeners = new Set<() => void>();
function subscribeToReviews(cb: () => void): () => void {
  reviewListeners.add(cb);
  return () => reviewListeners.delete(cb);
}
function notifyReviewListeners(): void {
  reviewListeners.forEach((cb) => cb());
}

// Cache the last snapshot so `useSyncExternalStore` sees a stable reference
// when the underlying values haven't changed. Without this, `countPendingReviews`
// returns a new object literal on every call, which `useSyncExternalStore`
// treats as a store change and triggers an infinite re-render loop.
let cachedSnapshot: PendingReview = EMPTY;
let cachedPatientId: string | null = null;

function getStableSnapshot(patientId: string | null): PendingReview {
  const fresh = countPendingReviews(patientId);
  if (
    cachedPatientId === patientId &&
    cachedSnapshot.thresholdRecommendations === fresh.thresholdRecommendations &&
    cachedSnapshot.openNonEmergencyAlerts === fresh.openNonEmergencyAlerts &&
    cachedSnapshot.planProposals === fresh.planProposals &&
    cachedSnapshot.total === fresh.total
  ) {
    return cachedSnapshot;
  }
  cachedSnapshot = fresh;
  cachedPatientId = patientId;
  return fresh;
}

/**
 * Live hook variant — recomputes on dashboard focus.
 */
export function usePendingReviews(patientId: string | null): PendingReview {
  const getSnapshot = useCallback(() => getStableSnapshot(patientId), [patientId]);
  const reviews = useSyncExternalStore(subscribeToReviews, getSnapshot, getSnapshot);

  useFocusEffect(
    useCallback(() => {
      notifyReviewListeners();
    }, []),
  );

  return reviews;
}

export type CaregiverDecisionRow = {
  actionId: string;
  type: string;
  createdAt: string;
  alertTitle?: string | null;
  /** "Overrode the Concierge" / "Answered a Concierge question" — human-friendly. */
  verb: string;
  /** A short, caregiver-facing description of the decision. */
  summary: string;
};

const VERB_BY_TYPE: Record<string, string> = {
  override: 'Overrode the Concierge',
  answer_clarifying_question: 'Answered a Concierge question',
  ask_slm: 'Asked the Concierge to explain',
  log_observation: 'Noted an observation',
  acknowledge_alert: 'Acknowledged an alert',
  resolve_alert: 'Resolved an alert',
  threshold_recommendation_apply: 'Applied a threshold recommendation',
  threshold_recommendation_dismiss: 'Dismissed a threshold recommendation',
};

function summarizePayload(type: string, payload: Record<string, unknown> | undefined): string {
  if (!payload) return '';
  if (type === 'override') {
    const note = typeof payload.note === 'string' ? payload.note.trim() : '';
    return note ? `Note: “${note}”` : 'No note provided';
  }
  if (type === 'answer_clarifying_question') {
    const option = typeof payload.selectedOption === 'string' ? payload.selectedOption : '';
    return option ? `Chose: “${option}”` : '';
  }
  if (type === 'ask_slm') {
    return 'Asked the Concierge to explain the alert';
  }
  if (type === 'log_observation') {
    const obs = typeof payload.observation === 'string' ? payload.observation : '';
    return obs ? `Observation: “${obs}”` : 'Logged an observation';
  }
  if (type === 'threshold_recommendation_apply') {
    return 'Personalized a threshold';
  }
  if (type === 'threshold_recommendation_dismiss') {
    return 'Kept current threshold';
  }
  return '';
}

/**
 * Fetch recent caregiver decisions for the "Your Decisions" section. Pulls
 * from the audit log (resourceType='caregiver_action') so it shows up
 * consistently with the rest of the audit infrastructure.
 */
export function listCaregiverDecisions(limit: number = 20): CaregiverDecisionRow[] {
  const entries = getAuditEntriesForResource('caregiver_action', undefined, limit);
  const rows: CaregiverDecisionRow[] = entries.map((entry) => {
    const payload = entry.payloadJson ? (JSON.parse(entry.payloadJson) as Record<string, unknown>) : undefined;
    const alertId = typeof payload?.alertId === 'string' ? payload.alertId : undefined;
    const alert = alertId ? getAlertById(alertId) : null;
    const type = entry.action;
    return {
      actionId: entry.resourceId ?? entry.auditId,
      type,
      createdAt: entry.createdAt,
      alertTitle: alert?.title ?? null,
      verb: VERB_BY_TYPE[type] ?? type,
      summary: summarizePayload(type, payload),
    };
  });
  return rows;
}

/**
 * Caregiver-facing label for a decision. Used by the "Your Decisions" list
 * to make the audit log feel like a personal history instead of raw events.
 */
export function decisionDisplayLine(row: CaregiverDecisionRow, patientFirst: string): string {
  const subject = row.alertTitle ? `“${row.alertTitle}”` : `an alert about ${patientFirst}`;
  if (row.summary) {
    return `${row.verb} on ${subject}. ${row.summary}`;
  }
  return `${row.verb} on ${subject}.`;
}
