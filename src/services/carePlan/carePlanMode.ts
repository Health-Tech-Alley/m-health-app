/**
 * Living care plan mutation policy (planning/41 D1).
 *
 * App-wide preference, NOT patient EHR — lives in `app_settings` so it never
 * touches `PatientRecordSnapshot` per AGENTS.md State Management Authority.
 *
 * When `read_only`:
 *   - The plan-as-RAG index + display continue to work.
 *   - Concierge explain intents continue to work.
 *   - Care plan export continues to work.
 *   - Care plan restore continues to work (with explicit confirm + consent).
 *   - Mutating intents (review_monitoring_contract, propose_therapy_contract_patch,
 *     promote_uc4_to_plan_task, weekly_care_plan_review) are blocked at the
 *     intent router + UI.
 *   - Caregiver confirm of any pending proposal is a no-op + toast.
 *   - UC2/UC3/UC4 proposal drains early-return.
 *   - `publishAdcpRevision` from ML/SLM is blocked (only `seed:*` / restore
 *     paths are allowed through `publishAdcpRevisionFromTrustedSource`).
 *
 * Single-gate pattern: every mutating path calls `assertCarePlanWritable()`
 * (or `isCarePlanWritable()`) at the top.
 */

import { getAppSettings } from '@/data/repositories/appSettingsRepository';
import type { CarePlanMode } from '@/data/types';
import type { AdcpProposalIntentId } from '@/data/adcp/types';

export type { CarePlanMode };

export type CarePlanWriteBlockReason =
  | 'read_only_mode'
  | 'no_active_patient';

export interface CarePlanWriteOk {
  ok: true;
}

export interface CarePlanWriteBlocked {
  ok: false;
  reason: CarePlanWriteBlockReason;
  message: string;
}

export type CarePlanWriteResult = CarePlanWriteOk | CarePlanWriteBlocked;

const READ_ONLY_BLOCKED_MESSAGE =
  'Care plan updates are turned off. Turn on Living care plan updates in Settings to make changes.';

export function getCarePlanMode(): CarePlanMode {
  return getAppSettings().carePlanMode ?? 'full';
}

export function isCarePlanWritable(): boolean {
  return getCarePlanMode() === 'full';
}

/**
 * Call at the start of any plan-mutating path. Returns a typed result so
 * callers can branch on `ok` and surface a caregiver-safe message without
 * throwing.
 */
export function assertCarePlanWritable(
  options?: { activePatientId?: string | null },
): CarePlanWriteResult {
  if (!isCarePlanWritable()) {
    return { ok: false, reason: 'read_only_mode', message: READ_ONLY_BLOCKED_MESSAGE };
  }
  if (options && options.activePatientId !== undefined && !options.activePatientId) {
    return { ok: false, reason: 'no_active_patient', message: 'Select a patient first.' };
  }
  return { ok: true };
}

/**
 * Intents that would mutate the living care plan. Explain / logging-suggest
 * / handoff-summary intents are intentionally excluded — they are
 * narrative-only and remain available in read-only mode.
 */
export const MUTATING_INTENTS: ReadonlySet<AdcpProposalIntentId> = new Set<AdcpProposalIntentId>([
  'review_monitoring_contract',
  'propose_therapy_contract_patch',
  'promote_uc4_to_plan_task',
  'weekly_care_plan_review',
]);

export function isMutatingIntent(intent: AdcpProposalIntentId): boolean {
  return MUTATING_INTENTS.has(intent);
}

export const READ_ONLY_TOAST_MESSAGE = READ_ONLY_BLOCKED_MESSAGE;
