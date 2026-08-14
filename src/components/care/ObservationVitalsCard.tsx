import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme, Colors } from "@/constants/theme";
import { useSensor } from "@/contexts/sensor-context";
import { ALL_HEALTHKIT_READ_TYPES } from "@/data/sensors/healthkit-type-map";
import type {
  HealthSampleType,
  NormalizedBloodPressurePair,
  NormalizedVitalMetric,
} from "@/data/types";
import { useClinicalVitals } from "@/hooks/useActivePatientView";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/hooks/use-translation";
import type { AppLocale, TranslateFn } from "@/localization/i18n";

type RangeKey = "6m" | "1y" | "2y";

type RangeOption = {
  key: RangeKey;
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

const RANGE_OPTIONS: RangeOption[] = [
  { key: "6m", encounterCount: 6 },
  { key: "1y", encounterCount: 12 },
  { key: "2y", encounterCount: 24 },
];

function rangeLabel(key: RangeKey, t: TranslateFn): string {
  switch (key) {
    case "6m":
      return t("care.vitals.range.6m");
    case "1y":
      return t("care.vitals.range.1y");
    case "2y":
      return t("care.vitals.range.2y");
  }
}

function vitalPresentation(
  key: string,
  t: TranslateFn,
): Omit<VitalMetric, "value" | "unit" | "series"> | null {
  switch (key) {
    case "blood_pressure_systolic":
      return {
        key,
        tabIcon: "🩸",
        label: t("care.vitals.metric.bloodPressure.label"),
        subtitle: t("care.vitals.metric.bloodPressure.subtitle"),
        helperText: t("care.vitals.metric.bloodPressure.helper"),
        observedAt: undefined,
      };
    case "heart_rate":
      return {
        key,
        tabIcon: "❤️",
        label: t("care.vitals.metric.heartRate.label"),
        subtitle: t("care.vitals.metric.heartRate.subtitle"),
        helperText: t("care.vitals.metric.heartRate.helper"),
        observedAt: undefined,
      };
    case "temperature":
      return {
        key,
        tabIcon: "🌡️",
        label: t("care.vitals.metric.temperature.label"),
        subtitle: t("care.vitals.metric.temperature.subtitle"),
        helperText: t("care.vitals.metric.temperature.helper"),
        observedAt: undefined,
      };
    case "spo2":
      return {
        key,
        tabIcon: "🫁",
        label: t("care.vitals.metric.spo2.label"),
        subtitle: t("care.vitals.metric.spo2.subtitle"),
        helperText: t("care.vitals.metric.spo2.helper"),
        observedAt: undefined,
      };
    case "respiratory_rate":
      return {
        key,
        tabIcon: "💨",
        label: t("care.vitals.metric.respiratoryRate.label"),
        subtitle: t("care.vitals.metric.respiratoryRate.subtitle"),
        helperText: t("care.vitals.metric.respiratoryRate.helper"),
        observedAt: undefined,
      };
    default:
      return null;
  }
}

type ThemeTokens = ReturnType<typeof useTheme>;

/**
 * Dark-theme overlay (dark is the app default). Light stays on the static
 * styles below; the overlay only swaps colors that would otherwise render
 * cream/navy on a dark Care tab.
 */
function createThemedStyles(theme: ThemeTokens) {
  const isDark = theme.appBackground === "#000000";
  if (!isDark) return {};
  return {
    sectionTitle: { color: theme.appSectionText },
    subtitle: { color: theme.appTextMuted },
    sourceBadge: { backgroundColor: "rgba(56,189,248,0.18)", color: "#7DD3FC" },
    emptyTitle: { color: theme.appText },
    emptyText: { color: theme.appTextSupporting },
    importButton: { backgroundColor: theme.appBrandSoftSurface },
    importButtonText: { color: AppTheme.colors.brandPale },
    tab: { backgroundColor: theme.appControlSurface },
    tabActive: { backgroundColor: AppTheme.colors.brand },
    tabIcon: { color: theme.appTextSupporting },
    metricHelperText: { color: theme.appTextMuted },
    rangePill: { backgroundColor: theme.appControlSurface },
    rangePillActive: { backgroundColor: theme.appBrandSoftSurface },
    rangePillText: { color: theme.appTextSupporting },
    rangePillTextActive: { color: AppTheme.colors.brandPale },
    summaryText: { color: theme.appText },
    axisLabel: { color: theme.appTextMuted },
    dayLabel: { color: theme.appTextMuted },
    legendText: { color: theme.appTextSupporting },
    point: { borderColor: theme.appSurface },
    noRangeData: { borderColor: theme.appBorder, backgroundColor: theme.appControlSurface },
    noRangeTitle: { color: theme.appText },
    noRangeText: { color: theme.appTextSupporting },
    syncButtonDark: { backgroundColor: theme.appBrandSoftSurface },
    syncButtonTextDark: { color: AppTheme.colors.brandPale },
  };
}

export function ObservationVitalsCard() {
  const router = useRouter();
  const { locale, t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.appBackground === "#000000";
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const { sensor, isRealHealth } = useSensor();
  const clinicalVitals = useClinicalVitals();
  const chartMetrics = useMemo(
    () => clinicalVitals.map((metric) => toVitalMetric(metric, t)).filter(isVitalMetric),
    [clinicalVitals, t],
  );
  const [selectedKey, setSelectedKey] = useState<HealthSampleType>("blood_pressure_systolic");
  const [selectedRange, setSelectedRange] = useState<RangeKey>("6m");
  const [syncing, setSyncing] = useState(false);

  // Manual "Sync now": force an incremental HealthKit pull through the active
  // sensor source (no sync-behavior changes — same anchored pull the 1-minute
  // foreground poll performs). Mock/no-sensor builds no-op.
  const handleSyncNow = useCallback(async () => {
    if (!sensor || syncing) return;
    setSyncing(true);
    try {
      const hk = sensor as { incrementalSync?: (type: HealthSampleType) => Promise<unknown> };
      for (const type of ALL_HEALTHKIT_READ_TYPES) {
        await hk.incrementalSync?.(type);
      }
    } finally {
      setSyncing(false);
    }
  }, [sensor, syncing]);

  const selectedMetric =
    chartMetrics.find((metric) => metric.key === selectedKey) ?? chartMetrics[0];
  const selectedRangeOption = RANGE_OPTIONS.find((range) => range.key === selectedRange) ?? RANGE_OPTIONS[0];
  const chart = useMemo(
    () => (selectedMetric ? buildChartModel(selectedMetric, selectedRangeOption, locale) : null),
    [locale, selectedMetric, selectedRangeOption],
  );

  if (chartMetrics.length === 0 || !selectedMetric || !chart) {
    return (
      <View style={[styles.card, isDark && styles.cardDark]}>
        <View style={styles.titleRow}>
          <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>{t("care.vitals.title")}</Text>
          <Text style={[styles.sourceBadge, themedStyles.sourceBadge]}>{t("care.vitals.sourceBadge")}</Text>
        </View>
        <Text style={[styles.emptyTitle, themedStyles.emptyTitle]}>{t("care.vitals.emptyTitle")}</Text>
        <Text style={[styles.emptyText, themedStyles.emptyText]}>{t("care.vitals.emptyBody")}</Text>
        <Pressable
          style={[styles.importButton, themedStyles.importButton]}
          onPress={() => router.push({ pathname: "/more", params: { focus: "ehr-import" } } as never)}
        >
          <Text style={[styles.importButtonText, themedStyles.importButtonText]}>{t("care.vitals.import")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.card, isDark && styles.cardDark]}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>{t("care.vitals.title")}</Text>
          <Text style={[styles.sourceBadge, themedStyles.sourceBadge]}>{t("care.vitals.sourceBadge")}</Text>
        </View>
        <View style={styles.headerActions}>
          {isRealHealth ? (
            <Pressable
              style={[
                styles.syncButton,
                themedStyles.syncButtonDark,
                syncing && styles.syncButtonDisabled,
              ]}
              onPress={() => void handleSyncNow()}
              disabled={syncing}
              accessibilityRole="button"
              accessibilityLabel={t("care.vitals.syncA11y")}
            >
              <Text style={[styles.syncButtonText, themedStyles.syncButtonTextDark]}>
                {syncing ? t("care.vitals.syncing") : t("care.vitals.syncNow")}
              </Text>
            </Pressable>
          ) : null}
          <Text style={[styles.subtitle, themedStyles.subtitle]}>{selectedMetric.subtitle}</Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        {chartMetrics.map((metric) => {
          const active = metric.key === selectedMetric.key;

          return (
            <Pressable
              key={metric.key}
              style={[styles.tab, themedStyles.tab, active && styles.tabActive, active && themedStyles.tabActive]}
              accessibilityRole="button"
              accessibilityLabel={metric.label}
              accessibilityHint={t("care.vitals.showObservationsA11y", { label: metric.label })}
              accessibilityState={{ selected: active }}
              onPress={() => setSelectedKey(metric.key)}
            >
              <Text style={[styles.tabIcon, themedStyles.tabIcon, active && styles.tabIconActive]}>{metric.tabIcon}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.metricHelperText, themedStyles.metricHelperText]}>{selectedMetric.helperText}</Text>

      <View style={styles.rangeRow}>
        {RANGE_OPTIONS.map((range) => {
          const active = selectedRange === range.key;
          const label = rangeLabel(range.key, t);
          return (
            <Pressable
              key={range.key}
              style={[styles.rangePill, themedStyles.rangePill, active && styles.rangePillActive, active && themedStyles.rangePillActive]}
              accessibilityRole="button"
              accessibilityLabel={t("care.vitals.showRangeA11y", { label })}
              onPress={() => setSelectedRange(range.key)}
            >
              <Text style={[styles.rangePillText, themedStyles.rangePillText, active && styles.rangePillTextActive, active && themedStyles.rangePillTextActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TrendChart chart={chart} locale={locale} t={t} />

      <Text style={[styles.summaryText, themedStyles.summaryText]}>{formatAverageSummary(selectedMetric, chart, t)}</Text>
    </View>
  );
}

function toVitalMetric(metric: NormalizedVitalMetric, t: TranslateFn): VitalMetric | null {
  const presentation = vitalPresentation(metric.key, t);
  if (!presentation) return null;

  const series =
    metric.key === "blood_pressure_systolic"
      ? buildBloodPressureSeries(metric.bloodPressureReadings ?? [], t)
      : [buildSingleValueSeries(metric, t)];

  const hasPoints = series.some((item) => item.points.length > 0);
  if (!hasPoints) return null;

  return {
    ...presentation,
    value: metric.value || t("common.notProvided"),
    unit: metric.unit,
    observedAt: metric.recordedAt,
    series,
  };
}

function buildSingleValueSeries(metric: NormalizedVitalMetric, t: TranslateFn): ChartSeries {
  const presentation = vitalPresentation(metric.key, t);
  const label = presentation?.label ?? metric.label;
  return {
    key: metric.key,
    label,
    color: "#0F766E",
    unit: metric.unit,
    points: metric.readings
      .map((reading) => ({
        id: reading.sampleId,
        value: reading.value,
        unit: reading.unit || metric.unit,
        recordedAt: reading.recordedAt,
        label,
        clinicalTimeKey: reading.sampleId,
        source: reading.source,
      }))
      .filter(isFhirPoint)
      .filter(hasValidPointDate)
      .sort(sortPointsOldestFirst),
  };
}

function buildBloodPressureSeries(readings: NormalizedBloodPressurePair[], t: TranslateFn): ChartSeries[] {
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
        label: t("care.vitals.series.systolic"),
        clinicalTimeKey,
      });
    }
    if (reading.diastolic != null) {
      diastolic.push({
        id: reading.diastolicSampleId ?? `diastolic-${reading.recordedAt}`,
        value: reading.diastolic,
        unit: reading.unit,
        recordedAt: reading.recordedAt,
        label: t("care.vitals.series.diastolic"),
        clinicalTimeKey,
      });
    }
  }

  return [
    {
      key: "blood_pressure_systolic",
      label: t("care.vitals.series.systolic"),
      color: "#0F766E",
      unit: "mmHg",
      points: systolic.filter(hasValidPointDate).sort(sortPointsOldestFirst),
    },
    {
      key: "blood_pressure_diastolic",
      label: t("care.vitals.series.diastolic"),
      color: "#2563EB",
      unit: "mmHg",
      points: diastolic.filter(hasValidPointDate).sort(sortPointsOldestFirst),
    },
  ];
}

function buildChartModel(metric: VitalMetric, range: RangeOption, locale: AppLocale): ChartModel {
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
    xLabels: getXAxisLabels(selectedTimePoints, locale),
  };
}

function TrendChart({ chart, locale, t }: { chart: ChartModel; locale: AppLocale; t: TranslateFn }) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const [chartWidth, setChartWidth] = useState(0);
  const [selectedPoint, setSelectedPoint] = useState<ChartPoint | null>(null);

  if (chart.points.length === 0) {
    return (
      <View style={[styles.noRangeData, themedStyles.noRangeData]}>
        <Text style={[styles.noRangeTitle, themedStyles.noRangeTitle]}>{t("care.vitals.noRangeTitle")}</Text>
        <Text style={[styles.noRangeText, themedStyles.noRangeText]}>{t("care.vitals.noRangeBody")}</Text>
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
          <Text style={styles.tooltipDate}>{formatObservationDate(selectedPoint.recordedAt, locale, t)}</Text>
        </View>
      ) : null}

      <View style={styles.chartWrap}>
        <View style={styles.yAxis}>
          {chart.yLabels.map((label) => (
            <Text key={label} style={[styles.axisLabel, themedStyles.axisLabel]}>
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
                    locale={locale}
                    t={t}
                    themedStyles={themedStyles}
                  />
                ))
              : null}
          </View>

          <View style={styles.xAxisRow}>
            {chart.xLabels.map((label) => (
              <Text key={label.id} style={[styles.dayLabel, themedStyles.dayLabel, { left: `${label.offset}%` }]}>
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
              <Text style={[styles.legendText, themedStyles.legendText]}>{series.label}</Text>
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
  locale,
  t,
  themedStyles,
}: {
  series: ChartSeries;
  chartWidth: number;
  yMin: number;
  valueRange: number;
  timePointCount: number;
  timePointIndexByKey: Map<string, number>;
  onSelectPoint: (point: ChartPoint) => void;
  locale: AppLocale;
  t: TranslateFn;
  themedStyles: ReturnType<typeof createThemedStyles>;
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
          accessibilityLabel={t("care.vitals.observedA11y", {
            label: point.label,
            value: formatValue(point.value),
            unit: point.unit,
            date: formatObservationDate(point.recordedAt, locale, t),
          })}
          onPress={() => onSelectPoint(point)}
          style={[
            styles.point,
            themedStyles.point,
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

function getXAxisLabels(timePoints: ChartTimePoint[], locale: AppLocale) {
  if (timePoints.length === 0) return [];
  const start = new Date(timePoints[0].recordedAt);
  const end = new Date(timePoints[timePoints.length - 1].recordedAt);
  const spanDays = Math.max((end.getTime() - start.getTime()) / 86400000, 1);
  const labelPoints = getAxisLabelTimePoints(timePoints, 3);

  return labelPoints.map((point, index) => ({
    id: `${point.key}-${index}`,
    text: formatAxisDate(point.recordedAt, spanDays, locale),
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

function formatAxisDate(value: string, spanDays: number, locale: AppLocale) {
  if (/^\d{4}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (spanDays > 540) {
    return date.toLocaleDateString(locale, { year: "numeric" });
  }
  return date.toLocaleDateString(locale, { month: "short", year: "2-digit" });
}

function formatAverageSummary(metric: VitalMetric, chart: ChartModel, t: TranslateFn) {
  if (chart.points.length === 0) return t("care.vitals.averageUnavailable");
  if (metric.key === "blood_pressure_systolic") {
    const systolic = chart.series.find((series) => series.key === "blood_pressure_systolic");
    const diastolic = chart.series.find((series) => series.key === "blood_pressure_diastolic");
    const systolicAverage = getAverage(systolic?.points ?? []);
    const diastolicAverage = getAverage(diastolic?.points ?? []);
    if (systolicAverage == null || diastolicAverage == null) {
      return t("care.vitals.averageUnavailable");
    }
    return t("care.vitals.average", {
      value: `${formatValue(systolicAverage)}/${formatValue(diastolicAverage)} mmHg`,
    });
  }

  const average = getAverage(chart.points);
  const unit = chart.points[0]?.unit ?? metric.unit;
  return average == null
    ? t("care.vitals.averageUnavailable")
    : t("care.vitals.average", {
        value: `${formatValue(average)}${unit === "%" ? "%" : ` ${unit}`}`,
      });
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

function formatObservationDate(value: string | undefined, locale: AppLocale, t: TranslateFn) {
  if (!value) return t("common.notProvided");
  if (/^\d{4}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, {
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
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  syncButton: {
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  syncButtonDisabled: {
    opacity: 0.6,
  },
  syncButtonText: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: "900",
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
