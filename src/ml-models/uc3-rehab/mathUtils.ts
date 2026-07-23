export function round(value: number, digits = 2): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function linearSlope(values: number[]): number {
  if (values.length < 2) return 0;

  const n = values.length;
  const xs = Array.from({ length: n }, (_, i) => i);

  const xMean = mean(xs);
  const yMean = mean(values);

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (xs[i] - xMean) * (values[i] - yMean);
    denominator += Math.pow(xs[i] - xMean, 2);
  }

  if (denominator === 0) return 0;

  return numerator / denominator;
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}
