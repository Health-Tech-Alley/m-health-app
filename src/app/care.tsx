import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import {
  getActiveCareAlerts,
  resolveCareAlert,
  type CareAlert,
} from "@/services/care/careService";
import { getOnboardingProfile } from "@/services/onboarding/onboardingService";
import { getFallbackDashboardPatientSummary } from "@/services/patient/patientService";

const dailyCareEntry = {
  patient_id: "patient_12345",
  care_plan_id: "careplan_abc123",
  entry_date: "2026-06-15",
  therapy_day: 21,
  logged_by: {
    user_id: "caregiver_67890",
    role: "caregiver",
    relationship: "spouse",
  },
  therapy_completed: true,
  sets_completed: 3,
  recommended_sets: 3,
  pain_before: 3,
  pain_after: 4,
  fatigue: 5,
  assistance_required: "some",
  caregiver_concern: false,
  functional_task_score: 2.6,
  guided_movement_score: 55,
  notes:
    "Completed all exercises but shoulder movement looked about the same as last week.",
};

const providerCarePlan = {
  condition: "post_stroke_rehabilitation",
  therapy_focus: "upper_extremity_shoulder_rom",
  therapy_start_date: "2026-05-26",
  current_therapy_week: 3,
  affected_side: "left",
  assigned_therapist: {
    name: "Dr. Patel",
    role: "physical_therapist",
  },
  recommended_daily_sets: 3,
  milestones: {
    week_3: {
      functional_task_score_target: 3.8,
      guided_movement_score_target: 85,
    },
  },
  consent: {
    share_record: true,
    consent_valid_until: "2026-12-31T23:59:59-05:00",
  },
};

