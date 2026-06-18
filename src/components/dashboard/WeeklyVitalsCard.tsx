import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "@/constants/theme";
import { usePatientRecord } from "@/contexts/patient-record-context";

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
  yAxisMax: number;
  yAxisMin: number;
};

// ---------------------------------------------------------------------------
// Threshold parsing — pulls the patient's configured cutoffs/baselines so the
// dashboard trend is clinically consistent with the care context instead of
// arbitrary numbers.
// ---------------------------------------------------------------------------

function parseSpO2Cutoff(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseHrBaseline(raw: string | undefined | null): { low: number; high: number } | null {
  if (!raw) return null;
  const nums = raw.match(/\d+/g);
  if (!nums || nums.length < 2) {
    const single = nums ? parseInt(nums[0], 10) : null;
    return single ? { low: single, high: single } : null;
  }
  return { low: parseInt(nums[0], 10), high: parseInt(nums[1], 10) };
}

/**
 * Build a 7-day trend for each vital. Values stay near the patient's
 * configured baseline for the first 5 days, then trend toward the threshold
 * on day 6 and breach on day 7 (today) — reflecting the active alert. This is
 * deterministic (no RNG) so the chart is stable across renders.
 */
function buildMetrics(
  spo2Cutoff: number | null,
  hrBaseline: { low: number; high: number } | null,
): VitalMetric[] {
  const spo2Base = spo2Cutoff ?? 88; // percent — values stay above cutoff until today
  const hrLow = hrBaseline?.low ?? 72;
  const hrHigh = hrBaseline?.high ?? 88;
  const rrBase = 18; // br/min — normal adult resting RR

  // SpO2: 5 days slightly above cutoff, day 6 borderline, day 7 below (breach).
  const spo2Today = Math.max(82, spo2Base - 4);
  const spo2Data = [
    spo2Base + 4,
    spo2Base + 3,
    spo2Base + 4,
    spo2Base + 2,
    spo2Base + 1,
    spo2Base,
    spo2Today,
  ];

  // Heart rate: baseline band then climbs above the high end today.
  const hrToday = hrHigh + 28;
  const hrData = [
    hrLow + 2,
    hrHigh - 2,
    hrHigh,
    hrHigh + 4,
    hrHigh + 10,
    hrHigh + 22,
    hrToday,
  ];

  // Respiratory rate: normal (~18) then elevates today.
  const rrToday = 30;
  const rrData = [rrBase, rrBase + 1, rrBase + 2, rrBase + 3, rrBase + 5, rrBase + 8, rrToday];

  // Mobility score: stable baseline then dips today (matches the non-emergency insight).
  const mobilityBase = 80;
  const mobilityToday = 55;
  const mobilityData = [
    mobilityBase,
    mobilityBase - 2,
    mobilityBase - 4,
    mobilityBase - 6,
    mobilityBase - 8,
    mobilityBase - 15,
    mobilityToday,
  ];

  const spo2StatusTone: VitalMetric["statusTone"] = spo2Today < (spo2Cutoff ?? 88) ? "critical" : "warning";
  const hrStatusTone: VitalMetric["statusTone"] = hrToday > hrHigh + 20 ? "critical" : "warning";

  return [
    {
      key: "spo2",
      tabLabel: "SpO₂",
      label: "Oxygen Saturation",
      value: String(spo2Today),
      unit: "%",
      status: `↓ Today · ${spo2StatusTone === "critical" ? "Critical" : "Below cutoff"}`,
      statusTone: spo2StatusTone,
      subtitle: spo2Cutoff ? `Cutoff ${spo2Cutoff}% · declining trend` : "Declining trend this week",
      data: spo2Data,
      yAxisMax: 100,
      yAxisMin: Math.min(80, spo2Today - 2),
    },
    {
      key: "heartRate",
      tabLabel: "Heart Rate",
      label: "Heart Rate",
      value: String(hrToday),
      unit: "BPM",
      status: `↑ Today · ${hrStatusTone === "critical" ? "Critical" : "Elevated"}`,
      statusTone: hrStatusTone,
      subtitle: hrBaseline ? `Baseline ${hrBaseline.low}–${hrBaseline.high} BPM · climbing` : "Higher than baseline",
      data: hrData,
      yAxisMax: Math.max(130, hrToday + 10),
      yAxisMin: Math.min(60, hrLow - 10),
    },
    {
      key: "respRate",
      tabLabel: "Resp. Rate",
      label: "Respiratory Rate",
      value: String(rrToday),
      unit: "br/min",
      status: "↑ Today · Elevated",
      statusTone: "warning",
      subtitle: "Breathing faster than usual",
      data: rrData,
      yAxisMax: Math.max(36, rrToday + 4),
      yAxisMin: 12,
    },
    {
      key: "mobility",
      tabLabel: "Mobility",
      label: "Mobility Score",
      value: String(mobilityToday),
      unit: "/100",
      status: "↓ Today · Lower",
      statusTone: "warning",
      subtitle: "Movement below expected pattern",
      data: mobilityData,
      yAxisMax: 100,
      yAxisMin: 40,
    },
  ];
}

const days = ["M", "T", "W", "Th", "F", "Sa", "Su"];
const CHART_HEIGHT = 88;
const POINT_SIZE = 13;

export function WeeklyVitalsCard() {
  const { snapshot } = usePatientRecord();
  const [selectedKey, setSelectedKey] = useState<VitalKey>("spo2");

  const metrics = useMemo<VitalMetric[]>(() => {
    const spo2Cutoff = parseSpO2Cutoff(snapshot?.patient?.spo2Cutoff);
    const hrBaseline = parseHrBaseline(snapshot?.patient?.baselineHeartRate);
    return buildMetrics(spo2Cutoff, hrBaseline);
  }, [snapshot?.patient?.spo2Cutoff, snapshot?.patient?.baselineHeartRate]);

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

      <TrendChart
        values={selectedMetric.data}
        yMax={selectedMetric.yAxisMax}
        yMin={selectedMetric.yAxisMin}
      />

      <View style={styles.divider} />

      <View style={styles.bottomStats}>
        <SmallStat
          label="Heart Rate"
          value={heartRate?.value ?? "—"}
          unit={heartRate?.unit ?? "BPM"}
          tone="critical"
        />

        <SmallStat
          label="Resp. Rate"
          value={respRate?.value ?? "—"}
          unit={respRate?.unit ?? "br/min"}
          tone="purple"
        />
      </View>
    </View>
  );
}

function TrendChart({
  values,
  yMax,
  yMin,
}: {
  values: number[];
  yMax: number;
  yMin: number;
}) {
  const [chartWidth, setChartWidth] = useState(0);

  const points = useMemo(() => {
    if (chartWidth <= 0 || values.length === 0) return [];

    const min = Math.min(yMin, ...values);
    const max = Math.max(yMax, ...values);
    const range = Math.max(max - min, 1);

    return values.map((value, index) => {
      const x =
        values.length === 1 ? chartWidth / 2 : (index / (values.length - 1)) * chartWidth;

      const normalized = (value - min) / range;
      const y = CHART_HEIGHT - normalized * (CHART_HEIGHT - 12) - 6;

      return { x, y };
    });
  }, [chartWidth, values, yMax, yMin]);

  const midLabel = Math.round((yMax + yMin) / 2);

  return (
    <View style={styles.chartWrap}>
      <View style={styles.yAxis}>
        <Text style={styles.axisLabel}>{yMax}</Text>
        <Text style={styles.axisLabel}>{midLabel}</Text>
        <Text style={styles.axisLabel}>{yMin}</Text>
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
                index === points.length - 1 && styles.pointLast,
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
  pointLast: {
    backgroundColor: AppTheme.colors.danger,
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
