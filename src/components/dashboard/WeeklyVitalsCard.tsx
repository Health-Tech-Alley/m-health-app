import { useEffect, useMemo, useState } from "react";

import { DeviceEventEmitter, Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "@/constants/theme";
import { getHealthSampleForPatientAndCurrentMonth } from "@/data/repositories/healthSampleRepository";
import { HealthSampleType, Patient } from "@/data/types";

type VitalKey = "spo2" | "heartRate" | "respRate" | "mobility";
type TimeRange = "12h" | "day" | "week" | "month";

type VitalMetric = {
  key: HealthSampleType;
  tabIcon: string;
  label: string;
  value: string;
  unit: string;
  status: string;
  statusTone: "critical" | "warning" | "good";
  subtitle: string;
  helperText: string;
  data: number[];
};

const metrics: VitalMetric[] = [
  {
    key: "spo2",

    tabIcon: "\u{1FAC1}",
    label: "Oxygen Saturation",
    value: "84",
    unit: "%",
    status: "Down today \u2022 Critical",
    statusTone: "critical",
    subtitle: "Declining trend this week",
    helperText: "SpO2 estimates how much oxygen is in the blood.",

    data: [96, 95, 96, 94, 93, 92, 90],
  },
  {
    key: "heart_rate",
    tabIcon: "\u2764\uFE0F",
    label: "Heart Rate",
    value: "118",
    unit: "BPM",
    status: "Up today \u2022 Elevated",

    statusTone: "critical",
    subtitle: "Higher than baseline",
    helperText: "Heart rate shows beats per minute compared with baseline.",
    data: [82, 86, 88, 94, 98, 110, 118],
  },
  {
    key: "respiratory_rate",
    tabIcon: "\u{1F32C}\uFE0F",
    label: "Respiratory Rate",
    value: "32",
    unit: "br/min",
    status: "Up today \u2022 Elevated",

    statusTone: "warning",
    subtitle: "Breathing faster than usual",
    helperText: "Respiratory rate counts breaths per minute.",
    data: [20, 21, 23, 24, 26, 29, 32],
  },
  {
    key: "steps",
    tabIcon: "\u{1F6B6}",
    label: "Mobility Score",
    value: "55",
    unit: "/100",
    status: "Down today \u2022 Lower",

    statusTone: "warning",
    subtitle: "Movement below expected pattern",
    helperText: "Mobility reflects movement compared with the usual pattern.",
    data: [82, 78, 74, 72, 68, 61, 55],
  },
];

const timeRanges: { key: TimeRange; label: string }[] = [
  { key: "12h", label: "12h" },
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

const days = ["M", "T", "W", "Th", "F", "Sa", "Su"];
const CHART_HEIGHT = 88;
const POINT_SIZE = 13;

export function WeeklyVitalsCard() {
  const [selectedKey, setSelectedKey] = useState<HealthSampleType>("spo2");
  const [selectedRange, setSelectedRange] = useState<TimeRange>("week");
  const [helperKey, setHelperKey] = useState<HealthSampleType>("spo2");
  const [currentPatient, setCurrentPatient] = useState<Patient | null>(null);
  const [fhirData, setFhirData] = useState<any>(null);
  const [chartMetrics, setChartMetrics] = useState<VitalMetric[]>([]);

  // load current patient on load
  useEffect(() => {
    const patient = null;
    setCurrentPatient(patient);
  }, []);

  const selectedMetric =
    metrics.find((metric) => metric.key === selectedKey) ?? chartMetrics[0];
  const helperMetric =
    metrics.find((metric) => metric.key === helperKey) ?? selectedMetric;

  const heartRate = metrics.find((metric) => metric.key === "heart_rate");
  const respRate = metrics.find((metric) => metric.key === "respiratory_rate");

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.sectionTitle}>Weekly Vitals</Text>
          <Text style={styles.subtitle}>{selectedMetric?.subtitle}</Text>
        </View>

        <View style={styles.tabRow}>
          {metrics.map((metric) => {
            const active = metric.key === selectedKey;

            return (
              <Pressable
                key={metric.key}
                style={[styles.tab, active && styles.tabActive]}
                accessibilityRole="button"
                accessibilityLabel={metric.label}
                onPress={() => {
                  setSelectedKey(metric.key);
                  setHelperKey(metric.key);
                }}
              >
                <Text style={[styles.tabIcon, active && styles.tabIconActive]}>
                  {metric.tabIcon}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.metricHelperText}>{helperMetric?.helperText}</Text>
      </View>

      <View style={styles.valueRow}>
        <Text style={styles.mainValue}>{selectedMetric?.value}</Text>
        <Text style={styles.unit}>{selectedMetric?.unit}</Text>
        <Text
          style={[
            styles.status,
            selectedMetric?.statusTone === "critical" && styles.statusCritical,
            selectedMetric?.statusTone === "warning" && styles.statusWarning,
            selectedMetric?.statusTone === "good" && styles.statusGood,
          ]}
        >
          {selectedMetric?.status}
        </Text>
      </View>

      <View style={styles.rangeRow}>
        {timeRanges.map((range) => {
          const active = range.key === selectedRange;

          return (
            <Pressable
              key={range.key}
              style={[styles.rangePill, active && styles.rangePillActive]}
              onPress={() => setSelectedRange(range.key)}
            >
              <Text
                style={[
                  styles.rangePillText,
                  active && styles.rangePillTextActive,
                ]}
              >
                {range.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TrendChart values={selectedMetric?.data} />

      <View style={styles.divider} />

      <View style={styles.bottomStats}>
        <SmallStat
          label="Heart Rate"
          value={heartRate?.value ?? "118"}
          unit={heartRate?.unit ?? "BPM"}
          tone="critical"
        />

        <SmallStat
          label="Resp. Rate"
          value={respRate?.value ?? "32"}
          unit={respRate?.unit ?? "br/min"}
          tone="purple"
        />
      </View>
    </View>
  );
}

function TrendChart({ values }: { values: number[] }) {
  const [chartWidth, setChartWidth] = useState(0);

  const points = useMemo(() => {
    if (chartWidth <= 0 || !values || values.length === 0) return [];

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

  return (
    <View style={styles.chartWrap}>
      <View style={styles.yAxis}>
        <Text style={styles.axisLabel}>100</Text>
        <Text style={styles.axisLabel}>50</Text>
        <Text style={styles.axisLabel}>0</Text>
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
                key={`segment-${index}`}
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
            <View
              key={`point-${index}`}
              style={[
                styles.point,
                {
                  left: point.x - POINT_SIZE / 2,
                  top: point.y - POINT_SIZE / 2,
                },
              ]}
            />
          ))}
        </View>

        <View style={styles.dayRow}>
          {days.map((day) => (
            <Text key={day} style={styles.dayLabel}>
              {day}
            </Text>
          ))}
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
  tone: "critical" | "purple" | "good";
}) {
  return (
    <View style={styles.smallStat}>
      <Text style={styles.smallStatLabel}>{label}</Text>
      <Text style={styles.smallStatValueRow}>
        <Text
          style={[
            styles.smallStatValue,
            tone === "critical" && styles.smallStatCritical,
            tone === "purple" && styles.smallStatPurple,
          ]}
        >
          {value}
        </Text>
        <Text style={styles.smallStatUnit}> {unit}</Text>
      </Text>
    </View>
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
    gap: 10,
  },
  tab: {
    flex: 1,
    minHeight: 68,
    borderRadius: 20,
    backgroundColor: AppTheme.colors.softSurface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: AppTheme.colors.brand,
    ...AppTheme.shadow,
  },
  tabIcon: {
    color: AppTheme.colors.textSoft,
    fontSize: 36,
    lineHeight: 42,
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
  rangeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  rangePill: {
    borderRadius: AppTheme.radius.pill,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  rangePillActive: {
    backgroundColor: AppTheme.colors.brandSoft,
  },
  rangePillText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: "900",
  },
  rangePillTextActive: {
    color: AppTheme.colors.brand,
  },

  chartWrap: {
    flexDirection: "row",
    minHeight: 112,
  },
  yAxis: {
    width: 30,
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
    fontSize: 17,
    fontWeight: "900",
  },
  smallStatCritical: {
    color: AppTheme.colors.danger,
  },
  smallStatPurple: {
    color: AppTheme.colors.purple,
  },
  smallStatUnit: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
});
