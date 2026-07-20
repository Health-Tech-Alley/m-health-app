import { hasActiveConsent } from "@/data";
import {
  grantConsent,
  revokeConsentAndAudit,
  type EgressScope,
} from "@/services/consent/consentGate";
import { exportCcd } from "@/services/export/ccdaExportService";

const DEFAULT_PATIENT_ID = "default-patient";

export type RecordConsentScope =
  | "ccda_export"
  | "fhir-share"
  | "pharmacy-communicator"
  | "provider-message"
  | "adcp_backup";

const CCDA_EXPORT_SCOPE: RecordConsentScope = "ccda_export";

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
  return getRecordConsentStatus(CCDA_EXPORT_SCOPE, patientId);
}

export function getRecordConsentStatus(
  scope: RecordConsentScope,
  patientId: string = DEFAULT_PATIENT_ID,
): RecordExportConsentStatus {
  try {
    return {
      patientId,
      scope,
      granted: hasActiveConsent(patientId, scope),
    };
  } catch {
    return {
      patientId,
      scope,
      granted: false,
    };
  }
}

export function setRecordExportConsent(
  granted: boolean,
  patientId: string = DEFAULT_PATIENT_ID,
): RecordExportConsentStatus {
  return setRecordConsent(CCDA_EXPORT_SCOPE, granted, patientId);
}

export function setRecordConsent(
  scope: RecordConsentScope,
  granted: boolean,
  patientId: string = DEFAULT_PATIENT_ID,
): RecordExportConsentStatus {
  if (granted) {
    grantConsent(patientId, scope);
  } else {
    revokeConsentAndAudit(patientId, scope);
  }

  return getRecordConsentStatus(scope, patientId);
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
