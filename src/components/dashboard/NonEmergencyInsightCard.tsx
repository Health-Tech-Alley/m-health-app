import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";

import { AppIcon } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import { getCaregiverForPatient, insertCaregiverAction } from "@/data";
import { useNonEmergencyDecisionWorkflow } from "@/hooks/useNonEmergencyDecisionWorkflow";
import { useAppSelector } from "@/store/hooks";
import { useActivePatientView } from "@/hooks/useActivePatientView";
import { selectNonEmergencyDecisionForAlert } from "@/store/reducers/nonEmergencyDecisionSlice";
import { getPatientDisplayName } from "@/utils/patientDisplay";

const contextOptions = [
  { code: "increased_activity", label: "Exercising / increased activity" },
  { code: "poor_sleep", label: "Poor sleep" },
  { code: "stress_emotional_upset", label: "Stress or emotional upset" },
  { code: "eating_drinking_less", label: "Eating/drinking less than usual" },
  { code: "medication_change", label: "Missed or changed medication" },
  { code: "bathroom_changes", label: "Bathroom changes" },
  { code: "vomiting_diarrhea", label: "Vomiting or diarrhea" },
  {
    code: "tired_weak_confused_not_normal",
    label: "More tired, weak, confused, or not acting normal",
  },
  { code: "pain_discomfort", label: "Pain or discomfort" },
  { code: "breathing_different", label: "Breathing seemed different" },
  { code: "sensor_issue", label: "Sensor/watch issue" },
  { code: "nothing_unusual", label: "Nothing unusual noticed" },
  { code: "not_sure", label: "Not sure" },
];

type NonEmergencyInsightCardProps = {
  alertId: string;
  patientId: string;
};

