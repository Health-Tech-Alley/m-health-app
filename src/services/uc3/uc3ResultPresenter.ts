import type {
  LatestUc3TrajectoryResultSummary,
  Uc3TrajectoryMetricAnalysisSummary,
} from '../../data/types';

export type Uc3ResultDisplay = {
  title: string;
  statusLabel: string;
  tone: 'none' | 'review' | 'urgent';
  generatedAtLabel: string | null;
  reviewLabel: string | null;
  explanation: string | null;
  detailLines: string[];
  dataQualityLabel: string | null;
};

const EVENT_LABELS: Record<string, string> = {
  NO_TRAJECTORY_FAILURE: 'Progress is on track',
  TRAJECTORY_FAILURE_DETECTED: 'Progress review recommended',
  ROM_PLATEAU_TRAJECTORY_FAILURE: 'Progress review recommended',
  LOW_ADHERENCE_BARRIER: 'Rehabilitation routine needs attention',
  PAIN_LIMITED_PROGRESS: 'Pain may be limiting progress',
  FATIGUE_LIMITED_PROGRESS: 'Fatigue may be limiting progress',
  DATA_QUALITY_WARNING: 'More information is needed',
  INSUFFICIENT_DATA: 'More information is needed',
  URGENT_SAFETY_ESCALATION: 'Urgent safety concern',
};

const METRIC_LABELS: Record<string, string> = {
  romDegrees: 'Range of motion',
  exerciseReps: 'Exercise repetitions',
  adherence: 'Exercise routine',
  painScore: 'Pain',
  fatigueScore: 'Fatigue',
  walkingMinutes: 'Walking',
};

function formatEventType(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.replace(/_/g, ' ').toLowerCase();
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function firstUsefulExplanation(explanations: string[]): string | null {
  return explanations.map((item) => item.trim()).find(Boolean) ?? null;
}

function metricLabel(metricName: string): string {
  return METRIC_LABELS[metricName] ?? metricName;
}

function formatMetricValue(value: number | null): string | null {
  if (value === null) return null;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function metricStatus(metric: Uc3TrajectoryMetricAnalysisSummary): string | null {
  if (metric.dataPoints <= 0) return null;
  const actual = formatMetricValue(metric.finalActual);
  const expected = formatMetricValue(metric.finalExpected);
  const label = metricLabel(metric.metricName);
  if (actual && expected) {
    return `${label}: ${metric.dataPoints} logged point(s), latest ${actual}, expected ${expected}.`;
  }
  return `${label}: ${metric.dataPoints} logged point(s).`;
}

function compactMetricLines(
  analyses: Record<string, Uc3TrajectoryMetricAnalysisSummary>,
): string[] {
  return Object.values(analyses)
    .map(metricStatus)
    .filter((line): line is string => Boolean(line))
    .slice(0, 3);
}

export function getUc3ResultDisplay(
  result: LatestUc3TrajectoryResultSummary | null,
): Uc3ResultDisplay {
  if (!result) {
    return {
      title: 'Rehabilitation progress',
      statusLabel: 'No progress evaluation has been generated yet.',
      tone: 'none',
      generatedAtLabel: null,
      reviewLabel: null,
      explanation: null,
      detailLines: [],
      dataQualityLabel: null,
    };
  }

  const detailLines = compactMetricLines(result.metricAnalyses);
  const dataQualityLabel = result.dataQuality.sufficientData
    ? `Data quality: ${result.dataQuality.totalLoggedDays}/${result.dataQuality.totalExpectedDays} days logged`
    : 'Data quality: more information is needed';

  return {
    title: 'Rehabilitation progress',
    statusLabel: formatEventType(result.eventType),
    tone:
      result.emergencyThresholdBreach || result.severity === 'urgent'
        ? 'urgent'
        : result.requiresHumanReview
          ? 'review'
          : 'none',
    generatedAtLabel: `Generated ${formatDateTime(result.generatedAt)}`,
    reviewLabel: result.requiresHumanReview ? 'Review needed' : null,
    explanation: firstUsefulExplanation(result.explanations),
    detailLines,
    dataQualityLabel,
  };
}
