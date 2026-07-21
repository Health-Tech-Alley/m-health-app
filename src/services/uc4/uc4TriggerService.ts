/**
 * UC4 on-focus trigger service (Care tab rework).
 *
 * Ensures every patient gets UC4 care-focus evaluations — not only patients
 * going through the therapy flow. Called when the Care tab gains focus;
 * throttled per patient so the deterministic engine is not re-run on every
 * tab switch.
 *
 * State-management compliance:
 *   - Reads the patient snapshot via getCurrentPatientSnapshot() (no new
 *     snapshot fields, no provider changes).
 *   - Throttle timestamp lives in app_settings under a per-patient key —
 *     app-level bookkeeping, not patient EHR truth.
 *   - Persistence goes through the existing evaluateAndPersistUc4Priorities
 *     service and its existing UC4 tables.
 */

import { getDatabase } from '../../data/db';
import { getCurrentPatientSnapshot } from '../../contexts/patient-record-context';
import { evaluateAndPersistUc4Priorities } from './uc4EvaluationService';

/** Minimum gap between focus-triggered evaluations for one patient. */
export const UC4_FOCUS_EVAL_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

const lastRunKey = (patientId: string) => `uc4_last_focus_eval:${patientId}`;

function readLastRunIso(patientId: string): string | null {
  try {
    const row = getDatabase().getFirstSync<{ value_json: string }>(
      'SELECT value_json FROM app_settings WHERE key = ?;',
      lastRunKey(patientId),
    );
    if (!row?.value_json) return null;
    const parsed = JSON.parse(row.value_json);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function writeLastRunIso(patientId: string, iso: string): void {
  try {
    getDatabase().runSync(
      `INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?);`,
      lastRunKey(patientId),
      JSON.stringify(iso),
      iso,
    );
  } catch {
    /* bookkeeping only — never block the tab on a settings write */
  }
}

export type Uc4FocusEvalOutcome =
  | { kind: 'evaluated'; runStatus: 'completed' | 'paused' | 'no_cards'; cardCount: number }
  | { kind: 'skipped_throttled'; lastRunIso: string }
  | { kind: 'skipped_no_patient' }
  | { kind: 'not_ready' }
  | { kind: 'error'; message: string };

export function isUc4FocusEvalDue(patientId: string, nowMs = Date.now()): boolean {
  const lastRunIso = readLastRunIso(patientId);
  if (!lastRunIso) return true;
  const lastRunMs = Date.parse(lastRunIso);
  if (Number.isNaN(lastRunMs)) return true;
  return nowMs - lastRunMs >= UC4_FOCUS_EVAL_MIN_INTERVAL_MS;
}

/**
 * Run UC4 for the active patient when due. Safe to call on every Care-tab
 * focus — returns quickly when throttled, and quietly degrades when the
 * adapter is not ready or the engine pauses (e.g. severity-3 emergency).
 */
export function evaluateUc4OnCareFocus(options: {
  minIntervalMs?: number;
  force?: boolean;
} = {}): Uc4FocusEvalOutcome {
  const snapshot = getCurrentPatientSnapshot();
  const patientId = snapshot?.patient?.patientId;
  if (!snapshot || !patientId) {
    return { kind: 'skipped_no_patient' };
  }

  const nowMs = Date.now();
  if (!options.force) {
    const lastRunIso = readLastRunIso(patientId);
    if (lastRunIso) {
      const lastRunMs = Date.parse(lastRunIso);
      const interval = options.minIntervalMs ?? UC4_FOCUS_EVAL_MIN_INTERVAL_MS;
      if (!Number.isNaN(lastRunMs) && nowMs - lastRunMs < interval) {
        return { kind: 'skipped_throttled', lastRunIso };
      }
    }
  }

  const startedIso = new Date(nowMs).toISOString();
  try {
    const result = evaluateAndPersistUc4Priorities(snapshot);
    // Record the attempt regardless of outcome so a failing adapter does not
    // spin the engine on every focus.
    writeLastRunIso(patientId, startedIso);
    if (result.status === 'success') {
      return {
        kind: 'evaluated',
        runStatus: result.runStatus,
        cardCount: result.cards.length,
      };
    }
    if (result.status === 'not_ready') {
      return { kind: 'not_ready' };
    }
    return { kind: 'error', message: result.message };
  } catch (error) {
    writeLastRunIso(patientId, startedIso);
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
