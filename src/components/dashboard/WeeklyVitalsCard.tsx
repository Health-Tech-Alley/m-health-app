import { useEffect, useMemo, useState } from "react";

import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "@/constants/theme";
import { useSensor } from "@/contexts/sensor-context";
import { getLatestHealthSample } from "@/data/repositories/healthSampleRepository";
import { getActiveThresholdsForVital } from "@/data/repositories/thresholdRepository";
import type { HealthSampleType, NormalizedActivePatient } from "@/data/types";
import { useActivePatientView } from "@/hooks/useActivePatientView";
import { useAppSelector } from "@/store/hooks";
import type { LiveVitalReading } from "@/store/reducers/vitalsSlice";
import {
  selectLiveVitalsState,
  selectProductionWearableReadingsForPatient,
} from "@/store/reducers/vitalsSlice";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/hooks/use-translation";
import type { AppLocale, TranslateFn, TranslationKey } from "@/localization/i18n";

type MetricTone = "critical" | "warning" | "good";

type VitalMetric = {
  key: HealthSampleType;
  tabIcon: string;
  label: string;
  value: string;
  unit: string;
  status: string;
  statusTone: MetricTone;
  subtitle: string;
  helperText: string;
  readings: LiveVitalReading[];
};

const METRIC_META: Record<
  HealthSampleType,
  {
    tabIcon: string;
    labelKey: TranslationKey;
    helperKey: TranslationKey;
  }
> = {
  spo2: {
    tabIcon: "\u{1FAC1}",
    labelKey: "dashboard.vitals.metric.spo2.label",
    helperKey: "dashboard.vitals.metric.spo2.helper",
  },
  heart_rate: {
    tabIcon: "\u2764\uFE0F",
    labelKey: "dashboard.vitals.metric.heartRate.label",
    helperKey: "dashboard.vitals.metric.heartRate.helper",
  },
  respiratory_rate: {
    tabIcon: "\u{1F4A8}",
    labelKey: "dashboard.vitals.metric.respiratoryRate.label",
    helperKey: "dashboard.vitals.metric.respiratoryRate.helper",
  },
  blood_pressure_systolic: {
    tabIcon: "\u{1FA7A}",
    labelKey: "dashboard.vitals.metric.bloodPressure.label",
    helperKey: "dashboard.vitals.metric.bloodPressure.helper",
  },
  blood_pressure_diastolic: {
    tabIcon: "\u{1FA7A}",
    labelKey: "dashboard.vitals.metric.bloodPressure.label",
    helperKey: "dashboard.vitals.metric.bloodPressure.helper",
  },
  temperature: {
    tabIcon: "\u{1F321}\uFE0F",
    labelKey: "dashboard.vitals.metric.temperature.label",
    helperKey: "dashboard.vitals.metric.temperature.helper",
  },
  blood_glucose: {
    tabIcon: "\u{1FA78}",
    labelKey: "dashboard.vitals.metric.bloodGlucose.label",
    helperKey: "dashboard.vitals.metric.bloodGlucose.helper",
  },
  steps: {
    tabIcon: "\u{1F463}",
    labelKey: "dashboard.vitals.metric.steps.label",
    helperKey: "dashboard.vitals.metric.steps.helper",
  },
  weight: {
    tabIcon: "\u2696\uFE0F",
    labelKey: "dashboard.vitals.metric.weight.label",
    helperKey: "dashboard.vitals.metric.weight.helper",
  },
  height: {
    tabIcon: "\u{1F4CF}",
    labelKey: "dashboard.vitals.metric.height.label",
    helperKey: "dashboard.vitals.metric.height.helper",
  },
  bmi: {
    tabIcon: "\u{1F4CA}",
    labelKey: "dashboard.vitals.metric.bmi.label",
    helperKey: "dashboard.vitals.metric.bmi.helper",
  },
  distance: {
    tabIcon: "\u{1F6B6}",
    labelKey: "dashboard.vitals.metric.distance.label",
    helperKey: "dashboard.vitals.metric.distance.helper",
  },
  flights_climbed: {
    tabIcon: "\u{1FA9C}",
    labelKey: "dashboard.vitals.metric.flightsClimbed.label",
    helperKey: "dashboard.vitals.metric.flightsClimbed.helper",
  },
  sleep: {
    tabIcon: "\u{1F4A4}",
    labelKey: "dashboard.vitals.metric.sleep.label",
    helperKey: "dashboard.vitals.metric.sleep.helper",
  },
  coughing: {
    tabIcon: "\u{1F5E3}\uFE0F",
    labelKey: "dashboard.vitals.metric.coughing.label",
    helperKey: "dashboard.vitals.metric.coughing.helper",
  },
  calories_burned: {
    tabIcon: "\u{1F525}",
    labelKey: "dashboard.vitals.metric.caloriesBurned.label",
    helperKey: "dashboard.vitals.metric.caloriesBurned.helper",
  },
  hrv_sdnn: {
    tabIcon: "\u{1F30A}",
    labelKey: "dashboard.vitals.metric.hrvSdnn.label",
    helperKey: "dashboard.vitals.metric.hrvSdnn.helper",
  },
  resting_heart_rate: {
    tabIcon: "\u{1F6D1}",
    labelKey: "dashboard.vitals.metric.restingHeartRate.label",
    helperKey: "dashboard.vitals.metric.restingHeartRate.helper",
  },
  walking_steadiness: {
    tabIcon: "\u{1F9CF}",
    labelKey: "dashboard.vitals.metric.walkingSteadiness.label",
    helperKey: "dashboard.vitals.metric.walkingSteadiness.helper",
  },
  walking_speed: {
    tabIcon: "\u{1F6B6}",
    labelKey: "dashboard.vitals.metric.walkingSpeed.label",
    helperKey: "dashboard.vitals.metric.walkingSpeed.helper",
  },
  step_length: {
    tabIcon: "\u{1F4AD}",
    labelKey: "dashboard.vitals.metric.stepLength.label",
    helperKey: "dashboard.vitals.metric.stepLength.helper",
  },
  walking_asymmetry: {
    tabIcon: "\u{2696}\uFE0F",
    labelKey: "dashboard.vitals.metric.walkingAsymmetry.label",
    helperKey: "dashboard.vitals.metric.walkingAsymmetry.helper",
  },
  walking_double_support: {
    tabIcon: "\u{23F1}\uFE0F",
    labelKey: "dashboard.vitals.metric.walkingDoubleSupport.label",
    helperKey: "dashboard.vitals.metric.walkingDoubleSupport.helper",
  },
  vo2_max: {
    tabIcon: "\u{1F3C3}",
    labelKey: "dashboard.vitals.metric.vo2Max.label",
    helperKey: "dashboard.vitals.metric.vo2Max.helper",
  },
  six_minute_walk_distance: {
    tabIcon: "\u{1F3C1}",
    labelKey: "dashboard.vitals.metric.sixMinuteWalk.label",
    helperKey: "dashboard.vitals.metric.sixMinuteWalk.helper",
  },
};

