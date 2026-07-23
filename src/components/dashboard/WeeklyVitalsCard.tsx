import { useEffect, useMemo, useState } from "react";

import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "@/constants/theme";
import { useSensor } from "@/contexts/sensor-context";
import { getLatestHealthSample } from "@/data/repositories/healthSampleRepository";
import type { HealthSampleType } from "@/data/types";
import { useActivePatientView } from "@/hooks/useActivePatientView";
import { useAppSelector } from "@/store/hooks";
import type { LiveVitalReading } from "@/store/reducers/vitalsSlice";
import {
  selectLiveVitalsState,
  selectProductionWearableReadingsForPatient,
} from "@/store/reducers/vitalsSlice";

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
    label: string;
    helperText: string;
  }
> = {
  spo2: {
    tabIcon: "\u{1FAC1}",
    label: "Oxygen Saturation",
    helperText: "SpO2 estimates how much oxygen is in the blood.",
  },
  heart_rate: {
    tabIcon: "\u2764\uFE0F",
    label: "Heart Rate",
    helperText: "Heart rate shows beats per minute.",
  },
  respiratory_rate: {
    tabIcon: "\u{1F4A8}",
    label: "Respiratory Rate",
    helperText: "Respiratory rate counts breaths per minute.",
  },
  blood_pressure_systolic: {
    tabIcon: "\u{1FA7A}",
    label: "Blood Pressure",
    helperText: "Blood pressure is shown from paired recent readings when available.",
  },
  blood_pressure_diastolic: {
    tabIcon: "\u{1FA7A}",
    label: "Blood Pressure",
    helperText: "Blood pressure is shown from paired recent readings when available.",
  },
  temperature: {
    tabIcon: "\u{1F321}\uFE0F",
    label: "Body Temperature",
    helperText: "Body temperature uses the unit stored with the reading.",
  },
  blood_glucose: {
    tabIcon: "\u{1FA78}",
    label: "Blood Glucose",
    helperText: "Blood glucose uses the unit stored with the reading.",
  },
  steps: {
    tabIcon: "\u{1F463}",
    label: "Steps",
    helperText: "Steps show recent movement readings from monitoring data.",
  },
  weight: {
    tabIcon: "\u2696\uFE0F",
    label: "Weight",
    helperText: "Weight uses the unit stored with the reading.",
  },
  height: {
    tabIcon: "\u{1F4CF}",
    label: "Height",
    helperText: "Height uses the unit stored with the reading.",
  },
  bmi: {
    tabIcon: "\u{1F4CA}",
    label: "BMI",
    helperText: "BMI uses the unit stored with the reading.",
  },
  distance: {
    tabIcon: "\u{1F6B6}",
    label: "Distance",
    helperText: "Distance uses the unit stored with the reading.",
  },
  flights_climbed: {
    tabIcon: "\u{1FA9C}",
    label: "Flights Climbed",
    helperText: "Flights climbed uses the unit stored with the reading.",
  },
  sleep: {
    tabIcon: "\u{1F4A4}",
    label: "Sleep",
    helperText: "Sleep readings use the stored monitoring value.",
  },
  coughing: {
    tabIcon: "\u{1F5E3}\uFE0F",
    label: "Coughing",
    helperText: "Coughing readings use the stored monitoring value.",
  },
};

const PREFERRED_METRIC_ORDER: HealthSampleType[] = [
  "spo2",
  "heart_rate",
  "respiratory_rate",
  "blood_pressure_systolic",
  "temperature",
  "blood_glucose",
  "steps",
];

const DISPLAY_UNIT_OVERRIDE: Partial<Record<HealthSampleType, string>> = {
  heart_rate: 'bpm',
  respiratory_rate: 'breaths/min',
  steps: 'steps',
  distance: 'm',
  flights_climbed: 'flights',
  blood_pressure_systolic: 'mmHg',
  blood_pressure_diastolic: 'mmHg',
};

function displayUnit(type: HealthSampleType, rawUnit: string): string {
  return DISPLAY_UNIT_OVERRIDE[type] ?? rawUnit;
}

const CHART_HEIGHT = 88;
const POINT_SIZE = 8;
const RECENT_WINDOW_MS = 100 * 24 * 60 * 60 * 1000;

