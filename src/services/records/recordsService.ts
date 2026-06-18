import { hasActiveConsent } from "@/data";
import {
  grantConsent,
  revokeConsentAndAudit,
  type EgressScope,
} from "@/services/consent/consentGate";
import { exportCcd } from "@/services/export/ccdaExportService";

const DEFAULT_PATIENT_ID = "default-patient";
const CCDA_EXPORT_SCOPE: EgressScope = "ccda_export";

export type RecordExportConsentStatus = {
  patientId: string;
  scope: EgressScope;
  granted: boolean;
};

export type CcdaExportStatus =
  | {
      status: "queued";
      message: string;
    }
  | {
      status: "denied";
      message: string;
      reason?: string;
    }
  | {
      status: "failed";
      message: string;
    };

export function getRecordExportConsentStatus(
  patientId: string = DEFAULT_PATIENT_ID,
): RecordExportConsentStatus {
  try {
    return {
      patientId,
      scope: CCDA_EXPORT_SCOPE,
      granted: hasActiveConsent(patientId, CCDA_EXPORT_SCOPE),
    };
  } catch {
    return {
      patientId,
      scope: CCDA_EXPORT_SCOPE,
      granted: false,
    };
  }
}

export function setRecordExportConsent(
  granted: boolean,
  patientId: string = DEFAULT_PATIENT_ID,
): RecordExportConsentStatus {
  if (granted) {
    grantConsent(patientId, CCDA_EXPORT_SCOPE);
  } else {
    revokeConsentAndAudit(patientId, CCDA_EXPORT_SCOPE);
  }

  return getRecordExportConsentStatus(patientId);
}

export function exportPatientCcda(
  patientId: string = DEFAULT_PATIENT_ID,
): CcdaExportStatus {
  try {
    const result = exportCcd(patientId);

    if (result.queued) {
      return {
        status: "queued",
        message: "C-CDA record exported and queued for sync.",
      };
    }

    if (result.denied) {
      return {
        status: "denied",
        reason: result.reason,
        message:
          result.reason ??
          "Record export consent is required before exporting a C-CDA record.",
      };
    }

    return {
      status: "failed",
      message: "C-CDA export did not queue. Please try again.",
    };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
