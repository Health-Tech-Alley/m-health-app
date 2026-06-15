/**
 * Performance / RAM dashboard.
 *
 * Shows a live, 1 Hz device-RAM snapshot with the loaded SLM's footprint
 * carved out of the "used" bucket so the caregiver (or developer) can see
 * how much of the phone's RAM the on-device model is responsible for.
 *
 * The screen is safe to open on Track A (Expo Go): the underlying native
 * memory bridge is absent there, and the snapshot falls back to a mock
 * module that varies slightly over time so the UI still has data to render.
 */

import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSLM } from "@/contexts/slm-context";
import {
  formatRam,
  ramSeverity,
  useRamSnapshot,
  type RamSeverity as Severity,
} from "@/services/performance/performanceService";

const SEVERITY_COLOR: Record<Severity, string> = {
  ok: "#0E6F68",
  warn: "#B54708",
  crit: "#B42318",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  ok: "Healthy",
  warn: "Elevated",
  crit: "Critical",
};

const POLL_INTERVAL_MS = 1000;

export default function PerformanceScreen() {
  const router = useRouter();
  const { loadStatus, currentModelId, modelSizeGB } = useSLM();

  const snapshot = useRamSnapshot(POLL_INTERVAL_MS, modelSizeGB);

  const isModelLoaded = loadStatus === "ready" && modelSizeGB !== null;
  const severity: Severity = snapshot ? ramSeverity(snapshot.usedRatio) : "ok";
  const severityColor = SEVERITY_COLOR[severity];
  const severityLabel = SEVERITY_LABEL[severity];

  const slmPercent = useMemo(() => {
    if (!snapshot || snapshot.totalMB <= 0) return 0;
    return Math.min(100, (snapshot.slmMB / snapshot.totalMB) * 100);
  }, [snapshot]);

  const otherPercent = useMemo(() => {
    if (!snapshot || snapshot.totalMB <= 0) return 0;
    return Math.min(100 - slmPercent, (snapshot.otherMB / snapshot.totalMB) * 100);
  }, [snapshot, slmPercent]);

  const usedPercent = useMemo(() => {
    if (!snapshot || snapshot.totalMB <= 0) return 0;
    return Math.min(100, (snapshot.usedMB / snapshot.totalMB) * 100);
  }, [snapshot]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Performance</Text>
          <View style={styles.backButtonSpacer} />
        </View>

        <View style={styles.headerCard}>
          <Text style={styles.eyebrow}>Live · 1 Hz</Text>
          <Text style={styles.title}>RAM & Device Load</Text>
          <Text style={styles.subtitle}>
            Total vs. used memory, with the on-device SLM model carved out so
            you can see exactly how much of the phone&apos;s RAM it owns.
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <View>
              <Text style={styles.cardTitle}>Device RAM</Text>
              <Text style={styles.cardSubtitle}>
                {snapshot
                  ? `Updated ${formatRelative(snapshot.timestamp)}`
                  : "Reading memory…"}
              </Text>
            </View>
            <View
              style={[
                styles.severityPill,
                { backgroundColor: severityColor + "20" },
              ]}>
              <View
                style={[
                  styles.severityDot,
                  { backgroundColor: severityColor },
                ]}
              />
              <Text style={[styles.severityText, { color: severityColor }]}>
                {snapshot ? severityLabel : "—"}
              </Text>
            </View>
          </View>

          <View style={styles.bigNumberRow}>
            <View style={styles.bigNumberColumn}>
              <Text style={styles.bigNumber}>
                {snapshot ? formatRam(snapshot.usedMB) : "—"}
              </Text>
              <Text style={styles.bigNumberLabel}>Used</Text>
            </View>
            <View style={styles.bigNumberDivider} />
            <View style={styles.bigNumberColumn}>
              <Text style={styles.bigNumber}>
                {snapshot ? formatRam(snapshot.freeMB) : "—"}
              </Text>
              <Text style={styles.bigNumberLabel}>Free</Text>
            </View>
            <View style={styles.bigNumberDivider} />
            <View style={styles.bigNumberColumn}>
              <Text style={styles.bigNumberMuted}>
                {snapshot ? formatRam(snapshot.totalMB) : "—"}
              </Text>
              <Text style={styles.bigNumberLabel}>Total</Text>
            </View>
          </View>

          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${usedPercent}%`,
                  backgroundColor: severityColor,
                },
              ]}
            />
            {isModelLoaded && snapshot ? (
              <View
                style={[
                  styles.progressBarSegment,
                  {
                    left: `${otherPercent}%`,
                    width: `${slmPercent}%`,
                    backgroundColor: "#0E6F68",
                  },
                ]}
              />
            ) : null}
          </View>
          <Text style={styles.usedPercentText}>
            {snapshot
              ? `${(snapshot.usedRatio * 100).toFixed(1)}% of total RAM in use`
              : ""}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Used RAM Breakdown</Text>
          <Text style={styles.cardSubtitle}>
            Of the {snapshot ? formatRam(snapshot.usedMB) : "—"} currently in
            use, how much belongs to the on-device SLM model vs. everything
            else (system, foreground app, and other apps).
          </Text>

          <View style={styles.legend}>
            <View style={styles.legendRow}>
              <View
                style={[styles.legendSwatch, { backgroundColor: "#0E6F68" }]}
              />
              <Text style={styles.legendLabel}>SLM model</Text>
              <Text style={styles.legendValue}>
                {snapshot ? formatRam(snapshot.slmMB) : "—"}
              </Text>
            </View>
            <View style={styles.legendRow}>
              <View
                style={[
                  styles.legendSwatch,
                  { backgroundColor: severityColor },
                ]}
              />
              <Text style={styles.legendLabel}>Other (system + apps)</Text>
              <Text style={styles.legendValue}>
                {snapshot ? formatRam(snapshot.otherMB) : "—"}
              </Text>
            </View>
          </View>

          <View style={styles.stackedBarBg}>
            <View
              style={[
                styles.stackedBarFill,
                {
                  width: `${otherPercent}%`,
                  backgroundColor: severityColor,
                },
              ]}
            />
            <View
              style={[
                styles.stackedBarFill,
                {
                  width: `${slmPercent}%`,
                  backgroundColor: "#0E6F68",
                },
              ]}
            />
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>App (foreground)</Text>
            <Text style={styles.detailValue}>
              {snapshot
                ? snapshot.hasNativeMemory
                  ? formatRam(snapshot.appMB)
                  : "n/a (Expo Go)"
                : "—"}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>SLM Status</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>State</Text>
            <Text style={styles.detailValue}>{loadStatus}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Model</Text>
            <Text style={styles.detailValue}>
              {currentModelId ?? "none loaded"}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Model size on disk</Text>
            <Text style={styles.detailValue}>
              {modelSizeGB !== null ? formatRam(modelSizeGB * 1024) : "—"}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Native memory bridge</Text>
            <Text style={styles.detailValue}>
              {snapshot ? (snapshot.hasNativeMemory ? "yes" : "no (mock)") : "—"}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "just now";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 1) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.round(diffSec / 60);
  return `${min}m ago`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#EEF7F6",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
    gap: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    paddingVertical: 8,
    paddingRight: 12,
    minWidth: 80,
  },
  backButtonSpacer: {
    minWidth: 80,
  },
  backText: {
    color: "#0E6F68",
    fontWeight: "700",
    fontSize: 15,
  },
  headerTitle: {
    color: "#123433",
    fontSize: 17,
    fontWeight: "800",
  },
  headerCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 22,
  },
  eyebrow: {
    color: "#0E6F68",
    fontWeight: "800",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontSize: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: "#123433",
    marginBottom: 8,
  },
  subtitle: {
    color: "#526866",
    fontSize: 14,
    lineHeight: 20,
  },
  summaryCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 22,
    gap: 16,
  },
  summaryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#123433",
    marginBottom: 6,
  },
  cardSubtitle: {
    color: "#526866",
    fontSize: 13,
    lineHeight: 19,
  },
  severityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  severityText: {
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  bigNumberRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  bigNumberColumn: {
    flex: 1,
    alignItems: "flex-start",
  },
  bigNumberDivider: {
    width: StyleSheet.hairlineWidth,
    height: 36,
    backgroundColor: "#12343320",
    marginHorizontal: 12,
  },
  bigNumber: {
    fontSize: 26,
    fontWeight: "900",
    color: "#123433",
  },
  bigNumberMuted: {
    fontSize: 22,
    fontWeight: "700",
    color: "#526866",
  },
  bigNumberLabel: {
    color: "#526866",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 4,
    fontWeight: "700",
  },
  progressBarBg: {
    height: 10,
    backgroundColor: "#12343310",
    borderRadius: 5,
    overflow: "hidden",
    position: "relative",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 5,
  },
  progressBarSegment: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: 5,
  },
  usedPercentText: {
    color: "#526866",
    fontSize: 13,
    fontWeight: "600",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 22,
    gap: 14,
  },
  legend: {
    gap: 8,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  legendLabel: {
    flex: 1,
    color: "#123433",
    fontSize: 14,
    fontWeight: "600",
  },
  legendValue: {
    color: "#123433",
    fontSize: 14,
    fontWeight: "800",
  },
  stackedBarBg: {
    height: 14,
    backgroundColor: "#12343310",
    borderRadius: 7,
    overflow: "hidden",
    flexDirection: "row",
  },
  stackedBarFill: {
    height: "100%",
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#12343315",
  },
  detailLabel: {
    color: "#526866",
    fontSize: 14,
  },
  detailValue: {
    color: "#123433",
    fontSize: 14,
    fontWeight: "700",
  },
});