type MetricClass = "continuous" | "cumulative" | "spot" | "paired" | "sleep" | "event";

const METRIC_CLASS_BY_TYPE: Record<HealthSampleType, MetricClass> = {
  spo2: "continuous",
  heart_rate: "continuous",
  respiratory_rate: "continuous",
  blood_pressure_systolic: "paired",
  blood_pressure_diastolic: "paired",
  temperature: "spot",
  weight: "spot",
  height: "spot",
  bmi: "spot",
  blood_glucose: "spot",
  steps: "cumulative",
  distance: "cumulative",
  flights_climbed: "cumulative",
  sleep: "sleep",
  coughing: "event",
  calories_burned: "cumulative",
  hrv_sdnn: "continuous",
  resting_heart_rate: "continuous",
  walking_steadiness: "continuous",
  walking_speed: "continuous",
  step_length: "continuous",
  walking_asymmetry: "continuous",
  walking_double_support: "continuous",
  vo2_max: "continuous",
  six_minute_walk_distance: "spot",
};

type ChartBand = { value: number; tone: "warning" | "danger"; label: string };

const PREFERRED_METRIC_ORDER: HealthSampleType[] = [
  "spo2",
  "heart_rate",
  "respiratory_rate",
  "blood_pressure_systolic",
  "temperature",
  "blood_glucose",
  "steps",
  "distance",
  "flights_climbed",
  "calories_burned",
  "hrv_sdnn",
  "resting_heart_rate",
  "walking_steadiness",
  "walking_speed",
  "step_length",
  "walking_asymmetry",
  "walking_double_support",
  "vo2_max",
  "six_minute_walk_distance",
];

const DISPLAY_UNIT_OVERRIDE: Partial<Record<HealthSampleType, string>> = {
  heart_rate: 'bpm',
  respiratory_rate: 'breaths/min',
  steps: 'steps',
  distance: 'm',
  flights_climbed: 'flights',
  blood_pressure_systolic: 'mmHg',
  blood_pressure_diastolic: 'mmHg',
  calories_burned: 'kcal',
  hrv_sdnn: 'ms',
  resting_heart_rate: 'bpm',
  walking_steadiness: '%',
  walking_speed: 'm/s',
  step_length: 'cm',
  walking_asymmetry: '%',
  walking_double_support: '%',
  vo2_max: 'ml/kg/min',
  six_minute_walk_distance: 'm',
};

function displayUnit(type: HealthSampleType, rawUnit: string): string {
  return DISPLAY_UNIT_OVERRIDE[type] ?? rawUnit;
}

