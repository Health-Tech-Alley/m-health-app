import {
  DailyRehabLog,
  MetricAnalysis,
  RehabMetricPlan,
  RehabPlan
} from "./types";
import { linearSlope, round } from "./mathUtils";
import { countPlateauDays, getPlateauSettings } from "./plateau";

export function getLogMetricValue(
  log: DailyRehabLog,
  metricName: string
): number | undefined {
  switch (metricName) {
    case "romDegrees":
      return log.romDegrees;
    case "exerciseReps":
      return log.exerciseReps;
    case "adherence":
      return log.adherence;
    case "painScore":
      return log.painScore;
    case "fatigueScore":
      return log.fatigueScore;
    case "walkingMinutes":
      return log.walkingMinutes;
    default:
      return undefined;
  }
}

function analyzeOneMetric(
  logs: DailyRehabLog[],
  metricPlan: RehabMetricPlan,
  recentWindow = 9
): MetricAnalysis {
  const validPairs: Array<{ day: number; actual: number; expected: number }> = [];

  for (const log of logs) {
    const value = getLogMetricValue(log, metricPlan.metricName);

    if (value === undefined || value === null || Number.isNaN(value)) continue;

    const dayIndex = log.dayIndex - 1;

    if (dayIndex < 0 || dayIndex >= metricPlan.expectedValues.length) continue;

    validPairs.push({
      day: log.dayIndex,
      actual: value,
      expected: metricPlan.expectedValues[dayIndex]
    });
  }

  if (validPairs.length === 0) {
    return {
      metricName: metricPlan.metricName,
      finalActual: null,
      finalExpected: null,
      gap: null,
      gapPercent: null,
      recentSlope: null,
      plateauDays: 0,
      dataPoints: 0
    };
  }

  const actualValues = validPairs.map((pair) => pair.actual);
  const expectedValues = validPairs.map((pair) => pair.expected);

  const finalActual = actualValues[actualValues.length - 1];
  const finalExpected = expectedValues[expectedValues.length - 1];

  let gap = metricPlan.higherIsBetter
    ? finalExpected - finalActual
    : finalActual - finalExpected;

  if (gap < 0) {
    gap = 0;
  }

  const gapPercent =
    finalExpected === 0 || !Number.isFinite(finalExpected)
      ? 0
      : gap / Math.abs(finalExpected);

  const recentValues = actualValues.slice(-recentWindow);
  const recentSlope = linearSlope(recentValues);

  const plateauSettings = getPlateauSettings(metricPlan.metricName);

  let plateauDays = 0;

  if (
    plateauSettings.enabled &&
    plateauSettings.slopeThreshold !== null &&
    plateauSettings.rangeThreshold !== null
  ) {
    plateauDays = countPlateauDays(
      recentValues,
      plateauSettings.minDays,
      plateauSettings.slopeThreshold,
      plateauSettings.rangeThreshold
    );
  }

  return {
    metricName: metricPlan.metricName,
    finalActual: round(finalActual, 2),
    finalExpected: round(finalExpected, 2),
    gap: round(gap, 2),
    gapPercent: round(gapPercent, 3),
    recentSlope: round(recentSlope, 3),
    plateauDays,
    dataPoints: actualValues.length
  };
}

export function analyzeMetricTrajectories(
  logs: DailyRehabLog[],
  plan: RehabPlan
): Record<string, MetricAnalysis> {
  const result: Record<string, MetricAnalysis> = {};

  for (const [metricName, metricPlan] of Object.entries(plan.metrics)) {
    result[metricName] = analyzeOneMetric(logs, metricPlan);
  }

  return result;
}
