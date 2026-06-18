import {
  getActiveAlerts,
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
