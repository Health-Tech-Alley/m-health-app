import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppTheme } from "@/constants/theme";
import {
  getDashboardPatientSummary,
  getFallbackDashboardPatientSummary,
  type DashboardPatientSummary,
} from "@/services/patient/patientService";

export function PatientSummaryCard() {
  const [summary, setSummary] = useState<DashboardPatientSummary>(() =>
    getFallbackDashboardPatientSummary(),
  );

  useEffect(() => {
    let isMounted = true;

    getDashboardPatientSummary().then((nextSummary) => {
      if (isMounted) {
        setSummary(nextSummary);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{summary.patientInitials}</Text>
        </View>

        <View style={styles.patientTextBlock}>
          <View style={styles.nameRow}>
            <Text style={styles.patientName}>{summary.patientName}</Text>

            {summary.comorbidityCount > 0 ? (
              <View style={styles.comorbidityBadge}>
                <Text style={styles.comorbidityBadgeText}>
                  Comorbidities
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.patientMeta}>
            Age {summary.patientAge} · PCP {summary.providerName}
          </Text>
        </View>
      </View>

      <View style={styles.diagnosisBox}>
        <Text style={styles.diagnosisLabel}>Primary diagnosis</Text>
        <Text style={styles.diagnosisText}>{summary.primaryDiagnosis}</Text>
      </View>

      <View style={styles.infoGrid}>
        <InfoBox label="SpO₂ cutoff" value={summary.spo2Cutoff} />
        <InfoBox label="Baseline HR" value={summary.baselineHeartRate} />
      </View>

      <View style={styles.footerRow}>
        <View>
          <Text style={styles.footerLabel}>Caregiver</Text>
          <Text style={styles.footerValue}>
            {summary.caregiverName} · {summary.caregiverRelationship}
          </Text>
        </View>

        <View style={styles.monitoringPill}>
          <Text style={styles.monitoringText}>Monitoring Active</Text>
        </View>
      </View>
    </View>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoBox}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    padding: 22,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    ...AppTheme.shadow,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  avatarText: {
    color: AppTheme.colors.brand,
    fontSize: 20,
    fontWeight: "900",
  },
  patientTextBlock: {
    flex: 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  patientName: {
    color: AppTheme.colors.text,
    fontSize: 22,
    fontWeight: "900",
  },
  patientMeta: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
  },
  comorbidityBadge: {
    backgroundColor: AppTheme.colors.warningSoft,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  comorbidityBadgeText: {
    color: AppTheme.colors.warning,
    fontSize: 11,
    fontWeight: "900",
  },
  diagnosisBox: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  diagnosisLabel: {
    color: AppTheme.colors.sectionText,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  diagnosisText: {
    color: AppTheme.colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "900",
  },
  infoGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 18,
  },
  infoBox: {
    flex: 1,
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 16,
    padding: 14,
  },
  infoLabel: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 4,
  },
  infoValue: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  footerRow: {
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    paddingTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  footerLabel: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: "800",
  },
  footerValue: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 2,
  },
  monitoringPill: {
    backgroundColor: AppTheme.colors.brand,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  monitoringText: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: "900",
  },
});
