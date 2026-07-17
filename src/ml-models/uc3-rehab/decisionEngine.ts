import {
  DailyRehabLog,
  EHRRehabContext,
  EventType,
  MODEL_FAMILY,
  MODEL_VERSION,
  RehabDecision,
  RehabPlan,
  Severity
} from "./types";
import { checkEmergencyRules } from "./safety";
import { evaluateDataQuality } from "./dataQuality";
import { analyzeMetricTrajectories } from "./trajectory";
import { calculateReviewPriorityScore } from "./scoring";
import { deriveAdherenceForLogs } from "./adherence";

export function evaluateRehabTrajectory(
  plan: RehabPlan,
  logs: DailyRehabLog[],
  ehrContext: EHRRehabContext
): RehabDecision {

  const adherenceDerivation = deriveAdherenceForLogs (logs, {
    overwriteExisting: false,
    excuseMedicallySkippedDays: true,
  });

  const normalizedLogs = adherenceDerivation.logs;

  const dataQuality = evaluateDataQuality(normalizedLogs, plan);
  const emergencyResult = checkEmergencyRules(normalizedLogs);
  const metricAnalyses = analyzeMetricTrajectories(normalizedLogs, plan);

  const baseReviewPriorityScore = calculateReviewPriorityScore(
    metricAnalyses,
    ehrContext
  );

  const reasonCodes: string[] = [];
  const explanations: string[] = [];

  reasonCodes.push(...emergencyResult.reasonCodes);
  explanations.push(...emergencyResult.explanations);

  if (emergencyResult.emergencyThresholdBreach) {
    return {
      eventType: "URGENT_SAFETY_ESCALATION",
      severity: "urgent",
      requiresHumanReview: true,
      emergencyThresholdBreach: true,
      reviewPriorityScore: 1.0,
      reasonCodes,
      explanations,
      metricAnalyses,
      dataQuality,
      modelVersion: MODEL_VERSION,
      modelFamily: MODEL_FAMILY,
      generatedAt: new Date().toISOString()
    };
  }

  if (!dataQuality.sufficientData) {
    return {
      eventType: "INSUFFICIENT_DATA",
      severity: "informational",
      requiresHumanReview: false,
      emergencyThresholdBreach: false,
      reviewPriorityScore: baseReviewPriorityScore,
      reasonCodes: [...reasonCodes, "INSUFFICIENT_DATA"],
      explanations: [
        ...explanations,
        "There are not enough home rehab logs to reliably assess trajectory failure."
      ],
      metricAnalyses,
      dataQuality,
      modelVersion: MODEL_VERSION,
      modelFamily: MODEL_FAMILY,
      generatedAt: new Date().toISOString()
    };
  }

  const rom = metricAnalyses.romDegrees;
  const adherence = metricAnalyses.adherence;
  const pain = metricAnalyses.painScore;
  const fatigue = metricAnalyses.fatigueScore;

  const recentAdherence = adherence.finalActual;

  let eventType: EventType = "NO_TRAJECTORY_FAILURE";
  let severity: Severity = "none";
  let requiresHumanReview = false;

  const romBelowMilestone =
    (rom.gapPercent ?? 0) >= (plan.ruleThresholds?.romGapThreshold ?? 0.18);

  const romPlateau =
    rom.plateauDays >= (plan.ruleThresholds?.plateauDaysThreshold ?? 9);

  const highAdherence =
    recentAdherence !== null &&
    recentAdherence >= (plan.ruleThresholds?.adherenceMinimum ?? 0.8);

  const lowAdherence =
    recentAdherence !== null &&
    recentAdherence < (plan.ruleThresholds?.adherenceMinimum ?? 0.8);

  if (highAdherence) {
    reasonCodes.push("HIGH_ADHERENCE");
  }

  if (romBelowMilestone) {
    reasonCodes.push("ROM_BELOW_MILESTONE");
  }

  if (romPlateau) {
    reasonCodes.push("NINE_DAY_PLATEAU");
  }

  if (romBelowMilestone && romPlateau && highAdherence) {
    eventType = "TRAJECTORY_FAILURE_DETECTED";
    severity = "non_emergency";
    requiresHumanReview = true;

    explanations.push(
      "The patient is completing rehabilitation consistently, but range of motion remains below the expected milestone and has plateaued for 9 days."
    );
  } else if (lowAdherence && romBelowMilestone) {
    eventType = "LOW_ADHERENCE_BARRIER";
    severity = "non_emergency";
    requiresHumanReview = true;

    reasonCodes.push("LOW_ADHERENCE_MAY_EXPLAIN_LIMITED_PROGRESS");
    explanations.push(
      "Progress is below expected, but low adherence may be a major contributing barrier."
    );
  } else if ((pain.gapPercent ?? 0) > 0.30) {
    eventType = "PAIN_LIMITED_PROGRESS";
    severity = "non_emergency";
    requiresHumanReview = true;

    reasonCodes.push("PAIN_ABOVE_EXPECTED");
    explanations.push(
      "Pain is above the expected level and may be limiting rehabilitation progress."
    );
  } else if ((fatigue.gapPercent ?? 0) > 0.30) {
    eventType = "FATIGUE_LIMITED_PROGRESS";
    severity = "non_emergency";
    requiresHumanReview = true;

    reasonCodes.push("FATIGUE_ABOVE_EXPECTED");
    explanations.push(
      "Fatigue is above the expected level and may be limiting rehabilitation progress."
    );
  } else {
    explanations.push(
      "No non-emergency trajectory failure pattern was detected."
    );
  }

  return {
    eventType,
    severity,
    requiresHumanReview,
    emergencyThresholdBreach: false,
    reviewPriorityScore: baseReviewPriorityScore,
    reasonCodes,
    explanations,
    metricAnalyses,
    dataQuality,
    modelVersion: MODEL_VERSION,
    modelFamily: MODEL_FAMILY,
    generatedAt: new Date().toISOString()
  };
}
