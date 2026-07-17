import { DailyRehabLog, EmergencyCheckResult } from "./types";

export const NORMALIZED_EMERGENCY_SYMPTOMS = new Set([
  "new_weakness",
  "chest_pain",
  "shortness_of_breath",
  "severe_sudden_pain",
  "severe_pain",
  "fall_with_injury",
  "confusion",
  "loss_of_consciousness"
]);

export function normalizeSymptom(symptom: string): string {
  return symptom.trim().toLowerCase().replace(/\s+/g, "_");
}

export function checkEmergencyRules(logs: DailyRehabLog[]): EmergencyCheckResult {
  const matchedSymptoms: string[] = [];

  for (const log of logs) {
    for (const symptom of log.symptoms || []) {
      const normalized = normalizeSymptom(symptom);

      if (NORMALIZED_EMERGENCY_SYMPTOMS.has(normalized)) {
        matchedSymptoms.push(normalized);
      }
    }
  }

  const uniqueSymptoms = Array.from(new Set(matchedSymptoms));

  if (uniqueSymptoms.length > 0) {
    return {
      emergencyThresholdBreach: true,
      matchedSymptoms: uniqueSymptoms,
      reasonCodes: ["EMERGENCY_SYMPTOM_REPORTED"],
      explanations: [
        `Urgent safety symptom reported: ${uniqueSymptoms.join(", ")}. This bypasses ordinary rehab review scoring.`
      ]
    };
  }

  return {
    emergencyThresholdBreach: false,
    matchedSymptoms: [],
    reasonCodes: ["NO_EMERGENCY_THRESHOLD_BREACH"],
    explanations: ["No emergency threshold breach was detected in the submitted home rehab logs."]
  };
}
