import { RehabDecision, RehabPlan } from "./types";

export function buildCaregiverMessage(
  decision: RehabDecision,
  plan: RehabPlan
): string {
  const name = plan.patient.displayName;
  const caregiver = plan.patient.caregiverName;

  if (decision.eventType === "URGENT_SAFETY_ESCALATION") {
    return [
      `${caregiver}, ${name}\u2019s log includes a symptom that may need urgent attention.`,
      "Please follow your care team's emergency instructions or seek urgent medical help if symptoms are severe or worsening.",
      "This app cannot diagnose emergencies."
    ].join("\n");
  }

  if (decision.eventType === "TRAJECTORY_FAILURE_DETECTED") {
    return [
      `${caregiver}, ${name} has been doing rehabilitation consistently, which is important.`,
      "The app noticed that his range of motion has not improved as expected and appears to have plateaued for 9 days.",
      "This is not marked as an emergency, but a clinician should review the plan and decide whether changes are needed.",
      "Continue following the current care plan unless your clinician tells you otherwise."
    ].join("\n");
  }

  if (decision.eventType === "LOW_ADHERENCE_BARRIER") {
    return [
      `${caregiver}, the app noticed that some therapy activity may have been missed.`,
      "This can happen at home and does not mean anyone did something wrong.",
      "A clinician or care team member may help adjust the plan or identify barriers."
    ].join("\n");
  }

  if (decision.eventType === "INSUFFICIENT_DATA") {
    return [
      "There are not enough recent rehab logs to understand the trend.",
      "Please continue logging daily rehab activity when possible."
    ].join("\n");
  }

  return [
    `${name}\u2019s recent rehab logs do not show a trajectory failure pattern at this time.`,
    "Continue the current plan and keep logging daily progress."
  ].join("\n");
}

export function buildClinicianSummary(
  decision: RehabDecision,
  plan: RehabPlan
): string {
  const rom = decision.metricAnalyses.romDegrees;
  const adherence = decision.metricAnalyses.adherence;
  const pain = decision.metricAnalyses.painScore;
  const fatigue = decision.metricAnalyses.fatigueScore;
  const walking = decision.metricAnalyses.walkingMinutes;

  return [
    `ACCESS-DP UC3 Clinician Summary`,
    ``,
    `Patient: ${plan.patient.displayName}`,
    `Condition: ${plan.patient.condition}`,
    `Event type: ${decision.eventType}`,
    `Severity: ${decision.severity}`,
    `Requires human review: ${decision.requiresHumanReview}`,
    `Emergency threshold breach: ${decision.emergencyThresholdBreach}`,
    `Review priority score: ${decision.reviewPriorityScore}`,
    ``,
    `Key metric analysis:`,
    `- ROM: actual ${rom.finalActual}, expected ${rom.finalExpected}, gapPercent ${rom.gapPercent}, plateauDays ${rom.plateauDays}`,
    `- Adherence: actual ${adherence.finalActual}, expected ${adherence.finalExpected}`,
    `- Pain: actual ${pain.finalActual}, expected ${pain.finalExpected}, gapPercent ${pain.gapPercent}`,
    `- Fatigue: actual ${fatigue.finalActual}, expected ${fatigue.finalExpected}, gapPercent ${fatigue.gapPercent}`,
    `- Walking minutes: actual ${walking.finalActual}, expected ${walking.finalExpected}, gapPercent ${walking.gapPercent}`,
    ``,
    `Reason codes: ${decision.reasonCodes.join(", ")}`,
    ``,
    `Explanations:`,
    ...decision.explanations.map((item) => `- ${item}`)
  ].join("\n");
}
