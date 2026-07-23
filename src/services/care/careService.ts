import {
  dismissAlert,
  getActiveAlerts,
  getAlertsForLog,
  removeAlert,
  updateAlertStatus,
  type Alert,
} from "@/data";

const DEFAULT_PATIENT_ID = "default-patient";

export type CareAlert = Alert;

export function getActiveCareAlerts(
  patientId: string = DEFAULT_PATIENT_ID,
): CareAlert[] {
  try {
    return getActiveAlerts(patientId);
  } catch {
    return [];
  }
}

/**
 * All alerts for the Dashboard alerts log (excludes `removed`). Grouped by
 * the UI into active (open / acknowledged) and inactive
 * (dismissed / resolved / escalated).
 */
export function getCareAlertsForLog(
  patientId: string = DEFAULT_PATIENT_ID,
): CareAlert[] {
  try {
    return getAlertsForLog(patientId);
  } catch {
    return [];
  }
}

export function acknowledgeCareAlert(alertId: string): boolean {
  try {
    updateAlertStatus(alertId, "acknowledged");
    return true;
  } catch {
    return false;
  }
}

export function resolveCareAlert(alertId: string): boolean {
  try {
    updateAlertStatus(alertId, "resolved");
    return true;
  } catch {
    return false;
  }
}

/**
 * Permanently suppress the critical-alert popup. The alert remains in the log
 * as inactive and is retained for the audit trail.
 */
export function dismissCareAlert(alertId: string): boolean {
  try {
    dismissAlert(alertId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove an alert from the log. The row is retained in SQLite (status
 * `removed`) for the tamper-evident audit trail.
 */
export function removeCareAlert(alertId: string): boolean {
  try {
    removeAlert(alertId);
    return true;
  } catch {
    return false;
  }
}
