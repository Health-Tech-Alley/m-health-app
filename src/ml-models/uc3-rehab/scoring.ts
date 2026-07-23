import { EHRRehabContext, MetricAnalysis } from "./types";
import { clamp, sigmoid, round } from "./mathUtils";

export function calculateReviewPriorityScore(
  metricAnalyses: Record<string, MetricAnalysis>,
  ehrContext: EHRRehabContext
): number {
  const rom = metricAnalyses.romDegrees;
  const adherence = metricAnalyses.adherence;
  const pain = metricAnalyses.painScore;
  const fatigue = metricAnalyses.fatigueScore;
  const walking = metricAnalyses.walkingMinutes;

  const romGap = Math.max(0, rom?.gapPercent ?? 0);
  const plateauDays = rom?.plateauDays ?? 0;
  const adherenceActual = adherence?.finalActual ?? 0;
  const painActual = pain?.finalActual ?? 0;
  const fatigueActual = fatigue?.finalActual ?? 0;
  const walkingGap = Math.max(0, walking?.gapPercent ?? 0);

  let z = -2.2;

  z += 7.5 * romGap;
  z += 0.32 * plateauDays;
  z += 2.0 * Math.max(0, adherenceActual - 0.80);
  z += 0.10 * Math.max(0, painActual - 3.0);
  z += 0.10 * Math.max(0, fatigueActual - 4.0);
  z += 1.2 * walkingGap;
  z += 0.12 * ehrContext.complexityScore;

  return round(clamp(sigmoid(z), 0, 1), 3);
}