export function NonEmergencyInsightCard({
  alertId,
  patientId,
}: NonEmergencyInsightCardProps) {
  const router = useRouter();
  const activePatient = useActivePatientView();
  const decisionWorkflow = useAppSelector((state) =>
    selectNonEmergencyDecisionForAlert(state, patientId, alertId),
  );
  const { evaluateSavedResponse, resetDecisionWorkflow } =
    useNonEmergencyDecisionWorkflow();
  const patientFirstName =
    getPatientDisplayName(activePatient).trim().split(/\s+/)[0] || "the patient";

  const [selectedContexts, setSelectedContexts] = useState<string[]>([]);
  const [reasonSearch, setReasonSearch] = useState("");
  const [reasonPickerOpen, setReasonPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedCaregiverActionId, setSavedCaregiverActionId] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const answered = selectedContexts.length > 0;
  const responseSaved = savedCaregiverActionId !== null;

  useEffect(() => {
    resetDecisionWorkflow(patientId, alertId);
  }, [alertId, patientId, resetDecisionWorkflow]);

  const visibleContextOptions = useMemo(() => {
    const query = reasonSearch.trim().toLowerCase();

    return [...contextOptions]
      .filter((option) => {
        if (!query) return true;
        return option.label.toLowerCase().includes(query);
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [reasonSearch]);

  const handleDismiss = () => {
    // Only allow dismissal once the prompt has been answered.
    if (!answered || submittingRef.current || responseSaved) return;
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const selectedOptions = contextOptions.filter((option) =>
        selectedContexts.includes(option.code),
      );
      const caregiverId =
        getCaregiverForPatient(patientId)?.caregiverId ?? "caregiver-1";
      const createdAt = new Date().toISOString();
      const actionId = `act-${Date.now()}`;

      insertCaregiverAction({
        actionId,
        alertId,
        patientId,
        caregiverId,
        type: "answer_clarifying_question",
        payloadJson: JSON.stringify({
          kind: "non_emergency_context",
          selectedReasons: selectedOptions.map((option) => ({
            code: option.code,
            label: option.label,
          })),
        }),
        createdAt,
      });
      setSavedCaregiverActionId(actionId);
      void evaluateSavedResponse({
        alertId,
        patientId,
        caregiverActionId: actionId,
        selectedReasonCodes: selectedContexts,
      });
    } catch (error) {
      Alert.alert(
        "Could not save response",
        "Please try again. Your selected reasons are still shown.",
      );
      console.error("[NonEmergencyInsightCard] Failed to save context:", error);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const toggleContext = (option: string) => {
    setSelectedContexts((current) => {
      if (current.includes(option)) {
        return current.filter((item) => item !== option);
      }

      return [...current, option];
    });
  };

  const recommendationText = getRecommendationText({
    answered,
    selectedContexts,
    status: decisionWorkflow.status,
    title: decisionWorkflow.decision?.notificationTitle ?? "",
    body: decisionWorkflow.decision?.notificationBody ?? "",
  });

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconCircle}>
          <AppIcon name="mobility" size={24} color={AppTheme.colors.brand} />
        </View>

        <View style={styles.headerTextBlock}>
          <Text style={styles.kicker}>Non-emergency pattern</Text>
          <Text style={styles.title}>Movement looked different today</Text>
        </View>

        <View style={styles.softBadge}>
          <Text style={styles.softBadgeText}>In-app</Text>
        </View>
      </View>

      <Text style={styles.bodyText}>
        {patientFirstName}&apos;s mobility score was lower than expected, but
        this does not look like an emergency. Add context so the Concierge can
        avoid unnecessary alerts and learn the pattern.
      </Text>

      <Text style={styles.questionText}>Was anything unusual happening?</Text>

      <View style={styles.reasonSearchRow}>
        <TextInput
          style={styles.reasonSearchInput}
          value={reasonSearch}
          onChangeText={setReasonSearch}
          onFocus={() => setReasonPickerOpen(true)}
          placeholder="Search reasons"
          placeholderTextColor={AppTheme.colors.textMuted}
          returnKeyType="search"
        />
        <Pressable
          style={styles.dropdownButton}
          onPress={() => setReasonPickerOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={
            reasonPickerOpen ? "Hide reason options" : "Show reason options"
          }
        >
          <Text style={styles.dropdownButtonText}>
            {reasonPickerOpen ? "⌃" : "⌄"}
          </Text>
        </Pressable>
        {reasonSearch.length > 0 ? (
          <Pressable
            style={styles.clearSearchButton}
            onPress={() => {
              setReasonSearch("");
              setReasonPickerOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear reason search"
          >
            <Text style={styles.clearSearchText}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {reasonPickerOpen ? (
        <>
          <View style={styles.contextGrid}>
            {visibleContextOptions.map((option) => {
              const selected = selectedContexts.includes(option.code);

              return (
                <Pressable
                  key={option.code}
                  style={[
                    styles.contextChip,
                    selected && styles.contextChipSelected,
                  ]}
                  onPress={() => toggleContext(option.code)}
                >
                  <Text
                    style={[
                      styles.contextChipText,
                      selected && styles.contextChipTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {visibleContextOptions.length === 0 ? (
            <Text style={styles.emptyReasonText}>No matching reasons</Text>
          ) : null}
        </>
      ) : null}

      <View style={styles.recommendationBox}>
        <View style={styles.recommendationHeader}>
          <Text style={styles.recommendationLabel}>Concierge recommendation</Text>
          {answered ? (
            <Pressable
              style={styles.checkmarkButton}
              onPress={handleDismiss}
              disabled={submitting || responseSaved}
            >
              <AppIcon name="check" size={16} color={AppTheme.colors.white} />
              <Text style={styles.checkmarkText}>Dismiss</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.recommendationText}>
          {recommendationText}
        </Text>

        {answered ? (
          <Pressable
            style={styles.suggestedFeatureButton}
            onPress={() => router.push("/schedule")}
          >
            <Text style={styles.suggestedFeatureText}>
              Schedule a provider check-in →
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function formatSelectedContexts(selectedContexts: string[]): string {
  const selectedLabels = contextOptions
    .filter((option) => selectedContexts.includes(option.code))
    .map((option) => option.label);

  if (selectedLabels.length === 1) {
    return selectedLabels[0];
  }

  return `${selectedLabels.length} reasons`;
}

function getRecommendationText({
  answered,
  selectedContexts,
  status,
  title,
  body,
}: {
  answered: boolean;
  selectedContexts: string[];
  status: "idle" | "evaluating" | "ready" | "unavailable" | "failed";
  title: string;
  body: string;
}): string {
  if (status === "evaluating") {
    return `${formatSelectedContexts(selectedContexts)} added as context. Reviewing the saved alert details...`;
  }

  if (status === "ready") {
    return [title, body].filter(Boolean).join(": ");
  }

  if (status === "unavailable") {
    return "Your response was saved. Additional analysis is not available for this alert.";
  }

  if (status === "failed") {
    return "Your response was saved, but the additional analysis could not be completed. Please try again later.";
  }

  return answered
    ? `${formatSelectedContexts(selectedContexts)} added as context. If this repeats at the same time or without explanation, consider asking the provider about the pattern.`
    : "If there is a clear reason, add context. If this repeats without explanation, the app can suggest a provider check-in.";
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
    alignItems: "flex-start",
    marginBottom: 16,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  headerTextBlock: {
    flex: 1,
  },
  kicker: {
    color: AppTheme.colors.sectionText,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 19,
    fontWeight: "900",
    lineHeight: 25,
  },
  softBadge: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  softBadgeText: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: "900",
  },
  bodyText: {
    color: AppTheme.colors.textSoft,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "700",
    marginBottom: 18,
  },
  questionText: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 12,
  },
  reasonSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  reasonSearchInput: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  clearSearchButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: AppTheme.colors.brandSoft,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  clearSearchText: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
  },
  dropdownButton: {
    minHeight: 48,
    minWidth: 48,
    borderRadius: 16,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  dropdownButtonText: {
    color: AppTheme.colors.brand,
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 24,
  },
  contextGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 18,
  },
  contextChip: {
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  contextChipSelected: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  contextChipText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "900",
  },
  contextChipTextSelected: {
    color: AppTheme.colors.white,
  },
  emptyReasonText: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 18,
    textAlign: "center",
  },
  recommendationBox: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 18,
    padding: 15,
  },
  recommendationHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  recommendationLabel: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    flex: 1,
  },
  checkmarkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: AppTheme.colors.brand,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  checkmarkText: {
    color: AppTheme.colors.white,
    fontSize: 11,
    fontWeight: "900",
  },
  recommendationText: {
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "800",
  },
  suggestedFeatureButton: {
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  suggestedFeatureText: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: "900",
  },
});