export default function CareScreen() {
  const router = useRouter();
  const profile = getOnboardingProfile();
  const patientSummary = getFallbackDashboardPatientSummary();
  const [activeAlert, setActiveAlert] = useState<CareAlert | null>(
    getInitialActiveCareAlert,
  );

  const patientFirstName =
    patientSummary.patientName.trim().split(/\s+/)[0] || "patient";

  const caregiverFirstName =
    patientSummary.caregiverName.trim().split(/\s+/)[0] || "caregiver";

  const caregiverContext =
    patientSummary.caregiverRelationship || patientSummary.caregiverName;

  const patientSummaryDetail = [
    patientSummary.patientAge ? `${patientSummary.patientAge} yrs` : null,
    patientSummary.primaryDiagnosis,
  ]
    .filter(Boolean)
    .join(" - ");

  const functionalTarget =
    providerCarePlan.milestones.week_3.functional_task_score_target;

  const movementTarget =
    providerCarePlan.milestones.week_3.guided_movement_score_target;

  const isRealAlert = activeAlert !== null;
  const activeAlertTitle = activeAlert?.title ?? "Red Breath Alert";
  const activeAlertSubtitle = activeAlert
    ? `Severity ${activeAlert.severity} - ${capitalize(activeAlert.status)} - ${formatRelativeTime(activeAlert.createdAt)}`
    : "Severity 3 - Respiratory - Just now";
  const activeAlertPill = activeAlert
    ? getSeverityLabel(activeAlert.severity)
    : "New";
  const activeAlertBody = activeAlert?.body;

  function handleMarkHandled() {
    if (!activeAlert) return;

    const resolved = resolveCareAlert(activeAlert.alertId);
    if (!resolved && __DEV__) {
      console.warn(`Unable to resolve alert ${activeAlert.alertId}`);
    }
    setActiveAlert(null);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.headerRow}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backIcon}>{"<"}</Text>
          </Pressable>

          <View style={styles.headerTextBlock}>
            <Text style={styles.kicker}>Caregiver Concierge ACCESS-DP</Text>
            <Text style={styles.title}>Care Management</Text>
          </View>

          <Text style={styles.patientName}>{patientFirstName}</Text>
        </View>

        <View style={styles.patientCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {patientSummary.patientInitials}
            </Text>
          </View>

          <View style={styles.patientInfo}>
            <Text style={styles.patientCardName}>
              {patientSummary.patientName}
            </Text>
            <Text style={styles.patientDetail}>{patientSummaryDetail}</Text>
            <Text style={styles.patientMuted}>
              Caregiver: {caregiverContext}
            </Text>
          </View>
        </View>

        <View style={styles.alertCard}>
          <View style={styles.alertHeader}>
            <View style={styles.alertIconCircle}>
              <AppIcon name="alert" size={28} color={AppTheme.colors.white} />
            </View>

            <View style={styles.alertTitleBlock}>
              <Text style={styles.alertKicker}>Active Alert</Text>
              <Text style={styles.alertTitle}>{activeAlertTitle}</Text>
              <Text style={styles.alertSubtitle}>
                {activeAlertSubtitle}
              </Text>
            </View>

            <View style={styles.newPill}>
              <Text style={styles.newPillText}>{activeAlertPill}</Text>
            </View>
          </View>

          <View style={styles.metricRow}>
            <MetricBox label="SpO2" value="84%" detail="cutoff 88%" />
            <MetricBox label="Heart Rate" value="118" detail="BPM" />
            <MetricBox label="Resp. Rate" value="32" detail="br/min" />
          </View>

          {activeAlertBody ? (
            <Text style={styles.alertBodyText}>{activeAlertBody}</Text>
          ) : null}

          {isRealAlert ? (
            <Pressable
              style={styles.alertHandledButton}
              onPress={handleMarkHandled}
            >
              <Text style={styles.alertHandledText}>Mark handled</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Care Plan</Text>

        <View style={styles.carePlanCard}>
          <View style={styles.carePlanHeader}>
            <View>
              <Text style={styles.carePlanKicker}>Therapy Progress</Text>
              <Text style={styles.carePlanTitle}>
                Week {providerCarePlan.current_therapy_week} - Day{" "}
                {dailyCareEntry.therapy_day}
              </Text>
              <Text style={styles.carePlanSubtitle}>
                {formatCarePlanText(providerCarePlan.therapy_focus)}
              </Text>
            </View>

            <View style={styles.completedPill}>
              <Text style={styles.completedPillText}>
                {dailyCareEntry.therapy_completed ? "Completed" : "Pending"}
              </Text>
            </View>
          </View>

          <View style={styles.carePlanMetaGrid}>
            <CarePlanMeta
              label="Therapist"
              value={providerCarePlan.assigned_therapist.name}
            />
            <CarePlanMeta
              label="Affected side"
              value={capitalize(providerCarePlan.affected_side)}
            />
            <CarePlanMeta
              label="Logged by"
              value={`${caregiverFirstName} - ${caregiverContext}`}
            />
            <CarePlanMeta
              label="Assistance"
              value={capitalize(dailyCareEntry.assistance_required)}
            />
          </View>

          <View style={styles.setsRow}>
            <View>
              <Text style={styles.setsLabel}>Daily Sets</Text>
              <Text style={styles.setsValue}>
                {dailyCareEntry.sets_completed}/
                {dailyCareEntry.recommended_sets}
              </Text>
            </View>

            <View style={styles.setsProgressTrack}>
              <View
                style={[
                  styles.setsProgressFill,
                  {
                    width: `${Math.min(
                      100,
                      (dailyCareEntry.sets_completed /
                        dailyCareEntry.recommended_sets) *
                        100,
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>

          <View style={styles.symptomRow}>
            <SymptomBox label="Pain Before" value={dailyCareEntry.pain_before} />
            <SymptomBox label="Pain After" value={dailyCareEntry.pain_after} />
            <SymptomBox label="Fatigue" value={dailyCareEntry.fatigue} />
          </View>

          <ProgressMetric
            label="Functional Task Score"
            value={dailyCareEntry.functional_task_score}
            target={functionalTarget}
            max={5}
          />

          <ProgressMetric
            label="Guided Movement Score"
            value={dailyCareEntry.guided_movement_score}
            target={movementTarget}
            max={100}
          />

          <View style={styles.notesCard}>
            <Text style={styles.notesLabel}>Caregiver Note</Text>
            <Text style={styles.notesText}>{dailyCareEntry.notes}</Text>
          </View>

          <View style={styles.consentRow}>
            <View style={styles.consentDot} />
            <Text style={styles.consentText}>
              Sharing with provider{" "}
              {providerCarePlan.consent.share_record ? "enabled" : "disabled"}
            </Text>
          </View>
        </View>

        <View style={styles.safetyCard}>
          <Text style={styles.safetyKicker}>Safety Note</Text>
          <Text style={styles.safetyText}>
            {profile.safety?.safetyNotes ?? "No safety notes provided."}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Your Response</Text>

        <Pressable style={styles.callButton}>
          <Text style={styles.callButtonText}>Call 911</Text>
        </Pressable>

        <View style={styles.twoColumnActions}>
          <Pressable style={styles.actionButton}>
            <Text style={styles.actionButtonText}>
              Check on {patientFirstName}
            </Text>
          </Pressable>

          <Pressable style={styles.actionButton}>
            <Text style={styles.actionButtonText}>Go to ER</Text>
          </Pressable>
        </View>

        <Pressable style={styles.fullWidthAction}>
          <Text style={styles.actionButtonText}>Contact Provider</Text>
        </Pressable>

        <View style={styles.twoColumnActions}>
          <Pressable style={styles.actionButton}>
            <Text style={styles.secondaryActionText}>Acknowledge</Text>
          </Pressable>

          <Pressable style={styles.actionButton}>
            <Text style={styles.secondaryActionText}>Add Note</Text>
          </Pressable>
        </View>

        <Text style={styles.loggedText}>
          All responses logged - You remain in control
        </Text>

        <Pressable
          style={styles.mlButton}
          onPress={() => router.push("/care-management")}
        >
          <Text style={styles.mlButtonKicker}>ML Care Analysis</Text>
          <Text style={styles.mlButtonText}>
            Review anomaly detection, wearable scenario details, and generated
            care explanation.
          </Text>
          <Text style={styles.mlButtonLink}>{"Open care analysis ->"}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricBox({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

function CarePlanMeta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.carePlanMetaItem}>
      <Text style={styles.carePlanMetaLabel}>{label}</Text>
      <Text style={styles.carePlanMetaValue}>{value}</Text>
    </View>
  );
}

function SymptomBox({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.symptomBox}>
      <Text style={styles.symptomValue}>{value}/10</Text>
      <Text style={styles.symptomLabel}>{label}</Text>
    </View>
  );
}

function ProgressMetric({
  label,
  value,
  target,
  max,
}: {
  label: string;
  value: number;
  target: number;
  max: number;
}) {
  const valuePercent = Math.min(100, (value / max) * 100);
  const targetPercent = Math.min(100, (target / max) * 100);

  return (
    <View style={styles.progressMetric}>
      <View style={styles.progressMetricHeader}>
        <Text style={styles.progressMetricLabel}>{label}</Text>
        <Text style={styles.progressMetricValue}>
          {value} / target {target}
        </Text>
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressTargetMarker,
            {
              left: `${targetPercent}%`,
            },
          ]}
        />

        <View
          style={[
            styles.progressFill,
            {
              width: `${valuePercent}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

function getInitialActiveCareAlert(): CareAlert | null {
  try {
    return getActiveCareAlerts()[0] ?? null;
  } catch (error) {
    if (__DEV__) {
      console.warn("Falling back to mock Care Management alert.", error);
    }

    return null;
  }
}

function formatCarePlanText(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map(capitalize)
    .join(" ");
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getSeverityLabel(severity: CareAlert["severity"]): string {
  if (severity === 3) return "Urgent";
  if (severity === 2) return "Watch";
  return "Info";
}

function formatRelativeTime(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "Recent";

  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 40,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: AppTheme.colors.softSurface,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  backIcon: {
    color: AppTheme.colors.textSoft,
    fontSize: 34,
    lineHeight: 36,
    fontWeight: "500",
  },
  headerTextBlock: {
    flex: 1,
  },
  kicker: {
    color: AppTheme.colors.sectionText,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 2,
  },
  patientName: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "900",
  },
  alertCard: {
    backgroundColor: AppTheme.colors.danger,
    borderRadius: AppTheme.radius.card,
    padding: 22,
    marginBottom: 18,
    shadowColor: "#900",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  alertIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  alertTitleBlock: {
    flex: 1,
  },
  alertKicker: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  alertTitle: {
    color: AppTheme.colors.white,
    fontSize: 23,
    fontWeight: "900",
  },
  alertSubtitle: {
    color: AppTheme.colors.white,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 4,
  },
  newPill: {
    backgroundColor: AppTheme.colors.white,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  newPillText: {
    color: AppTheme.colors.danger,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  metricRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 22,
  },
  metricBox: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.16)",
    paddingVertical: 14,
    alignItems: "center",
  },
  metricLabel: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: "700",
  },
  metricValue: {
    color: AppTheme.colors.white,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 5,
  },
  metricDetail: {
    color: AppTheme.colors.white,
    fontSize: 12,
    marginTop: 3,
  },
  alertBodyText: {
    color: AppTheme.colors.white,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    marginTop: 16,
  },
  alertHandledButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.38)",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 16,
    paddingVertical: 11,
    marginTop: 16,
  },
  alertHandledText: {
    color: AppTheme.colors.white,
    fontSize: 14,
    fontWeight: "900",
  },
  patientCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 22,
    marginBottom: 18,
    flexDirection: "row",
    alignItems: "center",
    ...AppTheme.shadow,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: AppTheme.colors.brandSoft,
    borderWidth: 1,
    borderColor: "#B7FFF1",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  avatarText: {
    color: AppTheme.colors.brand,
    fontSize: 17,
    fontWeight: "900",
  },
  patientInfo: {
    flex: 1,
  },
  patientCardName: {
    color: AppTheme.colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  patientDetail: {
    color: AppTheme.colors.textSoft,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 5,
  },
  patientMuted: {
    color: AppTheme.colors.textMuted,
    fontSize: 15,
    marginTop: 8,
  },
  safetyCard: {
    backgroundColor: "#FFF9E8",
    borderWidth: 1,
    borderColor: "#FCD56B",
    borderRadius: AppTheme.radius.lg,
    padding: 18,
    marginBottom: 18,
  },
  safetyKicker: {
    color: "#B45309",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  safetyText: {
    color: "#92400E",
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "700",
  },
  infoCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 22,
    marginBottom: 18,
    ...AppTheme.shadow,
  },
  sectionLabel: {
    color: AppTheme.colors.sectionText,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  infoText: {
    color: AppTheme.colors.textSoft,
    fontSize: 17,
    lineHeight: 30,
  },
  recommendationCard: {
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FDBA74",
    borderRadius: AppTheme.radius.card,
    padding: 22,
    marginBottom: 22,
  },
  recommendationKicker: {
    color: "#F97316",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  recommendationText: {
    color: "#8A2C0D",
    fontSize: 17,
    lineHeight: 30,
    fontWeight: "800",
  },
  sectionTitle: {
    color: AppTheme.colors.sectionText,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 14,
  },
  carePlanCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 22,
    marginBottom: 24,
    ...AppTheme.shadow,
  },
  carePlanHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 20,
  },
  carePlanKicker: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  carePlanTitle: {
    color: AppTheme.colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
  },
  carePlanSubtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 4,
  },
  completedPill: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  completedPillText: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: "900",
  },
  carePlanMetaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 18,
  },
  carePlanMetaItem: {
    width: "47%",
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 16,
    padding: 14,
  },
  carePlanMetaLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 6,
  },
  carePlanMetaValue: {
    color: AppTheme.colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  setsRow: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  setsLabel: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  setsValue: {
    color: AppTheme.colors.text,
    fontSize: 28,
    fontWeight: "900",
    marginTop: 4,
  },
  setsProgressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: "#CFF5ED",
    overflow: "hidden",
    marginTop: 14,
  },
  setsProgressFill: {
    height: "100%",
    borderRadius: 5,
    backgroundColor: AppTheme.colors.brand,
  },
  symptomRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 18,
  },
  symptomBox: {
    flex: 1,
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
  },
  symptomValue: {
    color: AppTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  symptomLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 5,
    textAlign: "center",
  },
  progressMetric: {
    marginBottom: 18,
  },
  progressMetricHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  },
  progressMetricLabel: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  progressMetricValue: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "800",
  },
  progressTrack: {
    height: 12,
    borderRadius: 6,
    backgroundColor: AppTheme.colors.softSurface,
    overflow: "hidden",
    position: "relative",
  },
  progressFill: {
    height: "100%",
    borderRadius: 6,
    backgroundColor: AppTheme.colors.brand,
  },
  progressTargetMarker: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: AppTheme.colors.danger,
    zIndex: 2,
  },
  notesCard: {
    backgroundColor: "#FFF9E8",
    borderWidth: 1,
    borderColor: "#FCD56B",
    borderRadius: 18,
    padding: 16,
    marginTop: 2,
  },
  notesLabel: {
    color: "#92400E",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 7,
  },
  notesText: {
    color: "#92400E",
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "700",
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
  },
  consentDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: AppTheme.colors.brand,
    marginRight: 8,
  },
  consentText: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
  },
  callButton: {
    backgroundColor: AppTheme.colors.danger,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: "center",
    marginBottom: 14,
    shadowColor: AppTheme.colors.danger,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  callButtonText: {
    color: AppTheme.colors.white,
    fontSize: 22,
    fontWeight: "900",
  },
  twoColumnActions: {
    flexDirection: "row",
    gap: 14,
    marginBottom: 14,
  },
  actionButton: {
    flex: 1,
    minHeight: 64,
    backgroundColor: AppTheme.colors.surface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    ...AppTheme.shadow,
  },
  fullWidthAction: {
    minHeight: 64,
    backgroundColor: AppTheme.colors.surface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  actionButtonText: {
    color: AppTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
  },
  secondaryActionText: {
    color: AppTheme.colors.textSoft,
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
  },
  loggedText: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 20,
  },
  mlButton: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderWidth: 1,
    borderColor: "#B7FFF1",
    borderRadius: AppTheme.radius.card,
    padding: 20,
  },
  mlButtonKicker: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  mlButtonText: {
    color: AppTheme.colors.textSoft,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 12,
  },
  mlButtonLink: {
    color: AppTheme.colors.brand,
    fontSize: 15,
    fontWeight: "900",
  },
});