export function WeeklyVitalsCard() {
  const [selectedKey, setSelectedKey] = useState<HealthSampleType>("spo2");
  const vitals = useAppSelector(selectLiveVitalsState);
  const activePatient = useActivePatientView();
  const activePatientId = activePatient?.patientId ?? null;
  const productionReadings = useAppSelector((state) =>
    selectProductionWearableReadingsForPatient(state, activePatientId),
  );

  const metrics = useMemo(
    () => buildMetrics(productionReadings, activePatientId),
    [activePatientId, productionReadings],
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

  if (vitals.status === "loading") {
    return (
      <CardShell title="Recent monitoring">
        <Text style={styles.stateText}>Loading recent monitoring readings...</Text>
      </CardShell>
    );
  }
  if (vitals.status === "error" || vitals.status === "unavailable" || !activePatientId) {
    return (
      <CardShell title="Recent monitoring">
        <Text style={styles.stateText}>Recent monitoring unavailable</Text>
      </CardShell>
    );
  }

  if (!selectedMetric) {
    return (
      <CardShell title="Recent monitoring">
        <Text style={styles.stateText}>No recent monitoring readings</Text>
      </CardShell>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.sectionTitle}>Recent monitoring</Text>
          <Text style={styles.subtitle}>{selectedMetric.subtitle}</Text>
        </View>

        <View style={styles.tabRow}>
          {metrics.map((metric) => {
            const active = metric.key === selectedMetric.key;

            return (
              <Pressable
                key={metric.key}
                style={[styles.tab, active && styles.tabActive]}
                accessibilityRole="button"
                accessibilityLabel={metric.label}
                onPress={() => setSelectedKey(metric.key)}
              >
                <Text style={[styles.tabIcon, active && styles.tabIconActive]}>
                  {metric.tabIcon}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.metricHelperText}>{selectedMetric.helperText}</Text>
      </View>

      <View style={styles.valueRow}>
        <Text style={styles.mainValue}>{selectedMetric.value}</Text>
        <Text style={styles.unit}>{selectedMetric.unit}</Text>
        <Text style={[styles.status, styles.statusGood]}>
          {selectedMetric.status}
        </Text>
      </View>

      <TrendChart readings={selectedMetric.readings} />

      {summaryMetrics.length > 0 ? (
        <>
          <View style={styles.divider} />

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
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function buildMetrics(
  readings: LiveVitalReading[],
  activePatientId: string | null,
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
        label: meta.label,
        value: formatReadingValue(latest, byType),
        unit: displayUnit(type, formatReadingUnit(latest, byType)),
        status: `Latest ${formatRelativeTime(latest.recordedAt)}`,
        statusTone: "good" as MetricTone,
        subtitle: formatReadingsSubtitle(sorted),
        helperText: meta.helperText,
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

function TrendChart({ readings }: { readings: LiveVitalReading[] }) {
  const [chartWidth, setChartWidth] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const values = readings.map((reading) => reading.value);

  const points = useMemo(() => {
    if (chartWidth <= 0 || values.length === 0) return [];

    const min = Math.min(...values);
    const max = Math.max(...values);
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
  }, [chartWidth, values]);

  const firstReading = readings[0];
  const lastReading = readings[readings.length - 1];
  const selectedPoint = selectedIndex !== null ? points[selectedIndex] : null;
  const selectedReading = selectedIndex !== null ? readings[selectedIndex] : null;

  return (
    <View style={styles.chartWrap}>
      <View style={styles.yAxis}>
        <Text style={styles.axisLabel}>{formatNumber(Math.max(...values))}</Text>
        <Text style={styles.axisLabel}>{formatNumber(Math.min(...values))}</Text>
      </View>

      <View style={styles.chartArea}>
        <View
          style={styles.plotArea}
          onLayout={(event) => {
            setChartWidth(event.nativeEvent.layout.width);
          }}
        >
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
                {
                  left: point.x - POINT_SIZE / 2,
                  top: point.y - POINT_SIZE / 2,
                },
                selectedIndex === index && styles.pointSelected,
              ]}
            />
          ))}

          {selectedPoint && selectedReading ? (
            <View
              pointerEvents="none"
              style={[
                styles.valueBubble,
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
                {formatNumber(selectedReading.value)}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.dayRow}>
          <Text style={styles.dayLabel}>
            {firstReading ? formatShortDate(firstReading.recordedAt) : ""}
          </Text>
          <Text style={styles.dayLabel}>
            {lastReading ? formatShortDate(lastReading.recordedAt) : ""}
          </Text>
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
  return (
    <View style={styles.smallStat}>
      <Text style={styles.smallStatLabel}>{label}</Text>
      <Text style={styles.smallStatValueRow}>
        <Text
          style={[
            styles.smallStatValue,
            tone === "critical" && styles.smallStatCritical,
            tone === "warning" && styles.smallStatWarning,
          ]}
        >
          {value}
        </Text>
        <Text style={styles.smallStatUnit}> {unit}</Text>
      </Text>
    </View>
  );
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "recently";

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatShortDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatReadingsSubtitle(readings: LiveVitalReading[]): string {
  const countLabel = `${readings.length} reading${readings.length === 1 ? "" : "s"}`;
  const dates = readings
    .map((reading) => {
      const timestamp = Date.parse(reading.recordedAt);
      return Number.isFinite(timestamp) ? new Date(timestamp) : null;
    })
    .filter((date): date is Date => date !== null);

  if (dates.length === 0) return "Latest readings";

  const today = new Date();
  if (dates.every((date) => isSameLocalDay(date, today))) {
    return `${countLabel} Today`;
  }

  const first = dates[0];
  const last = dates[dates.length - 1];
  const firstLabel = formatShortDate(first.toISOString());
  const lastLabel = formatShortDate(last.toISOString());

  if (!firstLabel || !lastLabel) return "Latest readings";
  if (firstLabel === lastLabel) return `${countLabel} ${lastLabel}`;
  return `${countLabel} ${firstLabel} - ${lastLabel}`;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
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
  point: {
    position: "absolute",
    width: POINT_SIZE,
    height: POINT_SIZE,
    borderRadius: POINT_SIZE / 2,
    backgroundColor: AppTheme.colors.brand,
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
