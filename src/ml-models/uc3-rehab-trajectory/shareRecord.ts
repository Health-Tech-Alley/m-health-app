import { RehabDecision, RehabPlan, ShareRecordPayload } from "./types";

export function buildShareRecordPayload(
  decision: RehabDecision,
  plan: RehabPlan,
  caregiverMessage: string,
  clinicianSummary: string
): ShareRecordPayload {
  return {
    jsonrpc: "2.0",
    method: "share_record",
    params: {
      useCase: "ACCESS-DP · USE CASE #3: LONG-TERM TRAJECTORY FAILURE (OFFLINE-FIRST & SECURE ESCALATION)",
      eventType: decision.eventType,
      severity: decision.severity,
      patientId: plan.patient.patientId,
      requiresHumanReview: decision.requiresHumanReview,
      emergencyThresholdBreach: decision.emergencyThresholdBreach,
      reviewPriorityScore: decision.reviewPriorityScore,
      decisionSummary: decision.explanations.join(" "),
      reasonCodes: decision.reasonCodes,
      encryptedBundleMetadata: {
        format: "AES-GCM-256 ciphertext bundle",
        encryption: "AES-GCM-256",
        transportSecurity: "Signal Protocol / Double Ratchet Algorithm",
        localStorage: "SQLCipher",
        keyStorage: "iOS Keychain / Android Keystore"
      },
      fhirR4Hint: {
        resourceTypes: [
          "Patient",
          "Observation",
          "CarePlan",
          "CommunicationRequest",
          "DocumentReference"
        ]
      },
      payload: {
        decision,
        caregiverMessage,
        clinicianSummary
      }
    },
    id: `share_record_uc3_${Date.now()}`
  };
}
