import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "@/constants/theme";

type VitalKey = "spo2" | "heartRate" | "respRate";

const vitalData = {
  spo2: {
    label: "SpO₂",
    value: "84",
    unit: "%",
    color: AppTheme.colors.brand,
    maxLabel: "100",
    midLabel: "50",
    lowLabel: "0",
    chartMax: 100,
    trend: [86, 85, 85, 84, 83, 82, 80],
    footerLeftLabel: "Heart Rate",
    footerLeftValue: "118 BPM",
    footerRightLabel: "Resp. Rate",
    footerRightValue: "32 br/min",
  },
  heartRate: {
    label: "Heart Rate",
    value: "118",
    unit: "BPM",
    color: AppTheme.colors.danger,
    maxLabel: "120",
    midLabel: "60",
    lowLabel: "0",
    chartMax: 120,
    trend: [78, 82, 80, 88, 94, 104, 118],
    footerLeftLabel: "SpO₂",
    footerLeftValue: "84%",
    footerRightLabel: "Resp. Rate",
    footerRightValue: "32 br/min",
  },
  respRate: {
    label: "Resp. Rate",
    value: "32",
    unit: "br/min",
    color: AppTheme.colors.purple,
    maxLabel: "32",
    midLabel: "16",
    lowLabel: "0",
    chartMax: 32,
    trend: [18, 19, 20, 22, 25, 28, 32],
    footerLeftLabel: "SpO₂",
    footerLeftValue: "84%",
    footerRightLabel: "Heart Rate",
    footerRightValue: "118 BPM",
  },
} as const;

const days = ["M", "T", "W", "Th", "F", "Sa", "Su"];

export function WeeklyVitalsCard() {
  const [activeVital, setActiveVital] = useState<VitalKey>("spo2");
  const current = vitalData[activeVital];

  const normalizedPoints = useMemo(() => {
    return current.trend.map((value) => {
      const ratio = value / current.chartMax;
      return 58 - ratio * 46;
    });
  }, [current]);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.sectionLabel}>Weekly Vitals</Text>
          <Text style={styles.subtitle}>Declining trend this week</Text>
        </View>

        <View style={styles.tabRow}>
          <VitalTab
            label="SpO₂"
            active={activeVital === "spo2"}
            color={vitalData.spo2.color}
            onPress={() => setActiveVital("spo2")}
          />

          <VitalTab
            label="Heart Rate"
            active={activeVital === "heartRate"}
            color={vitalData.heartRate.color}
            onPress={() => setActiveVital("heartRate")}
          />

          <VitalTab
            label="Resp. Rate"
            active={activeVital === "respRate"}
            color={vitalData.respRate.color}
            onPress={() => setActiveVital("respRate")}
          />
        </View>
      </View>

      <View style={styles.metricRow}>
        <Text style={[styles.primaryValue, { color: current.color }]}>
          {current.value}
        </Text>

        <Text style={styles.unit}>{current.unit}</Text>
        <Text style={styles.criticalText}>↓ Today · Critical</Text>
      </View>

      <View style={styles.chart}>
        <View style={styles.axisLabels}>
          <Text style={styles.axisText}>{current.maxLabel}</Text>
          <Text style={styles.axisText}>{current.midLabel}</Text>
          <Text style={styles.axisText}>{current.lowLabel}</Text>
        </View>

        <View style={styles.chartArea}>
          <View
            style={[
              styles.chartLine,
              {
                backgroundColor: current.color,
                top: normalizedPoints[3],
              },
            ]}
          />

          {normalizedPoints.map((top, index) => (
            <View
              key={`${activeVital}-${days[index]}`}
              style={[
                styles.dot,
                {
                  backgroundColor: current.color,
                  left: `${index * 16.3}%`,
                  top,
                },
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.dayRow}>
        {days.map((day) => (
          <Text key={day} style={styles.dayText}>
            {day}
          </Text>
        ))}
      </View>

      <View style={styles.divider} />

      <View style={styles.footerMetrics}>
        <View>
          <Text style={styles.footerLabel}>{current.footerLeftLabel}</Text>
          <Text
            style={[
              styles.footerValue,
              { color: getFooterColor(current.footerLeftLabel) },
            ]}
          >
            {current.footerLeftValue}
          </Text>
        </View>

        <View>
          <Text style={styles.footerLabel}>{current.footerRightLabel}</Text>
          <Text
            style={[
              styles.footerValue,
              { color: getFooterColor(current.footerRightLabel) },
            ]}
          >
            {current.footerRightValue}
          </Text>
        </View>
      </View>
    </View>
  );
}

function VitalTab({
  label,
  active,
  color,
  onPress,
}: {
  label: string;
  active: boolean;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.tab,
        active && {
          backgroundColor: color,
          shadowColor: color,
          shadowOpacity: 0.25,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
        },
      ]}
      onPress={onPress}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function getFooterColor(label: string): string {
  if (label.includes("SpO")) return AppTheme.colors.brand;
  if (label.includes("Heart")) return AppTheme.colors.danger;
  return AppTheme.colors.purple;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    padding: 24,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    ...AppTheme.shadow,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  titleBlock: {
    flex: 1,
  },
  sectionLabel: {
    color: AppTheme.colors.sectionText,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  subtitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 16,
    lineHeight: 22,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
  },
  tab: {
    width: 58,
    minHeight: 52,
    borderRadius: 17,
    backgroundColor: AppTheme.colors.softSurface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  tabText: {
    color: AppTheme.colors.textSoft,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
  },
  tabTextActive: {
    color: AppTheme.colors.white,
  },
  metricRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 28,
  },
  primaryValue: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "900",
  },
  unit: {
    color: AppTheme.colors.textMuted,
    fontSize: 17,
    fontWeight: "700",
    marginLeft: 8,
    marginBottom: 4,
  },
  criticalText: {
    color: AppTheme.colors.danger,
    fontSize: 16,
    fontWeight: "800",
    marginLeft: 14,
    marginBottom: 4,
  },
  chart: {
    flexDirection: "row",
    marginTop: 20,
    height: 80,
  },
  axisLabels: {
    width: 30,
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  axisText: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
  },
  chartArea: {
    flex: 1,
    position: "relative",
    marginLeft: 8,
  },
  chartLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
  },
  dot: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginLeft: 38,
    marginTop: 4,
  },
  dayText: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
  },
  divider: {
    height: 1,
    backgroundColor: AppTheme.colors.border,
    marginTop: 26,
    marginBottom: 18,
  },
  footerMetrics: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingRight: 72,
  },
  footerLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  footerValue: {
    fontSize: 17,
    fontWeight: "900",
  },
});