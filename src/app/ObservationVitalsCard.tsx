import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";

import { AppTheme, Colors } from "@/constants/theme";
import type { HealthSampleType } from "@/data/types";
import { useAppSelector } from "@/store/hooks";
import type { NormalizedBloodPressurePair, NormalizedVitalMetric } from "@/store/reducers/patientSlice";

type RangeKey = "6m" | "1y" | "2y";

type RangeOption = {
  key: RangeKey;
  label: string;
  encounterCount: number;
};

type ChartPoint = {
  id: string;
  value: number;
  unit: string;
  recordedAt: string;
  label: string;
  clinicalTimeKey: string;
};

type ChartSeries = {
  key: string;
  label: string;
  color: string;
  unit: string;
  points: ChartPoint[];
};

type ChartModel = {
  start: Date;
  end: Date;
  series: ChartSeries[];
  points: ChartPoint[];
  timePoints: ChartTimePoint[];
  yMin: number;
  yMax: number;
  yLabels: number[];
  xLabels: { id: string; text: string; offset: number }[];
};

type ChartTimePoint = {
  key: string;
  recordedAt: string;
  index: number;
};

type VitalMetric = {
  key: HealthSampleType;
  tabIcon: string;
  label: string;
  value: string;
  unit: string;
  subtitle: string;
  helperText: string;
  observedAt?: string;
  series: ChartSeries[];
};

const CHART_HEIGHT = 112;
const POINT_SIZE = 14;
const CHART_HORIZONTAL_PADDING = 10;
const SOURCE_BADGE = "Imported from EHR";

const RANGE_OPTIONS: RangeOption[] = [
  { key: "6m", label: "6 months", encounterCount: 6 },
  { key: "1y", label: "1 year", encounterCount: 12 },
  { key: "2y", label: "2 years", encounterCount: 24 },
];

const VITAL_PRESENTATION: Record<string, Omit<VitalMetric, "value" | "unit" | "series">> = {
  blood_pressure_systolic: {
    key: "blood_pressure_systolic",
    tabIcon: "🩸",
    label: "Blood Pressure",
    subtitle: "Paired systolic and diastolic readings from the EHR",
    helperText: "Blood pressure shows systolic and diastolic pressure in millimeters of mercury.",
    observedAt: undefined,
  },
  heart_rate: {
    key: "heart_rate",
    tabIcon: "❤️",
    label: "Heart Rate",
    subtitle: "Heart-rate readings from the EHR",
    helperText: "Heart rate shows beats per minute compared with baseline.",
    observedAt: undefined,
  },
  temperature: {
    key: "temperature",
    tabIcon: "🌡️",
    label: "Body Temperature",
    subtitle: "Temperature readings from the EHR",
    helperText: "Body temperature shows the latest recorded temperature.",
    observedAt: undefined,
  },
  spo2: {
    key: "spo2",
    tabIcon: "🫁",
    label: "SpO2",
    subtitle: "Oxygen saturation readings from the EHR",
    helperText: "SpO2 estimates how much oxygen is in the blood.",
    observedAt: undefined,
  },
  respiratory_rate: {
    key: "respiratory_rate",
    tabIcon: "💨",
    label: "Respiratory Rate",
    subtitle: "Respiratory readings from the EHR",
    helperText: "Respiratory rate counts breaths per minute.",
    observedAt: undefined,
  },
};