const CHART_HEIGHT = 88;
const POINT_SIZE = 8;
const RECENT_WINDOW_MS = 100 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function WeeklyVitalsCard() {
  const theme = useTheme();
  const { locale, t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const [selectedKey, setSelectedKey] = useState<HealthSampleType>("spo2");
  const [selectedDayStart, setSelectedDayStart] = useState<number>(() =>
    startOfLocalDay(Date.now()),
  );
  const [timeDifferent, setTimeDifferent] = useState<string | null>("");
  const vitals = useAppSelector(selectLiveVitalsState);
  const activePatient = useActivePatientView();
  const activePatientId = activePatient?.patientId ?? null;
  const productionReadings = useAppSelector((state) =>
    selectProductionWearableReadingsForPatient(state, activePatientId),
  );

  const metrics = useMemo(
    () => buildMetrics(productionReadings, activePatientId, t, locale),
    [activePatientId, locale, productionReadings, t],
  );

  const { isRealHealth } = useSensor();
  useEffect(() => {
    if (!activePatientId) return;
    console.log('[DEBUG] isRealHealth:', isRealHealth);
    console.log('[DEBUG] latest respiratory_rate in SQLite:', getLatestHealthSample(activePatientId, 'respiratory_rate'));
    console.log('[DEBUG] latest heart_rate in SQLite:', getLatestHealthSample(activePatientId, 'heart_rate'));
  }, [activePatientId, isRealHealth]);

  useEffect(() => {
    console.log('[DEBUG] Weekly vitals updated:', productionReadings.length, 'readings for patient', activePatientId);
  }, [activePatientId, productionReadings]);

  const selectedMetric =
    metrics.find((metric) => metric.key === selectedKey) ?? metrics[0] ?? null;
  const summaryMetrics = getSummaryMetrics(metrics, selectedMetric);
  const selectedClass = selectedMetric
    ? METRIC_CLASS_BY_TYPE[selectedMetric.key]
    : null;

  const diastolicReadings = useMemo(
    () =>
      productionReadings.filter(
        (reading) =>
          reading.patientId === activePatientId &&
          reading.type === "blood_pressure_diastolic",
      ),
    [activePatientId, productionReadings],
  );

  const bands = useMemo(
    () =>
      buildBandsForMetric(
        selectedMetric?.key ?? null,
        activePatientId,
        activePatient,
        t,
      ),
    [selectedMetric, activePatientId, activePatient, t],
  );

  const dayTotal = useMemo(() => {
    if (!selectedMetric || selectedClass !== "cumulative") return null;
    return sumReadingsForDay(selectedMetric.readings, selectedDayStart);
  }, [selectedMetric, selectedClass, selectedDayStart]);

  if (vitals.status === "loading") {
    return (
      <CardShell title={t("dashboard.vitals.title")}>
        <Text style={[styles.stateText, themedStyles.subtitle]}>{t("dashboard.vitals.loading")}</Text>
      </CardShell>
    );
  }
  if (vitals.status === "error" || vitals.status === "unavailable" || !activePatientId) {
    return (
      <CardShell title={t("dashboard.vitals.title")}>
        <Text style={[styles.stateText, themedStyles.subtitle]}>{t("dashboard.vitals.unavailable")}</Text>
      </CardShell>
    );
  }

  if (!selectedMetric) {
    return (
      <CardShell title={t("dashboard.vitals.title")}>
        <Text style={[styles.stateText, themedStyles.subtitle]}>{t("dashboard.vitals.noReadings")}</Text>
      </CardShell>
    );
  }

  return (
    <View style={[styles.card, themedStyles.card]}>
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>{t("dashboard.vitals.title")}</Text>
          <Text style={[styles.subtitle, themedStyles.subtitle]}>{selectedMetric.subtitle}</Text>
        </View>

        <View style={styles.tabRow}>
          {metrics.map((metric) => {
            const active = metric.key === selectedMetric.key;

            return (
              <Pressable
                key={metric.key}
                style={[styles.tab, themedStyles.tab, active && styles.tabActive]}
                accessibilityRole="button"
                accessibilityLabel={metric.label}
                onPress={() => setSelectedKey(metric.key)}
              >
                <Text style={[styles.tabIcon, themedStyles.tabIcon, active && styles.tabIconActive]}>
                  {metric.tabIcon}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.metricHelperText, themedStyles.subtitle]}>{selectedMetric.helperText}</Text>
      </View>

      <View style={styles.valueRow}>
        <Text style={[styles.mainValue, themedStyles.mainValue]}>
          {dayTotal !== null ? formatNumber(dayTotal) : selectedMetric.value}
        </Text>
        <Text style={[styles.unit, themedStyles.subtitle]}>{selectedMetric.unit}</Text>
        <Text style={[styles.status, styles.statusGood, themedStyles.statusGood]}>
          {dayTotal !== null ? formatDayLabel(selectedDayStart, locale, t) : selectedMetric.status}
        </Text>
      </View>

      {selectedClass === "cumulative" ? (
        <HourlyBarChart
          readings={selectedMetric.readings}
          dayStart={selectedDayStart}
          onDayChange={setSelectedDayStart}
          locale={locale}
          t={t}
        />
      ) : (
        <TrendChart
          readings={selectedMetric.readings}
          secondaryReadings={selectedClass === "paired" ? diastolicReadings : undefined}
          bands={bands}
          locale={locale}
        />
      )}

      {summaryMetrics.length > 0 ? (
        <>
          <View style={[styles.divider, themedStyles.divider]} />

          <View style={styles.bottomStats}>
            {summaryMetrics.map((metric) => (
              <SmallStat
                key={metric.key}
                label={metric.label}
                value={metric.value}
                unit={metric.unit}
                tone={metric.statusTone}
              />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function CardShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <View style={[styles.card, themedStyles.card]}>
      <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>{title}</Text>
      {children}
    </View>
  );
}

function buildMetrics(
  readings: LiveVitalReading[],
  activePatientId: string | null,
  t: TranslateFn,
  locale: AppLocale,
): VitalMetric[] {
  if (!activePatientId) return [];

  const since = Date.now() - RECENT_WINDOW_MS;
  const recent = readings.filter((reading) => {
    if (reading.patientId !== activePatientId) return false;
    const recordedAt = Date.parse(reading.recordedAt);
    return Number.isFinite(recordedAt) && recordedAt >= since;
  });

  const byType = new Map<HealthSampleType, LiveVitalReading[]>();
  for (const reading of recent) {
    const group = byType.get(reading.type) ?? [];
    group.push(reading);
    byType.set(reading.type, group);
  }

  return PREFERRED_METRIC_ORDER
    .filter((type) => type !== "blood_pressure_diastolic")
    .flatMap((type) => {
      const typeReadings = byType.get(type) ?? [];
      if (typeReadings.length === 0) return [];
      const sorted = [...typeReadings].sort(
        (a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt),
      );
      const latest = sorted[sorted.length - 1];
      const meta = METRIC_META[type];

      return [{
        key: type,
        tabIcon: meta.tabIcon,
        label: t(meta.labelKey),
        value: formatReadingValue(latest, byType),
        unit: displayUnit(type, formatReadingUnit(latest, byType)),
        status: t("dashboard.vitals.latest", { time: formatRelativeTime(latest.recordedAt, t) }),
        statusTone: "good" as MetricTone,
        subtitle: formatReadingsSubtitle(sorted, locale, t),
        helperText: t(meta.helperKey),
        readings: sorted,
      }];
    });
}

function formatReadingValue(
  reading: LiveVitalReading,
  byType: Map<HealthSampleType, LiveVitalReading[]>,
): string {
  if (reading.type !== "blood_pressure_systolic") {
    return formatNumber(reading.value);
  }

  const diastolic = findPairedReading(reading, byType.get("blood_pressure_diastolic") ?? []);
  return diastolic ? `${formatNumber(reading.value)}/${formatNumber(diastolic.value)}` : formatNumber(reading.value);
}

function formatReadingUnit(
  reading: LiveVitalReading,
  byType: Map<HealthSampleType, LiveVitalReading[]>,
): string {
  if (reading.type !== "blood_pressure_systolic") {
    return reading.unit;
  }

  const diastolic = findPairedReading(reading, byType.get("blood_pressure_diastolic") ?? []);
  return reading.unit || diastolic?.unit || "mmHg";
}

function findPairedReading(
  reading: LiveVitalReading,
  candidates: LiveVitalReading[],
): LiveVitalReading | undefined {
  const baseId = reading.sampleId.replace(/-systolic$/, "");
  return (
    candidates.find((candidate) => candidate.sampleId.replace(/-diastolic$/, "") === baseId) ??
    candidates.find((candidate) => candidate.recordedAt === reading.recordedAt)
  );
}

function getSummaryMetrics(
  metrics: VitalMetric[],
  selectedMetric: VitalMetric | null,
): VitalMetric[] {
  return metrics
    // .filter((metric) => metric.key !== selectedMetric?.key)
    // .filter((metric) => metric.key === "heart_rate" || metric.key === "respiratory_rate" || metric.key === "blood_pressure_systolic" || metric.key === "blood_pressure_diastolic" )
    // .slice(0, 2);
}

function TrendChart({
  readings,
  secondaryReadings,
  bands = [],
  locale,
}: {
  readings: LiveVitalReading[];
  secondaryReadings?: LiveVitalReading[];
  bands?: ChartBand[];
  locale: AppLocale;
}) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const [chartWidth, setChartWidth] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const values = readings.map((reading) => reading.value);
  const secondaryValues =
    secondaryReadings && secondaryReadings.length > 0
      ? secondaryReadings.map((reading) => reading.value)
      : null;
  const bandValues = bands.map((band) => band.value);

  const points = useMemo(() => {
    if (chartWidth <= 0 || values.length === 0) return [];

    const allValues = [...values, ...(secondaryValues ?? []), ...bandValues];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const range = Math.max(max - min, 1);

    return values.map((value, index) => {
      const x =
        values.length === 1
          ? chartWidth / 2
          : (index / (values.length - 1)) * chartWidth;

      const normalized = (value - min) / range;
      const y = CHART_HEIGHT - normalized * (CHART_HEIGHT - 12) - 6;

      return { x, y };
    });
  }, [chartWidth, values, secondaryValues, bandValues]);

  const secondaryPoints = useMemo(() => {
    if (!secondaryValues || chartWidth <= 0 || secondaryValues.length === 0) return null;

    const allValues = [...values, ...secondaryValues, ...bandValues];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const range = Math.max(max - min, 1);

    return secondaryValues.map((value, index) => {
      const x =
        secondaryValues.length === 1
          ? chartWidth / 2
          : (index / (secondaryValues.length - 1)) * chartWidth;
      const normalized = (value - min) / range;
      const y = CHART_HEIGHT - normalized * (CHART_HEIGHT - 12) - 6;
      return { x, y };
    });
  }, [chartWidth, secondaryValues, values, bandValues]);

  const bandLines = useMemo(() => {
    if (chartWidth <= 0 || bandValues.length === 0 || values.length === 0) return [];

    const allValues = [...values, ...(secondaryValues ?? []), ...bandValues];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const range = Math.max(max - min, 1);

    return bands.map((band) => {
      const normalized = (band.value - min) / range;
      const y = CHART_HEIGHT - normalized * (CHART_HEIGHT - 12) - 6;
      return { ...band, y };
    });
  }, [chartWidth, bands, bandValues, values, secondaryValues]);

  const firstReading = readings[0];
  const lastReading = readings[readings.length - 1];
  const selectedPoint = selectedIndex !== null ? points[selectedIndex] : null;
  const selectedReading = selectedIndex !== null ? readings[selectedIndex] : null;

  return (
    <View style={styles.chartWrap}>
      <View style={styles.yAxis}>
        <Text style={[styles.axisLabel, themedStyles.axisLabel]}>{formatNumber(Math.max(...values, ...(secondaryValues ?? [])))}</Text>
        <Text style={[styles.axisLabel, themedStyles.axisLabel]}>{formatNumber(Math.min(...values, ...(secondaryValues ?? [])))}</Text>
      </View>

      <View style={styles.chartArea}>
        <View
          style={styles.plotArea}
          onLayout={(event) => {
            setChartWidth(event.nativeEvent.layout.width);
          }}
        >
          {bandLines.map((band) => (
            <View
              key={`band-${band.label}-${band.value}`}
              pointerEvents="none"
              style={[
                styles.bandLine,
                {
                  top: band.y,
                  borderColor: band.tone === "danger" ? AppTheme.colors.danger : AppTheme.colors.warning,
                },
              ]}
            >
              <Text
                style={[
                  styles.bandLabel,
                  { color: band.tone === "danger" ? AppTheme.colors.danger : AppTheme.colors.warning },
                ]}
              >
                {band.label} {formatNumber(band.value)}
              </Text>
            </View>
          ))}

          {secondaryPoints
            ? secondaryPoints.slice(0, -1).map((point, index) => {
                const next = secondaryPoints[index + 1];
                const dx = next.x - point.x;
                const dy = next.y - point.y;
                const length = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx);

                return (
                  <View
                    key={`segment-secondary-${index}`}
                    style={[
                      styles.lineSegmentSecondary,
                      themedStyles.secondaryChart,
                      {
                        width: length,
                        left: point.x,
                        top: point.y,
                        transform: [{ rotate: `${angle}rad` }],
                      },
                    ]}
                  />
                );
              })
            : null}

          {points.map((point, index) => {
            if (index === points.length - 1) return null;

            const next = points[index + 1];
            const dx = next.x - point.x;
            const dy = next.y - point.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx);

            return (
              <View
                key={`segment-${readings[index].sampleId}`}
                style={[
                  styles.lineSegment,
                  themedStyles.chartAccent,
                  {
                    width: length,
                    left: point.x,
                    top: point.y,
                    transform: [{ rotate: `${angle}rad` }],
                  },
                ]}
              />
            );
          })}

          {points.map((point, index) => (
            <Pressable
              key={`point-${readings[index].sampleId}`}
              hitSlop={10}
              onPress={() =>
                setSelectedIndex((current) => (current === index ? null : index))
              }
              style={[
                styles.point,
                themedStyles.chartAccent,
                {
                  left: point.x - POINT_SIZE / 2,
                  top: point.y - POINT_SIZE / 2,
                },
                selectedIndex === index && styles.pointSelected,
                selectedIndex === index && themedStyles.pointSelected,
              ]}
            />
          ))}

          {secondaryPoints
            ? secondaryPoints.map((point, index) => (
                <View
                  key={`point-secondary-${index}`}
                  style={[
                    styles.pointSecondary,
                    themedStyles.secondaryChart,
                    {
                      left: point.x - POINT_SIZE / 2,
                      top: point.y - POINT_SIZE / 2,
                    },
                  ]}
                />
              ))
            : null}

          {selectedPoint && selectedReading ? (
            <View
              pointerEvents="none"
              style={[
                styles.valueBubble,
                themedStyles.valueBubble,
                {
                  left: Math.max(
                    0,
                    Math.min(selectedPoint.x - 24, chartWidth - 48),
                  ),
                  top: Math.max(selectedPoint.y - 30, 0),
                },
              ]}
            >
              <Text style={styles.valueBubbleText}>
                {formatNumber(selectedReading.value)}, {formatTime(selectedReading.recordedAt, locale)}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.dayRow}>
          <Text style={[styles.dayLabel, themedStyles.axisLabel]}>
            {firstReading ? formatShortDate(firstReading.recordedAt, locale) : ""}
          </Text>
          <Text style={[styles.dayLabel, themedStyles.axisLabel]}>
            {lastReading ? formatShortDate(lastReading.recordedAt, locale) : ""}
          </Text>
        </View>
      </View>
    </View>
  );
}

function HourlyBarChart({
  readings,
  dayStart,
  onDayChange,
  locale,
  t,
}: {
  readings: LiveVitalReading[];
  dayStart: number;
  onDayChange: (dayStartMs: number) => void;
  locale: AppLocale;
  t: TranslateFn;
}) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const [chartWidth, setChartWidth] = useState(0);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);

  const buckets = useMemo(() => {
    const totals = new Array(24).fill(0) as number[];
    for (const reading of readings) {
      const t = Date.parse(reading.recordedAt);
      if (!Number.isFinite(t)) continue;
      if (t < dayStart || t >= dayStart + DAY_MS) continue;
      totals[new Date(t).getHours()] += reading.value;
    }
    return totals.map((total, hour) => ({ hour, total }));
  }, [readings, dayStart]);

  const maxTotal = Math.max(...buckets.map((bucket) => bucket.total), 1);
  const selectedBucket =
    selectedHour !== null ? buckets[selectedHour] : null;

  const barWidth = chartWidth <= 0 ? 0 : chartWidth / 24;

  return (
    <View>
      <View style={styles.hourBarHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("dashboard.vitals.previousDay")}
          onPress={() => onDayChange(dayStart - DAY_MS)}
          style={[styles.dayChevron, themedStyles.dayChevron]}
        >
          <Text style={[styles.dayChevronText, themedStyles.dayChevronText]}>‹</Text>
        </Pressable>
        <Text style={[styles.dayTitle, themedStyles.subtitle]}>{formatDayLabel(dayStart, locale, t)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("dashboard.vitals.nextDay")}
          onPress={() => onDayChange(dayStart + DAY_MS)}
          style={[styles.dayChevron, themedStyles.dayChevron]}
        >
          <Text style={[styles.dayChevronText, themedStyles.dayChevronText]}>›</Text>
        </Pressable>
      </View>

      <View style={styles.chartWrap}>
        <View style={styles.yAxis}>
          <Text style={[styles.axisLabel, themedStyles.axisLabel]}>{formatNumber(maxTotal)}</Text>
          <Text style={[styles.axisLabel, themedStyles.axisLabel]}>0</Text>
        </View>

        <View style={styles.chartArea}>
          <View
            style={[styles.plotArea, styles.hourPlotArea]}
            onLayout={(event) => {
              setChartWidth(event.nativeEvent.layout.width);
            }}
          >
            {buckets.map((bucket) => {
              const height =
                bucket.total > 0
                  ? Math.max(4, (bucket.total / maxTotal) * (CHART_HEIGHT - 12))
                  : 2;
              const selected = selectedHour === bucket.hour;

              return (
                <Pressable
                  key={`hour-${bucket.hour}`}
                  hitSlop={4}
                  onPress={() =>
                    setSelectedHour((current) =>
                      current === bucket.hour ? null : bucket.hour,
                    )
                  }
                  style={[
                    styles.hourBar,
                    themedStyles.chartAccent,
                    {
                      width: Math.max(barWidth - 2, 1),
                      left: bucket.hour * barWidth,
                      height,
                    },
                    selected && styles.hourBarSelected,
                    selected && themedStyles.hourBarSelected,
                  ]}
                />
              );
            })}

            {selectedBucket ? (
              <View
                pointerEvents="none"
                style={[
                  styles.valueBubble,
                  themedStyles.valueBubble,
                  {
                    left: Math.max(
                      0,
                      Math.min(selectedBucket.hour * barWidth + barWidth / 2 - 24, chartWidth - 48),
                    ),
                    top: 4,
                  },
                ]}
              >
                <Text style={styles.valueBubbleText}>
                  {formatNumber(selectedBucket.total)}, {formatHourLabel(selectedBucket.hour)}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.hourAxis}>
            {[0, 6, 12, 18].map((hour) => (
              <Text key={hour} style={[styles.hourAxisLabel, themedStyles.axisLabel]}>
                {formatHourLabel(hour)}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

function SmallStat({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone: MetricTone;
}) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <View style={styles.smallStat}>
      <Text style={[styles.smallStatLabel, themedStyles.subtitle]}>{label}</Text>
      <Text style={styles.smallStatValueRow}>
        <Text
          style={[
            styles.smallStatValue,
            themedStyles.smallStatValue,
            tone === "critical" && styles.smallStatCritical,
            tone === "warning" && styles.smallStatWarning,
          ]}
        >
          {value}
        </Text>
        <Text style={[styles.smallStatUnit, themedStyles.subtitle]}> {unit}</Text>
      </Text>
    </View>
  );
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatTime(value: string, locale: AppLocale): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRelativeTime(value: string, t: TranslateFn): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return t("dashboard.vitals.recently");

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return t("dashboard.vitals.justNow");
  if (diffMinutes < 60) return t("dashboard.vitals.minutesAgoShort", { count: diffMinutes });

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return t("dashboard.vitals.hoursAgoShort", { count: diffHours });

  const diffDays = Math.round(diffHours / 24);
  return t("dashboard.vitals.daysAgoShort", { count: diffDays });
}

function formatShortDate(value: string, locale: AppLocale): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  return new Date(timestamp).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

function formatReadingsSubtitle(readings: LiveVitalReading[], locale: AppLocale, t: TranslateFn): string {
  const countLabel = t(readings.length === 1 ? "dashboard.vitals.readingOne" : "dashboard.vitals.readingMany", {
    count: readings.length,
  });
  const dates = readings
    .map((reading) => {
      const timestamp = Date.parse(reading.recordedAt);
      return Number.isFinite(timestamp) ? new Date(timestamp) : null;
    })
    .filter((date): date is Date => date !== null);

  if (dates.length === 0) return t("dashboard.vitals.latestReadings");

  const today = new Date();
  if (dates.every((date) => isSameLocalDay(date, today))) {
    return t("dashboard.vitals.readingsToday", { countLabel });
  }

  const first = dates[0];
  const last = dates[dates.length - 1];
  const firstLabel = formatShortDate(first.toISOString(), locale);
  const lastLabel = formatShortDate(last.toISOString(), locale);

  if (!firstLabel || !lastLabel) return t("dashboard.vitals.latestReadings");
  if (firstLabel === lastLabel) return t("dashboard.vitals.readingsOnDate", { countLabel, date: lastLabel });
  return t("dashboard.vitals.readingsDateRange", { countLabel, firstDate: firstLabel, lastDate: lastLabel });
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function sumReadingsForDay(readings: LiveVitalReading[], dayStartMs: number): number {
  let total = 0;
  for (const reading of readings) {
    const t = Date.parse(reading.recordedAt);
    if (!Number.isFinite(t)) continue;
    if (t < dayStartMs || t >= dayStartMs + DAY_MS) continue;
    total += reading.value;
  }
  return total;
}

function formatDayLabel(dayStartMs: number, locale: AppLocale, t: TranslateFn): string {
  const today = startOfLocalDay(Date.now());
  if (dayStartMs === today) return t("dashboard.vitals.today");
  if (dayStartMs === today - DAY_MS) return t("dashboard.vitals.yesterday");
  return new Date(dayStartMs).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

/**
 * Build dotted threshold lines for a metric from the active-thresholds table
 * plus patient baselines. Threshold rows take precedence (dedupe keeps the
 * first occurrence); HR falls back to a baseline-relative band.
 */
function buildBandsForMetric(
  metricKey: HealthSampleType | null,
  patientId: string | null,
  patient: NormalizedActivePatient | null,
  t: TranslateFn,
): ChartBand[] {
  if (!metricKey || !patientId) return [];
  const bands: ChartBand[] = [];

  for (const threshold of getActiveThresholdsForVital(patientId, metricKey)) {
    bands.push({
      value: threshold.value,
      tone: threshold.severity >= 3 ? "danger" : "warning",
      label: threshold.direction === "below" ? t("dashboard.vitals.band.min") : t("dashboard.vitals.band.max"),
    });
  }

  if (metricKey === "spo2") {
    const cutoff = Number.parseFloat(patient?.spo2Cutoff ?? "");
    if (Number.isFinite(cutoff)) {
      bands.push({ value: cutoff, tone: "danger", label: t("dashboard.vitals.band.cutoff") });
    }
  }

  if (metricKey === "heart_rate") {
    const baseline = Number.parseFloat(patient?.baselineHeartRate ?? "");
    if (Number.isFinite(baseline)) {
      bands.push(
        { value: baseline + 30, tone: "warning", label: t("dashboard.vitals.band.max") },
        { value: Math.max(40, baseline - 20), tone: "warning", label: t("dashboard.vitals.band.min") },
      );
    }
  }

  const seen = new Set<number>();
  return bands.filter((band) => {
    if (seen.has(band.value)) return false;
    seen.add(band.value);
    return true;
  });
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === "#000000";

  return StyleSheet.create({
    card: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    sectionTitle: {
      color: theme.appSectionText,
    },
    subtitle: {
      color: theme.appTextSupporting,
    },
    tab: {
      backgroundColor: theme.appControlSurface,
    },
    tabIcon: {
      color: theme.appTextSupporting,
    },
    mainValue: {
      color: isDark ? theme.appText : AppTheme.colors.brandDark,
    },
    statusGood: {
      color: isDark ? theme.appTextSupporting : AppTheme.colors.brand,
    },
    axisLabel: {
      color: theme.appTextMuted,
    },
    chartAccent: {
      backgroundColor: AppTheme.colors.brand,
    },
    secondaryChart: {
      backgroundColor: theme.appTextMuted,
    },
    divider: {
      backgroundColor: theme.appBorder,
    },
    smallStatValue: {
      color: isDark ? theme.appText : AppTheme.colors.brand,
    },
    pointSelected: {
      borderColor: theme.appSurface,
    },
    valueBubble: {
      backgroundColor: isDark ? theme.appControlSurface : AppTheme.colors.brandDark,
    },
    dayChevron: {
      backgroundColor: theme.appControlSurface,
    },
    dayChevronText: {
      color: isDark ? theme.appText : AppTheme.colors.brandDark,
    },
    hourBarSelected: {
      backgroundColor: isDark ? theme.appText : AppTheme.colors.brandDark,
    },
  });
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 30,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    ...AppTheme.shadow,
  },
  headerRow: {
    marginBottom: 22,
  },
  titleBlock: {
    marginBottom: 14,
  },
  sectionTitle: {
    color: AppTheme.colors.sectionText,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 7,
  },
  subtitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 15,
    fontWeight: "700",
  },
  tabRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tab: {
    minHeight: 54,
    minWidth: 54,
    borderRadius: 18,
    backgroundColor: AppTheme.colors.softSurface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: AppTheme.colors.brand,
    ...AppTheme.shadow,
  },
  tabIcon: {
    color: AppTheme.colors.textSoft,
    fontSize: 24,
    lineHeight: 30,
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
  valueRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 12,
    flexWrap: "wrap",
  },
  mainValue: {
    color: AppTheme.colors.brandDark,
    fontSize: 34,
    fontWeight: "900",
  },
  unit: {
    color: AppTheme.colors.textMuted,
    fontSize: 16,
    fontWeight: "800",
    marginLeft: 6,
    marginBottom: 5,
  },
  status: {
    fontSize: 14,
    fontWeight: "900",
    marginLeft: 16,
    marginBottom: 5,
  },
  statusCritical: {
    color: AppTheme.colors.danger,
  },
  statusWarning: {
    color: AppTheme.colors.warning,
  },
  statusGood: {
    color: AppTheme.colors.brand,
  },
  stateText: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  chartWrap: {
    flexDirection: "row",
    minHeight: 112,
  },
  yAxis: {
    width: 38,
    height: CHART_HEIGHT,
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingRight: 7,
  },
  axisLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  chartArea: {
    flex: 1,
    height: 112,
  },
  plotArea: {
    height: CHART_HEIGHT,
    position: "relative",
  },
  lineSegment: {
    position: "absolute",
    height: 3,
    borderRadius: 999,
    backgroundColor: AppTheme.colors.brand,
    transformOrigin: "left center",
  },
  lineSegmentSecondary: {
    position: "absolute",
    height: 2,
    borderRadius: 999,
    backgroundColor: AppTheme.colors.textMuted,
    opacity: 0.7,
    transformOrigin: "left center",
  },
  point: {
    position: "absolute",
    width: POINT_SIZE,
    height: POINT_SIZE,
    borderRadius: POINT_SIZE / 2,
    backgroundColor: AppTheme.colors.brand,
  },
  pointSecondary: {
    position: "absolute",
    width: POINT_SIZE - 2,
    height: POINT_SIZE - 2,
    borderRadius: (POINT_SIZE - 2) / 2,
    backgroundColor: AppTheme.colors.textMuted,
    opacity: 0.7,
  },
  bandLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 0,
    borderTopWidth: 1,
    borderStyle: "dashed",
    opacity: 0.9,
  },
  bandLabel: {
    position: "absolute",
    right: 0,
    top: -8,
    fontSize: 9,
    fontWeight: "800",
  },
  hourPlotArea: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  hourBar: {
    position: "absolute",
    bottom: 0,
    borderRadius: 3,
    backgroundColor: AppTheme.colors.brand,
    opacity: 0.75,
  },
  hourBarSelected: {
    backgroundColor: AppTheme.colors.brandDark,
    opacity: 1,
  },
  hourBarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  dayTitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "800",
  },
  dayChevron: {
    minWidth: 36,
    minHeight: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: AppTheme.colors.softSurface,
  },
  dayChevronText: {
    color: AppTheme.colors.brandDark,
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 20,
  },
  hourAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingHorizontal: 2,
  },
  hourAxisLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
  },
  dayRow: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dayLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  divider: {
    height: 1,
    backgroundColor: AppTheme.colors.border,
    marginTop: 16,
    marginBottom: 18,
  },
  bottomStats: {
    flexDirection: "row",
    gap: 20,
  },
  smallStat: {
    flex: 1,
  },
  smallStatLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 7,
  },
  smallStatValueRow: {
    fontSize: 15,
  },
  smallStatValue: {
    color: AppTheme.colors.brand,
    fontSize: 17,
    fontWeight: "900",
  },
  smallStatCritical: {
    color: AppTheme.colors.danger,
  },
  smallStatWarning: {
    color: AppTheme.colors.warning,
  },
  smallStatUnit: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  pointSelected: {
    width: POINT_SIZE + 6,
    height: POINT_SIZE + 6,
    borderRadius: (POINT_SIZE + 6) / 2,
    borderWidth: 2,
    borderColor: AppTheme.colors.white,
  },
  valueBubble: {
    position: "absolute",
    backgroundColor: AppTheme.colors.brandDark,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 48,
    alignItems: "center",
  },
  valueBubbleText: {
    color: AppTheme.colors.white,
    fontSize: 11,
    fontWeight: "800",
  },
});
