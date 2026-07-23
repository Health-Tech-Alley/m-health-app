import { linearSlope } from "./mathUtils";

export interface PlateauSettings {
  enabled: boolean;
  minDays: number;
  slopeThreshold: number | null;
  rangeThreshold: number | null;
}

export function getPlateauSettings(metricName: string): PlateauSettings {
  if (metricName === "romDegrees") {
    return {
      enabled: true,
      minDays: 9,
      slopeThreshold: 0.20,
      rangeThreshold: 5.0
    };
  }

  if (metricName === "adherence") {
    return {
      enabled: true,
      minDays: 9,
      slopeThreshold: 0.01,
      rangeThreshold: 0.08
    };
  }

  return {
    enabled: false,
    minDays: 9,
    slopeThreshold: null,
    rangeThreshold: null
  };
}

export function countPlateauDays(
  values: Array<number | null>,
  minDays: number,
  slopeThreshold: number,
  rangeThreshold: number
): number {
  const cleanValues = values.filter((v): v is number => v !== null && !Number.isNaN(v));

  if (cleanValues.length < minDays) return 0;

  for (let windowSize = cleanValues.length; windowSize >= minDays; windowSize--) {
    const recent = cleanValues.slice(cleanValues.length - windowSize);
    const slope = linearSlope(recent);
    const valueRange = Math.max(...recent) - Math.min(...recent);

    const slopeIsFlat = Math.abs(slope) <= slopeThreshold;
    const rangeIsFlat = valueRange <= rangeThreshold;

    if (slopeIsFlat || rangeIsFlat) {
      return windowSize;
    }
  }

  return 0;
}