export function ObservationVitalsCard() {
  const router = useRouter();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const clinicalVitals = useAppSelector((state) => state.patient.clinicalVitals);
  const chartMetrics = useMemo(
    () => clinicalVitals.map(toVitalMetric).filter(isVitalMetric),
    [clinicalVitals],
  );
  const [selectedKey, setSelectedKey] = useState<HealthSampleType>("blood_pressure_systolic");
  const [selectedRange, setSelectedRange] = useState<RangeKey>("6m");

  const selectedMetric =
    chartMetrics.find((metric) => metric.key === selectedKey) ?? chartMetrics[0];
  const selectedRangeOption = RANGE_OPTIONS.find((range) => range.key === selectedRange) ?? RANGE_OPTIONS[0];
  const chart = useMemo(
    () => (selectedMetric ? buildChartModel(selectedMetric, selectedRangeOption) : null),
    [selectedMetric, selectedRangeOption],
  );

  if (chartMetrics.length === 0 || !selectedMetric || !chart) {
    return (
      <View style={[styles.card, isDark && styles.cardDark]}>
        <View style={styles.titleRow}>
          <Text style={styles.sectionTitle}>Observation Baseline</Text>
          <Text style={styles.sourceBadge}>{SOURCE_BADGE}</Text>
        </View>
        <Text style={styles.emptyTitle}>No observations available</Text>
        <Text style={styles.emptyText}>
          Import the latest EHR from Settings to add observations and vitals.
        </Text>
        <Pressable
          style={styles.importButton}
          onPress={() => router.push({ pathname: "/(tabs)/more", params: { focus: "ehr-import" } } as never)}
        >
          <Text style={styles.importButtonText}>Import from Settings</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.card, isDark && styles.cardDark]}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Text style={styles.sectionTitle}>Baseline Vitals</Text>
          <Text style={styles.sourceBadge}>{SOURCE_BADGE}</Text>
        </View>
        <Text style={styles.subtitle}>{selectedMetric.subtitle}</Text>
      </View>

      <View style={styles.tabRow}>
        {chartMetrics.map((metric) => {
          const active = metric.key === selectedMetric.key;

          return (
            <Pressable
              key={metric.key}
              style={[styles.tab, active && styles.tabActive]}
              accessibilityRole="button"
              accessibilityLabel={metric.label}
              accessibilityHint={`Show ${metric.label} observations`}
              accessibilityState={{ selected: active }}
              onPress={() => setSelectedKey(metric.key)}
            >
              <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{metric.tabIcon}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.metricHelperText}>{selectedMetric.helperText}</Text>

      <View style={styles.rangeRow}>
        {RANGE_OPTIONS.map((range) => {
          const active = selectedRange === range.key;
          return (
            <Pressable
              key={range.key}
              style={[styles.rangePill, active && styles.rangePillActive]}
              accessibilityRole="button"
              accessibilityLabel={`Show ${range.label}`}
              onPress={() => setSelectedRange(range.key)}
            >
              <Text style={[styles.rangePillText, active && styles.rangePillTextActive]}>
                {range.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TrendChart chart={chart} />

      <Text style={styles.summaryText}>{formatAverageSummary(selectedMetric, chart)}</Text>
    </View>
  );
}

function toVitalMetric(metric: NormalizedVitalMetric): VitalMetric | null {
  const presentation = VITAL_PRESENTATION[metric.key];
  if (!presentation) return null;

  const series =
    metric.key === "blood_pressure_systolic"
      ? buildBloodPressureSeries(metric.bloodPressureReadings ?? [])
      : [buildSingleValueSeries(metric)];

  const hasPoints = series.some((item) => item.points.length > 0);
  if (!hasPoints) return null;

  return {
    ...presentation,
    value: metric.value || "Not available",
    unit: metric.unit,
    observedAt: metric.recordedAt,
    series,
  };
}

function buildSingleValueSeries(metric: NormalizedVitalMetric): ChartSeries {
  return {
    key: metric.key,
    label: metric.label,
    color: "#0F766E",
    unit: metric.unit,
    points: metric.readings
      .map((reading) => ({
        id: reading.sampleId,
        value: reading.value,
        unit: reading.unit || metric.unit,
        recordedAt: reading.recordedAt,
        label: metric.label,
        clinicalTimeKey: reading.sampleId,
        source: reading.source,
      }))
      .filter(isFhirPoint)
      .filter(hasValidPointDate)
      .sort(sortPointsOldestFirst),
  };
}

function buildBloodPressureSeries(readings: NormalizedBloodPressurePair[]): ChartSeries[] {
  const systolic: ChartPoint[] = [];
  const diastolic: ChartPoint[] = [];

  for (const [index, reading] of readings.entries()) {
    if (!reading.recordedAt) continue;
    if (!isFhirSource(reading.source)) continue;
    const clinicalTimeKey = getBloodPressureClinicalTimeKey(reading, index);
    if (reading.systolic != null) {
      systolic.push({
        id: reading.systolicSampleId ?? `systolic-${reading.recordedAt}`,
        value: reading.systolic,
        unit: reading.unit,
        recordedAt: reading.recordedAt,
        label: "Systolic",
        clinicalTimeKey,
      });
    }
    if (reading.diastolic != null) {
      diastolic.push({
        id: reading.diastolicSampleId ?? `diastolic-${reading.recordedAt}`,
        value: reading.diastolic,
        unit: reading.unit,
        recordedAt: reading.recordedAt,
        label: "Diastolic",
        clinicalTimeKey,
      });
    }
  }

  return [
    {
      key: "blood_pressure_systolic",
      label: "Systolic",
      color: "#0F766E",
      unit: "mmHg",
      points: systolic.filter(hasValidPointDate).sort(sortPointsOldestFirst),
    },
    {
      key: "blood_pressure_diastolic",
      label: "Diastolic",
      color: "#2563EB",
      unit: "mmHg",
      points: diastolic.filter(hasValidPointDate).sort(sortPointsOldestFirst),
    },
  ];
}

function buildChartModel(metric: VitalMetric, range: RangeOption): ChartModel {
  const allPoints = metric.series.flatMap((series) => series.points);
  const clinicalTimePoints = buildClinicalTimePoints(allPoints);
  const selectedTimePoints = clinicalTimePoints
    .slice(-range.encounterCount)
    .map((point, index) => ({ ...point, index }));
  const selectedTimeSet = new Set(selectedTimePoints.map((point) => point.key));
  const selectedTimeIndex = new Map(
    selectedTimePoints.map((point) => [point.key, point.index]),
  );
  const start = new Date(selectedTimePoints[0]?.recordedAt);
  const end = new Date(selectedTimePoints[selectedTimePoints.length - 1]?.recordedAt);
  const visibleSeries = metric.series
    .map((series) => ({
      ...series,
      points: series.points
        .filter((point) => selectedTimeSet.has(point.clinicalTimeKey))
        .sort((a, b) => {
          const aIndex = selectedTimeIndex.get(a.clinicalTimeKey) ?? 0;
          const bIndex = selectedTimeIndex.get(b.clinicalTimeKey) ?? 0;
          return aIndex - bIndex || sortPointsOldestFirst(a, b) || a.id.localeCompare(b.id);
        }),
    }))
    .filter((series) => series.points.length > 0);
  const visiblePoints = visibleSeries.flatMap((series) => series.points);

  if (visiblePoints.length === 0) {
    return {
      start,
      end,
      series: [],
      points: [],
      timePoints: [],
      yMin: 0,
      yMax: 1,
      yLabels: [],
      xLabels: [],
    };
  }

  const values = visiblePoints.map((point) => point.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawRange = Math.max(rawMax - rawMin, 0);
  const padding = Math.max(rawRange * 0.2, Math.abs(rawMax) * 0.03, 1);
  const capMax = metric.key === "spo2" ? 100 : Number.POSITIVE_INFINITY;
  const yMin = Math.max(0, rawMin - padding);
  let yMax = Math.min(capMax, rawMax + padding);
  if (yMax <= yMin) yMax = Math.min(capMax, yMin + Math.max(rawRange, 1));

  return {
    start,
    end,
    series: visibleSeries,
    points: visiblePoints,
    timePoints: selectedTimePoints,
    yMin,
    yMax,
    yLabels: [yMax, (yMax + yMin) / 2, yMin],
    xLabels: getXAxisLabels(selectedTimePoints),
  };
}

function TrendChart({ chart }: { chart: ChartModel }) {
  const [chartWidth, setChartWidth] = useState(0);
  const [selectedPoint, setSelectedPoint] = useState<ChartPoint | null>(null);

  if (chart.points.length === 0) {
    return (
      <View style={styles.noRangeData}>
        <Text style={styles.noRangeTitle}>No readings in this range</Text>
        <Text style={styles.noRangeText}>Try a longer range or import a newer EHR record.</Text>
      </View>
    );
  }

  const valueRange = Math.max(chart.yMax - chart.yMin, 1);
  const timePointIndexByKey = new Map(
    chart.timePoints.map((point) => [point.key, point.index]),
  );

  return (
    <View>
      {selectedPoint ? (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipValue}>
            {selectedPoint.label}: {formatValue(selectedPoint.value)} {selectedPoint.unit}
          </Text>
          <Text style={styles.tooltipDate}>{formatObservationDate(selectedPoint.recordedAt)}</Text>
        </View>
      ) : null}

      <View style={styles.chartWrap}>
        <View style={styles.yAxis}>
          {chart.yLabels.map((label) => (
            <Text key={label} style={styles.axisLabel}>
              {formatAxisValue(label)}
            </Text>
          ))}
        </View>

        <View style={styles.chartArea}>
          <View
            style={styles.plotArea}
            onLayout={(event) => {
              setChartWidth(event.nativeEvent.layout.width);
            }}
          >
            {chartWidth > 0
              ? chart.series.map((series) => (
                  <ChartSeriesLayer
                    key={series.key}
                    series={series}
                    chartWidth={chartWidth}
                    yMin={chart.yMin}
                    valueRange={valueRange}
                    timePointCount={chart.timePoints.length}
                    timePointIndexByKey={timePointIndexByKey}
                    onSelectPoint={setSelectedPoint}
                  />
                ))
              : null}
          </View>

          <View style={styles.xAxisRow}>
            {chart.xLabels.map((label) => (
              <Text key={label.id} style={[styles.dayLabel, { left: `${label.offset}%` }]}>
                {label.text}
              </Text>
            ))}
          </View>
        </View>
      </View>

      {chart.series.length > 1 ? (
        <View style={styles.legendRow}>
          {chart.series.map((series) => (
            <View key={series.key} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: series.color }]} />
              <Text style={styles.legendText}>{series.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ChartSeriesLayer({
  series,
  chartWidth,
  yMin,
  valueRange,
  timePointCount,
  timePointIndexByKey,
  onSelectPoint,
}: {
  series: ChartSeries;
  chartWidth: number;
  yMin: number;
  valueRange: number;
  timePointCount: number;
  timePointIndexByKey: Map<string, number>;
  onSelectPoint: (point: ChartPoint) => void;
}) {
  const points = series.points.map((point) => {
    const timePointIndex = timePointIndexByKey.get(point.clinicalTimeKey) ?? 0;
    const x = getClinicalPointX(timePointIndex, timePointCount, chartWidth);
    const normalized = (point.value - yMin) / valueRange;
    const y = CHART_HEIGHT - normalized * (CHART_HEIGHT - 14) - 7;
    return { ...point, x, y };
  });

  return (
    <>
      {points.map((point, index) => {
        if (index === points.length - 1) return null;
        const next = points[index + 1];
        const dx = next.x - point.x;
        const dy = next.y - point.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        return (
          <View
            key={`segment-${series.key}-${point.clinicalTimeKey}-${point.id}-${next.clinicalTimeKey}-${next.id}-${index}`}
            style={[
              styles.lineSegment,
              {
                width: length,
                left: point.x,
                top: point.y,
                backgroundColor: series.color,
                transform: [{ rotate: `${angle}rad` }],
              },
            ]}
          />
        );
      })}

      {points.map((point) => (
        <Pressable
          key={`point-${series.key}-${point.clinicalTimeKey}-${point.id}`}
          accessibilityRole="button"
          accessibilityLabel={`${point.label} ${formatValue(point.value)} ${point.unit} observed ${formatObservationDate(point.recordedAt)}`}
          onPress={() => onSelectPoint(point)}
          style={[
            styles.point,
            {
              left: point.x - POINT_SIZE / 2,
              top: point.y - POINT_SIZE / 2,
              backgroundColor: series.color,
            },
          ]}
        />
      ))}
    </>
  );
}

function getBloodPressureClinicalTimeKey(
  reading: NormalizedBloodPressurePair,
  index: number,
) {
  const systolicBase = reading.systolicSampleId?.replace(/-systolic$/, "");
  const diastolicBase = reading.diastolicSampleId?.replace(/-diastolic$/, "");
  if (systolicBase && diastolicBase && systolicBase === diastolicBase) {
    return `bp-${systolicBase}`;
  }

  return [
    "bp",
    reading.recordedAt ?? "unknown-time",
    reading.systolicSampleId ?? "missing-systolic",
    reading.diastolicSampleId ?? "missing-diastolic",
    index,
  ].join("-");
}

function buildClinicalTimePoints(points: ChartPoint[]): ChartTimePoint[] {
  const byKey = new Map<string, Omit<ChartTimePoint, "index">>();
  for (const point of points) {
    const existing = byKey.get(point.clinicalTimeKey);
    if (!existing || compareRecordedAt(point.recordedAt, existing.recordedAt) < 0) {
      byKey.set(point.clinicalTimeKey, {
        key: point.clinicalTimeKey,
        recordedAt: point.recordedAt,
      });
    }
  }

  return [...byKey.values()]
    .sort((a, b) => compareRecordedAt(a.recordedAt, b.recordedAt) || a.key.localeCompare(b.key))
    .map((point, index) => ({ ...point, index }));
}

function getClinicalPointX(index: number, total: number, chartWidth: number) {
  if (total <= 1) return chartWidth / 2;
  const plotWidth = Math.max(chartWidth - CHART_HORIZONTAL_PADDING * 2, 1);
  return CHART_HORIZONTAL_PADDING + (index / (total - 1)) * plotWidth;
}

function getXAxisLabels(timePoints: ChartTimePoint[]) {
  if (timePoints.length === 0) return [];
  const start = new Date(timePoints[0].recordedAt);
  const end = new Date(timePoints[timePoints.length - 1].recordedAt);
  const spanDays = Math.max((end.getTime() - start.getTime()) / 86400000, 1);
  const labelPoints = getAxisLabelTimePoints(timePoints, 3);

  return labelPoints.map((point, index) => ({
    id: `${point.key}-${index}`,
    text: formatAxisDate(new Date(point.recordedAt), spanDays),
    offset: getClinicalLabelOffset(point.index, timePoints.length),
  }));
}

function getAxisLabelTimePoints(timePoints: ChartTimePoint[], count: number) {
  if (timePoints.length <= count) return timePoints;
  const lastIndex = timePoints.length - 1;
  return Array.from({ length: count }, (_, index) => {
    const pointIndex = Math.round((index / Math.max(count - 1, 1)) * lastIndex);
    return timePoints[pointIndex];
  });
}

function getClinicalLabelOffset(index: number, total: number) {
  if (total <= 1) return 50;
  const labelStart = CHART_HORIZONTAL_PADDING;
  const labelSpan = Math.max(100 - CHART_HORIZONTAL_PADDING * 2, 1);
  return Math.min(Math.max(labelStart + (index / (total - 1)) * labelSpan, 0), 92);
}

function formatAxisDate(date: Date, spanDays: number) {
  if (spanDays > 540) {
    return date.toLocaleDateString(undefined, { year: "numeric" });
  }
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function formatAverageSummary(metric: VitalMetric, chart: ChartModel) {
  if (chart.points.length === 0) return "Average: Not available";
  if (metric.key === "blood_pressure_systolic") {
    const systolic = chart.series.find((series) => series.key === "blood_pressure_systolic");
    const diastolic = chart.series.find((series) => series.key === "blood_pressure_diastolic");
    const systolicAverage = getAverage(systolic?.points ?? []);
    const diastolicAverage = getAverage(diastolic?.points ?? []);
    if (systolicAverage == null || diastolicAverage == null) {
      return "Average: Not available";
    }
    return `Average: ${formatValue(systolicAverage)}/${formatValue(diastolicAverage)} mmHg`;
  }

  const average = getAverage(chart.points);
  const unit = chart.points[0]?.unit ?? metric.unit;
  return average == null
    ? "Average: Not available"
    : `Average: ${formatValue(average)}${unit === "%" ? "%" : ` ${unit}`}`;
}

function getAverage(points: ChartPoint[]) {
  if (points.length === 0) return null;
  return points.reduce((total, point) => total + point.value, 0) / points.length;
}

function hasValidPointDate(point: ChartPoint) {
  return Number.isFinite(new Date(point.recordedAt).getTime());
}

function isFhirPoint(point: ChartPoint & { source?: string }) {
  return isFhirSource(point.source);
}

function isFhirSource(source?: string) {
  return source === "fhir";
}

function sortPointsOldestFirst(a: ChartPoint, b: ChartPoint) {
  return compareRecordedAt(a.recordedAt, b.recordedAt);
}

function compareRecordedAt(a: string, b: string) {
  return new Date(a).getTime() - new Date(b).getTime();
}

function isVitalMetric(metric: VitalMetric | null): metric is VitalMetric {
  return metric !== null;
}

function formatObservationDate(value?: string) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatAxisValue(value: number) {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return String(rounded);
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 18,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  cardDark: {
    backgroundColor: Colors.dark.backgroundElement,
    borderColor: Colors.dark.backgroundSelected,
  },
  headerRow: {
    marginBottom: 14,
  },
  titleRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: {
    color: AppTheme.colors.sectionText,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  subtitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 15,
    fontWeight: "700",
  },
  sourceBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#E0F2FE",
    borderRadius: AppTheme.radius.pill,
    color: "#0369A1",
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  emptyTitle: {
    color: AppTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 8,
  },
  emptyText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: 6,
  },
  importButton: {
    alignSelf: "flex-start",
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 11,
    marginTop: 14,
  },
  importButtonText: {
    color: AppTheme.colors.white,
    fontSize: 14,
    fontWeight: "900",
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
  },
  tab: {
    flex: 1,
    minHeight: 58,
    borderRadius: 10,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 10,
  },
  tabActive: {
    backgroundColor: "#0F766E",
  },
  tabIcon: {
    color: AppTheme.colors.textSoft,
    fontSize: 30,
    fontWeight: "900",
    textAlign: "center",
  },
  tabIconActive: {
    color: AppTheme.colors.white,
  },
  metricHelperText: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: 10,
  },
  rangeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
    marginBottom: 14,
  },
  rangePill: {
    borderRadius: AppTheme.radius.pill,
    backgroundColor: "#E2E8F0",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  rangePillActive: {
    backgroundColor: "#CCFBF1",
  },
  rangePillText: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "900",
  },
  rangePillTextActive: {
    color: "#0F766E",
  },
  summaryText: {
    color: "#0F172A",
    fontSize: 13,
    fontWeight: "900",
    marginLeft: 42,
    marginTop: 10,
  },
  chartWrap: {
    flexDirection: "row",
    minHeight: 142,
  },
  yAxis: {
    width: 42,
    height: CHART_HEIGHT,
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingRight: 8,
  },
  axisLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  chartArea: {
    flex: 1,
    minHeight: 142,
  },
  plotArea: {
    height: CHART_HEIGHT,
    position: "relative",
  },
  lineSegment: {
    position: "absolute",
    height: 3,
    borderRadius: 999,
    transformOrigin: "left center",
  },
  point: {
    position: "absolute",
    width: POINT_SIZE,
    height: POINT_SIZE,
    borderRadius: POINT_SIZE / 2,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  xAxisRow: {
    marginTop: 12,
    minHeight: 18,
    position: "relative",
  },
  dayLabel: {
    position: "absolute",
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 8,
    marginLeft: 42,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  legendText: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "800",
  },
  tooltip: {
    alignSelf: "flex-start",
    backgroundColor: "#0F172A",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  tooltipValue: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  tooltipDate: {
    color: "#CBD5E1",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  noRangeData: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 14,
  },
  noRangeTitle: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "900",
  },
  noRangeText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
});
