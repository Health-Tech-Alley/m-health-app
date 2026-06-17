import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "@/constants/theme";

type VitalKey = "spo2" | "heartRate" | "respRate" | "mobility";

type VitalMetric = {
  key: VitalKey;
  tabLabel: string;
  label: string;
  value: string;
  unit: string;
  status: string;
  statusTone: "critical" | "warning" | "good";
  subtitle: string;
  data: number[];
};

const metrics: VitalMetric[] = [
  {
    key: "spo2",
    tabLabel: "SpO₂",
    label: "Oxygen Saturation",
    value: "84",
    unit: "%",
    status: "↓ Today · Critical",
    statusTone: "critical",
    subtitle: "Declining trend this week",
    data: [96, 95, 96, 94, 93, 92, 90],
  },
  {
    key: "heartRate",
    tabLabel: "Heart Rate",
    label: "Heart Rate",
    value: "118",
    unit: "BPM",
    status: "↑ Today · Elevated",
    statusTone: "critical",
    subtitle: "Higher than baseline",
    data: [82, 86, 88, 94, 98, 110, 118],
  },
  {
    key: "respRate",
    tabLabel: "Resp. Rate",
    label: "Respiratory Rate",
    value: "32",
    unit: "br/min",
    status: "↑ Today · Elevated",
    statusTone: "warning",
    subtitle: "Breathing faster than usual",
    data: [20, 21, 23, 24, 26, 29, 32],
  },
  {
    key: "mobility",
    tabLabel: "Mobility",
    label: "Mobility Score",
    value: "55",
    unit: "/100",
    status: "↓ Today · Lower",
    statusTone: "warning",
    subtitle: "Movement below expected pattern",
    data: [82, 78, 74, 72, 68, 61, 55],
  },
];

const days = ["M", "T", "W", "Th", "F", "Sa", "Su"];
const CHART_HEIGHT = 88;
const POINT_SIZE = 13;

export function WeeklyVitalsCard() {
  const [selectedKey, setSelectedKey] = useState<VitalKey>("spo2");

  const selectedMetric =
    metrics.find((metric) => metric.key === selectedKey) ?? metrics[0];

  const heartRate = metrics.find((metric) => metric.key === "heartRate");
  const respRate = metrics.find((metric) => metric.key === "respRate");

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.sectionTitle}>Weekly Vitals</Text>
          <Text style={styles.subtitle}>{selectedMetric.subtitle}</Text>
        </View>

        <View style={styles.tabRow}>
          {metrics.map((metric) => {
            const active = metric.key === selectedKey;

            return (
              <Pressable
                key={metric.key}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setSelectedKey(metric.key)}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {metric.tabLabel}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.valueRow}>
        <Text style={styles.mainValue}>{selectedMetric.value}</Text>
        <Text style={styles.unit}>{selectedMetric.unit}</Text>
        <Text
          style={[
            styles.status,
            selectedMetric.statusTone === "critical" && styles.statusCritical,
            selectedMetric.statusTone === "warning" && styles.statusWarning,
            selectedMetric.statusTone === "good" && styles.statusGood,
          ]}
        >
          {selectedMetric.status}
        </Text>
      </View>

      <TrendChart values={selectedMetric.data} />

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
    if (chartWidth <= 0 || values.length === 0) return [];

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, 1);

    return values.map((value, index) => {
      const x =
        values.length === 1 ? chartWidth / 2 : (index / (values.length - 1)) * chartWidth;

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
  tone: "critical" | "purple";
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
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: AppTheme.colors.softSurface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  tabActive: {
    backgroundColor: AppTheme.colors.brand,
    ...AppTheme.shadow,
  },
  tabText: {
    color: AppTheme.colors.textSoft,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  tabTextActive: {
    color: AppTheme.colors.white,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 16,
    flexWrap: "wrap",
  },
  mainValue: {
    color: AppTheme.colors.brandDark,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -0.5,
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