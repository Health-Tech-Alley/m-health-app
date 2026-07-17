import { DailyRehabLog, DataQualityReport, RehabPlan } from "./types";
import { round } from "./mathUtils";

export function evaluateDataQuality(
  logs: DailyRehabLog[],
  plan: RehabPlan
): DataQualityReport {
  const loggedDays = new Set(logs.map((log) => log.dayIndex));
  const missingDays: number[] = [];

  for (let day = 1; day <= plan.durationDays; day++) {
    if (!loggedDays.has(day)) {
      missingDays.push(day);
    }
  }

  const completenessRatio = logs.length / plan.durationDays;
  const warnings: string[] = [];

  const minimumDataPoints = plan.ruleThresholds?.insufficientDataMinimumDays ?? 7;

  if (logs.length < minimumDataPoints) {
    warnings.push("Insufficient data points for reliable trajectory assessment.");
  }

  if (completenessRatio < 0.70) {
    warnings.push("Home rehab logging completeness is below 70%.");
  }

  const missingAdherenceLogs = logs.filter(
    (log) => log.adherenceSource === "missing"
  );

  if (missingAdherenceLogs.length > 0) {
    warnings.push(
      `Found ${missingAdherenceLogs.length} days with missing adherence inputs.`
    );
  }

  return {
    totalExpectedDays: plan.durationDays,
    totalLoggedDays: logs.length,
    missingDays,
    completenessRatio: round(completenessRatio, 3),
    sufficientData: logs.length >= minimumDataPoints,
    warnings
  };
}
