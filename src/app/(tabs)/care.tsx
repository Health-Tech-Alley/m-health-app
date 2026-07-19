import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ObservationVitalsCard } from "@/components/care/ObservationVitalsCard";
import { Uc4PriorityCard } from "@/components/care/Uc4PriorityCard";
import { AppIcon } from "@/components/AppIcon";
import { MainTabHeader } from "@/components/MainTabHeader";
import { SlmInsightSheet } from "@/components/slm-insight-sheet";
import { AppTheme } from "@/constants/theme";
import { useCriticalAlert } from "@/contexts/critical-alert-context";
import { getCurrentPatientSnapshot, usePatientRecord } from "@/contexts/patient-record-context";
import {
  DAILY_CARE_SKIPPED_REASON_OPTIONS,
  DAILY_CARE_URGENT_SYMPTOM_OPTIONS,
  filterCompletedExerciseKeysForAssignments,
  getAssignedDevelopmentRehabExercises,
  mergeDailyCareUrgentSymptoms,
  upsertDailyCareEntry,
  type CarePlan,
  type DailyCareEntry,
  type DailyCareUrgentSymptomCode,
  type PatientRecordSnapshot,
  type RehabExerciseKey,
} from "@/data";
import { getRehabilitationMeasurements } from "@/data/repositories/rehabilitationMeasurementRepository";
import type {
  CarePlanRehabMetric,
  PatientCareContextItem,
  PatientTimelineEvent,
  LatestUc4PriorityCardSummary,
  RehabilitationMeasurement,
  RehabilitationMeasurementType,
} from "@/data/types";
import { useActivePatientView } from "@/hooks/useActivePatientView";
import {
  displayClinical,
  getCaregiverDisplay,
  getCaregiverRoleDisplay,
  getPatientAgeDisplay,
  getPatientDisplayName,
  getPrimaryDiagnosisDisplay,
} from "@/utils/patientDisplay";
import {
  getUc3ResultDisplay,
  type Uc3ResultDisplay,
} from "@/services/uc3/uc3ResultPresenter";
import {
  evaluateAndPersistUc3Trajectory,
  type Uc3EvaluationServiceResult,
} from "@/services/uc3/uc3EvaluationService";
import {
  evaluateAndPersistUc4Priorities,
  submitUc4CaregiverResponse,
  type Uc4CardResponseAction,
  type Uc4EvaluationServiceResult,
} from "@/services/uc4/uc4EvaluationService";

type DailyCareEditField =
  | "setsCompleted"
  | "exerciseRepetitions"
  | "romDegrees"
  | "walkingMinutes"
  | "painScore"
  | "fatigue";

type CareContextDisplayItem = {
  item: PatientCareContextItem;
  secondary: boolean;
};

type CareContextDisplayGroup = {
  key: string;
  title: string;
  items: CareContextDisplayItem[];
};

export default function CareScreen() {
  const router = useRouter();
  const { patientId, snapshot, refresh, mutatePatientRecord } = usePatientRecord();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const { reopenOnCareFocus } = useCriticalAlert();
  const activePatient = useActivePatientView();
  const patientName = getPatientDisplayName(activePatient);
  const diagnosis = getPrimaryDiagnosisDisplay(activePatient);
  const carePlan = snapshot?.carePlan ?? null;
  const latestUc3Result = snapshot?.latestUc3TrajectoryResult ?? null;
  const uc3ResultDisplay = useMemo(
    () => getUc3ResultDisplay(latestUc3Result),
    [latestUc3Result],
  );
  const uc4PriorityCards = snapshot?.latestUc4PriorityCards ?? [];
  const rehabPlanMetrics = snapshot?.rehabPlanMetrics ?? [];
  const carePlanHistory = snapshot?.carePlans ?? [];
  const timelineEvents = snapshot?.timelineEvents;
  const mostActionableCarePlan =
    carePlan ?? carePlanHistory.find(isMostActionableCarePlan) ?? null;
  const secondaryCarePlanHistory = carePlanHistory.filter(
    (plan) => plan.planId !== mostActionableCarePlan?.planId,
  );
  const clinicalTimelineEvents = useMemo(
    () =>
      (timelineEvents ?? [])
        .filter((event) => Boolean(event.title || event.summary))
        .sort((a, b) => a.daysFromFirstVisit - b.daysFromFirstVisit),
    [timelineEvents],
  );
  const caregiverDisplay = getCaregiverDisplay(activePatient);
  const caregiverFirstName = isProvided(caregiverDisplay)
    ? caregiverDisplay.trim().split(/\s+/)[0]
    : "";
  const caregiverRole = getCaregiverRoleDisplay(activePatient);
  const patientAge = getPatientAgeDisplay(activePatient);

  

  // Re-surface the severity-3 critical-alert popup whenever the Care tab is
  // (re)opened, until the alert is dismissed or resolved.
  useFocusEffect(
    useCallback(() => {
      reopenOnCareFocus();
    }, [reopenOnCareFocus]),
  );

  // Daily care entry is sourced from SQLite only. Opening the screen must not
  // seed demo values for a patient that has not recorded care today.
  const entry = snapshot?.todayDailyCareEntry ?? null;
  const dailyEntry = entry && !isSeededDemoDailyEntry(entry) ? entry : null;
  const rehabExerciseAssignments = useMemo(
    () => snapshot?.rehabExerciseAssignments ?? [],
    [snapshot?.rehabExerciseAssignments],
  );
  const activeAssignedExercises = useMemo(
    () =>
      getAssignedDevelopmentRehabExercises(rehabExerciseAssignments),
    [rehabExerciseAssignments],
  );
  const activeAssignmentKeySet = useMemo(
    () => new Set(activeAssignedExercises.map((exercise) => exercise.key)),
    [activeAssignedExercises],
  );
  const completedAssignedExerciseKeySet = useMemo(
    () =>
      new Set(
        filterCompletedExerciseKeysForAssignments(
          dailyEntry?.completedExerciseKeys,
          rehabExerciseAssignments,
        ),
    ),
    [dailyEntry?.completedExerciseKeys, rehabExerciseAssignments],
  );
  const selectedUrgentSymptomCodes = useMemo(
    () =>
      DAILY_CARE_URGENT_SYMPTOM_OPTIONS
        .map((option) => option.value)
        .filter((symptomCode) => dailyEntry?.symptoms?.includes(symptomCode)),
    [dailyEntry?.symptoms],
  );
  const selectedUrgentSymptomKeySet = useMemo(
    () => new Set(selectedUrgentSymptomCodes),
    [selectedUrgentSymptomCodes],
  );
  const skippedReasonSummary =
    DAILY_CARE_SKIPPED_REASON_OPTIONS.find(
      (option) => option.value === dailyEntry?.skippedReason,
    )?.label ?? "Select a reason";
  const assignedExercisesSummary =
    activeAssignedExercises.length > 0
      ? `${completedAssignedExerciseKeySet.size} of ${activeAssignedExercises.length} completed`
      : "No exercises assigned.";
  const urgentSymptomsSummary =
    selectedUrgentSymptomCodes.length > 0
      ? `${selectedUrgentSymptomCodes.length} selected`
      : "None selected";

  const [editingField, setEditingField] = useState<null | DailyCareEditField>(null);
  const [editingPatientId, setEditingPatientId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editError, setEditError] = useState("");
  const [skippedReasonExpanded, setSkippedReasonExpanded] = useState(false);
  const [assignedExercisesExpanded, setAssignedExercisesExpanded] = useState(false);
  const [urgentSymptomsExpanded, setUrgentSymptomsExpanded] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const [rehabCheckInY, setRehabCheckInY] = useState(0);
  const [uc3CompletionRunning, setUc3CompletionRunning] = useState(false);
  const [uc3CompletionStatus, setUc3CompletionStatus] = useState<string | null>(null);
  const [therapyCompletionConfirmVisible, setTherapyCompletionConfirmVisible] = useState(false);
  const activeEditingField = editingPatientId === patientId ? editingField : null;

  useEffect(() => {
    const handle = setTimeout(() => {
      setEditingField(null);
      setEditingPatientId(null);
      setEditDraft("");
      setEditError("");
    }, 0);
    return () => clearTimeout(handle);
  }, [patientId]);

  const careContextGroups = useMemo(
    () => buildCareContextGroups(clinicalTimelineEvents, snapshot?.careContextItems ?? []),
    [clinicalTimelineEvents, snapshot?.careContextItems],
  );

  // CP-relevant progress metrics for non-ambulatory patients (GMFCS IV–V).
  // Pulled alongside the stroke-oriented Berg balance / gait speed rows so
  // a single Care screen works for both populations.
  const cpProgressMeasurements = useMemo(() => {
    if (!patientId) return [];
    const types: RehabilitationMeasurementType[] = [
      "rehabilitation_modified_ashworth",
      "rehabilitation_seated_postural_control",
      "rehabilitation_feeding_tolerance",
      "rehabilitation_communication_function",
      "rehabilitation_joint_contracture_rom",
    ];
    return types.flatMap((t) => getRehabilitationMeasurements(patientId, t));
  }, [patientId]);

  const openFieldEdit = (field: DailyCareEditField) => {
    if (!patientId) return;
    setEditingField(field);
    setEditingPatientId(patientId);
    setEditError("");
    setEditDraft(String(dailyEntry?.[field] ?? ""));
  };

  const saveDailyCarePatch = (patch: Partial<DailyCareEntry>): DailyCareEntry | null => {
    if (!patientId) return null;
    const savedEntry = upsertDailyCareEntry({
      ...(dailyEntry ?? {}),
      ...patch,
      patientId,
      carePlanId: dailyEntry?.carePlanId ?? carePlan?.planId,
      assignedExerciseKeys: activeAssignedExercises.map((exercise) => exercise.key),
    });
    refresh();
    return savedEntry;
  };

  const confirmTherapyCompleted = async () => {
    if (!patientId || uc3CompletionRunning) return;

    setTherapyCompletionConfirmVisible(false);
    setUc3CompletionRunning(true);
    setUc3CompletionStatus("Concierge is updating rehabilitation progress...");

    try {
      const savedEntry = saveDailyCarePatch({
        therapyCompleted: true,
        skippedReason: null,
      });
      const refreshedSnapshot = getCurrentPatientSnapshot();

      if (!savedEntry || !refreshedSnapshot?.patient) {
        setUc3CompletionStatus("Rehabilitation progress is not ready to update yet.");
        return;
      }

      const now = new Date();
      const result = await evaluateAndPersistUc3Trajectory(refreshedSnapshot, {
        evaluationKey: createTherapyCompletionUc3EvaluationKey(savedEntry.entryDate, now),
        now,
      });
      setUc3CompletionStatus(getTherapyCompletionUc3StatusMessage(result));
      if (result.status !== "success") {
        refresh();
        return;
      }

      refresh();
      const uc4Snapshot = getCurrentPatientSnapshot();
      if (!uc4Snapshot?.patient) {
        setUc3CompletionStatus(
          `${getTherapyCompletionUc3StatusMessage(result)} Care focus could not run because patient state is not ready.`,
        );
        return;
      }

      try {
        const uc4Result = await evaluateAndPersistUc4Priorities(uc4Snapshot);
        setUc3CompletionStatus(
          `${getTherapyCompletionUc3StatusMessage(result)} ${getTherapyCompletionUc4StatusMessage(uc4Result)}`,
        );
        if (uc4Result.status === "success") {
          refresh();
        }
      } catch (uc4Error) {
        console.error("[CareScreen] UC4 care focus update failed:", uc4Error);
        setUc3CompletionStatus(
          `${getTherapyCompletionUc3StatusMessage(result)} Care focus could not be updated.`,
        );
      }
    } catch (error) {
      console.error("[CareScreen] UC3 therapy completion update failed:", error);
      setUc3CompletionStatus("Rehabilitation progress could not be updated.");
    } finally {
      setUc3CompletionRunning(false);
    }
  };

  const handleTherapyCompletionPress = () => {
    if (uc3CompletionRunning) return;

    const therapyCompleted = !dailyEntry?.therapyCompleted;
    if (!therapyCompleted) {
      setUc3CompletionStatus(null);
      setSkippedReasonExpanded(true);
      saveDailyCarePatch({
        therapyCompleted,
        skippedReason: dailyEntry?.skippedReason ?? null,
      });
      return;
    }

    setUc3CompletionStatus(null);
    setTherapyCompletionConfirmVisible(true);
  };

  const toggleCompletedAssignedExercise = (exerciseKey: RehabExerciseKey) => {
    if (!activeAssignmentKeySet.has(exerciseKey)) return;

    let nextEntry: DailyCareEntry | null = null;
    void mutatePatientRecord(
      (latestSnapshot) => {
        if (latestSnapshot.patient?.patientId !== patientId) {
          throw new Error(`Cannot save daily care for inactive patient: ${patientId}`);
        }
        nextEntry = buildCompletedExerciseEntry(latestSnapshot, exerciseKey);
        return withDailyCareEntry(latestSnapshot, nextEntry);
      },
      () => {
        if (nextEntry) Object.assign(nextEntry, upsertDailyCareEntry(nextEntry));
      },
    ).catch((error) => {
      console.error("[CareScreen] Daily care update failed:", error);
      setUc3CompletionStatus("Care update could not be saved. Please try again.");
    });
  };

  const toggleSkippedReason = (reason: string) => {
    saveDailyCarePatch({
      therapyCompleted: false,
      skippedReason: dailyEntry?.skippedReason === reason ? null : reason,
    });
  };

  const toggleUrgentSymptom = (symptomCode: DailyCareUrgentSymptomCode) => {
    const nextSelectedUrgentSymptoms = new Set(selectedUrgentSymptomCodes);
    if (nextSelectedUrgentSymptoms.has(symptomCode)) {
      nextSelectedUrgentSymptoms.delete(symptomCode);
    } else {
      nextSelectedUrgentSymptoms.add(symptomCode);
    }

    saveDailyCarePatch({
      symptoms: mergeDailyCareUrgentSymptoms(
        dailyEntry?.symptoms ?? [],
        Array.from(nextSelectedUrgentSymptoms),
      ),
    });
  };

  const saveFieldEdit = () => {
    if (!activeEditingField || !patientId) {
      setEditingField(null);
      setEditingPatientId(null);
      return;
    }
    const trimmedDraft = editDraft.trim();
    const newValue = trimmedDraft.length > 0 ? Number(trimmedDraft) : undefined;
    const validationError = validateDailyCareField(activeEditingField, newValue);
    if (validationError) {
      setEditError(validationError);
      return;
    }
    saveDailyCarePatch({ [activeEditingField]: newValue } as Partial<DailyCareEntry>);
    setEditingField(null);
    setEditingPatientId(null);
    setEditDraft("");
    setEditError("");
  };
  useEffect(() => {
    if (focus !== "rehab-check-in" || rehabCheckInY <= 0) return;
    const handle = setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(rehabCheckInY - 16, 0),
        animated: true,
      });
    }, 150);
    return () => clearTimeout(handle);
  }, [focus, rehabCheckInY]);
  const safetyNotes = snapshot?.safetyNotes ?? "";
  const safetyConsiderations = parseSafetyConsiderations(
    safetyNotes.trim().length > 0 ? safetyNotes : "No safety notes provided.",
  );
  const [openConsideration, setOpenConsideration] = useState<string | null>(null);
  const [slmOpen, setSlmOpen] = useState(false);
  const [slmPrompt, setSlmPrompt] = useState("");
  const explainUc3Result = () => {
    if (!latestUc3Result) return;
    router.push({
      pathname: "/slm-explain",
      params: {
        mode: "rehab_trajectory",
        resultId: latestUc3Result.resultId,
        patientId,
      },
    });
  };
  const handleUc4Respond = useCallback((
    card: LatestUc4PriorityCardSummary,
    action: Uc4CardResponseAction,
    payload: {
      observationCodes: string[];
      contextCodes: string[];
      caregiverRequestedProviderReview: boolean;
    },
  ) => {
    if (!patientId) return;
    submitUc4CaregiverResponse({
      patientId,
      cardId: card.cardId,
      templateId: card.templateId,
      action,
      observationCodes: payload.observationCodes,
      contextCodes: payload.contextCodes,
      caregiverRequestedProviderReview: payload.caregiverRequestedProviderReview,
    });
    refresh();
  }, [patientId, refresh]);
  const explainUc4Card = useCallback((card: LatestUc4PriorityCardSummary) => {
    router.push({
      pathname: "/slm-explain",
      params: {
        mode: "uc4_priority",
        cardId: card.cardId,
        patientId,
      },
    });
  }, [patientId, router]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <MainTabHeader
          title="Care Management"
          eyebrow="Caregiver Concierge ACCESS-DP"
          rightContent={<Text style={styles.patientName}>{patientName}</Text>}
        />

        <View style={styles.patientCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(patientName)}</Text>
          </View>

          <View style={styles.patientInfo}>
            <Text style={styles.patientCardName}>{patientName}</Text>
            <Text style={styles.patientDetail}>
              Age {patientAge} · {displayClinical(diagnosis)}
            </Text>
            <Text style={styles.patientMuted}>
              Caregiver {getCaregiverDisplay(activePatient)} · {getCaregiverRoleDisplay(activePatient)}
            </Text>
          </View>
        </View>

        <View style={styles.contextGrid}>
          <ObservationVitalsCard />
        </View>

        {carePlan ? (
          <>
            <Text style={styles.sectionTitle}>Care Focus</Text>

            <View style={styles.carePlanCard}>
              <View style={styles.carePlanHeader}>
                <View style={styles.carePlanHeaderText}>
                  <Text style={styles.carePlanKicker}>Documented care plan</Text>
                  <Text style={styles.carePlanTitle}>
                    {carePlan.title || "Care plan"}
                  </Text>
                  {carePlan.description ? (
                    <Text style={styles.carePlanSubtitle}>
                      {carePlan.description}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.completedPill}>
                  <Text style={styles.completedPillText}>
                    {formatCarePlanStatus(carePlan.status)}
                  </Text>
                </View>
              </View>

              <View style={styles.carePlanMetaGrid}>
                <CarePlanMeta
                  label="Start date"
                  value={formatCarePlanDate(carePlan.periodStart ?? carePlan.effectiveDate)}
                />
                <CarePlanMeta
                  label="Intent"
                  value={formatCarePlanStatus(carePlan.intent)}
                />
                <CarePlanMeta
                  label="Care team"
                  value={formatCareTeam(carePlan.careTeamDisplayJson)}
                />
                <CarePlanMeta
                  label="Logged by"
                  value={formatLoggedBy(caregiverFirstName, caregiverRole)}
                />
              </View>

              {rehabPlanMetrics.length > 0 ? (
                <RehabPlanMetricList metrics={rehabPlanMetrics} />
              ) : null}
            </View>

            <View
              style={styles.carePlanCard}
              onLayout={(event) => {
                setRehabCheckInY(event.nativeEvent.layout.y);
              }}
            >
              <Text style={styles.carePlanKicker}>{"Today\u2019s rehab check-in"}</Text>

              <Pressable
                style={[
                  styles.completionRow,
                  uc3CompletionRunning && styles.completionRowDisabled,
                ]}
                onPress={handleTherapyCompletionPress}
                disabled={uc3CompletionRunning}
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked: Boolean(dailyEntry?.therapyCompleted),
                  disabled: uc3CompletionRunning,
                }}
                accessibilityLabel="Therapy completed today"
              >
                <View
                  style={[
                    styles.completionCheckbox,
                    dailyEntry?.therapyCompleted && styles.completionCheckboxChecked,
                  ]}
                >
                  {dailyEntry?.therapyCompleted ? (
                    <Text style={styles.completionCheckmark}>✓</Text>
                  ) : null}
                </View>
                <View style={styles.completionTextBlock}>
                  <Text style={styles.completionTitle}>Therapy completed today</Text>
                  <Text style={styles.completionSubtitle}>
                    {"Mark complete after today's rehab routine is done."}
                  </Text>
                </View>
              </Pressable>

              {uc3CompletionStatus ? (
                <Text style={styles.uc3CompletionStatus}>{uc3CompletionStatus}</Text>
              ) : null}

              {!dailyEntry?.therapyCompleted ? (
                <View style={styles.checkInAccordionCard}>
                  <Pressable
                    style={styles.checkInAccordionHeader}
                    onPress={() => setSkippedReasonExpanded((expanded) => !expanded)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: skippedReasonExpanded }}
                    accessibilityLabel={`Why wasn't the session completed? ${skippedReasonSummary}`}
                  >
                    <View style={styles.checkInAccordionHeaderText}>
                      <Text style={styles.checkInAccordionTitle}>
                        {"Why wasn't the session completed?"}
                      </Text>
                      <Text style={styles.checkInAccordionSummary}>{skippedReasonSummary}</Text>
                    </View>
                    <Text style={styles.checkInAccordionChevron}>
                      {skippedReasonExpanded ? "v" : ">"}
                    </Text>
                  </Pressable>
                  {skippedReasonExpanded ? (
                    <View style={styles.checkInAccordionBody}>
                      <View style={styles.reasonOptionGrid}>
                        {DAILY_CARE_SKIPPED_REASON_OPTIONS.map((option) => {
                          const selected = dailyEntry?.skippedReason === option.value;
                          return (
                            <Pressable
                              key={option.value}
                              style={[
                                styles.reasonOption,
                                selected && styles.reasonOptionSelected,
                              ]}
                              onPress={() => toggleSkippedReason(option.value)}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                            >
                              <Text
                                style={[
                                  styles.reasonOptionText,
                                  selected && styles.reasonOptionTextSelected,
                                ]}
                              >
                                {option.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.checkInAccordionCard}>
                <Pressable
                  style={styles.checkInAccordionHeader}
                  onPress={() => setAssignedExercisesExpanded((expanded) => !expanded)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: assignedExercisesExpanded }}
                  accessibilityLabel={`Assigned exercises. ${assignedExercisesSummary}`}
                >
                  <View style={styles.checkInAccordionHeaderText}>
                    <Text style={styles.checkInAccordionTitle}>Assigned exercises</Text>
                    <Text style={styles.checkInAccordionSummary}>
                      {assignedExercisesSummary}
                    </Text>
                  </View>
                  <Text style={styles.checkInAccordionChevron}>
                    {assignedExercisesExpanded ? "v" : ">"}
                  </Text>
                </Pressable>
                {assignedExercisesExpanded ? (
                  <View style={styles.checkInAccordionBody}>
                    {activeAssignedExercises.length > 0 ? (
                      <View style={styles.exerciseChecklist}>
                        {activeAssignedExercises.map((exercise) => (
                          <ExerciseChecklistRow
                            key={exercise.key}
                            label={exercise.label}
                            checked={completedAssignedExerciseKeySet.has(exercise.key)}
                            onPress={() => toggleCompletedAssignedExercise(exercise.key)}
                          />
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.assignedExerciseEmpty}>No exercises assigned.</Text>
                    )}
                  </View>
                ) : null}
              </View>

              <Pressable style={styles.setsRow} onPress={() => openFieldEdit("setsCompleted")}>
                <View>
                  <Text style={styles.setsLabel}>Daily Sets</Text>
                  <Text style={styles.setsValue}>
                    {formatSets(dailyEntry)}
                  </Text>
                </View>

                {dailyEntry && dailyEntry.recommendedSets > 0 ? (
                  <View style={styles.setsProgressTrack}>
                    <View
                      style={[
                        styles.setsProgressFill,
                        {
                          width: `${Math.min(
                            100,
                            (dailyEntry.setsCompleted /
                              Math.max(dailyEntry.recommendedSets, 1)) *
                              100,
                          )}%`,
                        },
                      ]}
                    />
                  </View>
                ) : null}
              </Pressable>

              <View style={styles.rehabMetricGrid}>
                <EditableDailyFactBox
                  label="Repetitions"
                  value={dailyEntry?.exerciseRepetitions}
                  unit="reps"
                  onPress={() => openFieldEdit("exerciseRepetitions")}
                />
                <EditableDailyFactBox
                  label="ROM"
                  value={dailyEntry?.romDegrees}
                  unit="degrees"
                  onPress={() => openFieldEdit("romDegrees")}
                />
                <EditableDailyFactBox
                  label="Walking"
                  value={dailyEntry?.walkingMinutes}
                  unit="min"
                  onPress={() => openFieldEdit("walkingMinutes")}
                />
              </View>

              <View style={styles.symptomRow}>
                <EditableSymptomBox
                  label="Pain"
                  value={dailyEntry?.painScore}
                  onPress={() => openFieldEdit("painScore")}
                />
                <EditableSymptomBox
                  label="Fatigue"
                  value={dailyEntry?.fatigue}
                  onPress={() => openFieldEdit("fatigue")}
                />
              </View>

              <View
                style={[
                  styles.checkInAccordionCard,
                  styles.checkInAccordionCardLast,
                  selectedUrgentSymptomCodes.length > 0 && styles.checkInAccordionCardAlert,
                ]}
              >
                <Pressable
                  style={styles.checkInAccordionHeader}
                  onPress={() => setUrgentSymptomsExpanded((expanded) => !expanded)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: urgentSymptomsExpanded }}
                  accessibilityLabel={`Urgent symptoms. ${urgentSymptomsSummary}`}
                >
                  <View style={styles.checkInAccordionHeaderText}>
                    <Text
                      style={[
                        styles.checkInAccordionTitle,
                        selectedUrgentSymptomCodes.length > 0 &&
                          styles.checkInAccordionTitleAlert,
                      ]}
                    >
                      Urgent symptoms
                    </Text>
                    <Text style={styles.checkInAccordionSummary}>
                      {urgentSymptomsSummary}
                    </Text>
                  </View>
                  <Text style={styles.checkInAccordionChevron}>
                    {urgentSymptomsExpanded ? "v" : ">"}
                  </Text>
                </Pressable>
                {urgentSymptomsExpanded ? (
                  <View style={styles.checkInAccordionBody}>
                    <View style={styles.exerciseChecklist}>
                      {DAILY_CARE_URGENT_SYMPTOM_OPTIONS.map((option) => (
                        <ExerciseChecklistRow
                          key={option.value}
                          label={option.label}
                          checked={selectedUrgentSymptomKeySet.has(option.value)}
                          onPress={() => toggleUrgentSymptom(option.value)}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>

              <Uc3ResultCard
                display={uc3ResultDisplay}
                onExplain={latestUc3Result ? explainUc3Result : undefined}
              />

              {uc4PriorityCards.length > 0 ? (
                <View style={styles.uc4PriorityBlock}>
                  <Text style={styles.urgentSymptomTitle}>Care focus checklist</Text>
                  {uc4PriorityCards.map((card) => (
                    <Uc4PriorityCard
                      key={card.cardId}
                      card={card}
                      onExplain={explainUc4Card}
                      onRespond={handleUc4Respond}
                    />
                  ))}
                </View>
              ) : null}

              {cpProgressMeasurements.length > 0 ? (
                <ProgressMetric
                  label="CP progress (most recent)"
                  measurements={cpProgressMeasurements}
                  target={1}
                  maxVal={1}
                  unit=""
                />
              ) : null}

              <View style={styles.consentRow}>
                <View style={styles.consentDot} />
                <Text style={styles.consentText}>
                  Sharing with provider enabled
                </Text>
              </View>
            </View>

            <View style={styles.carePlanCard}>
              <View style={styles.activityList}>
                <Text style={styles.activityTitle}>Care team activities</Text>
                <Text style={styles.activitySubtitle}>
                  Tasks and monitoring from the documented care plan
                </Text>
                {carePlan.activities.length > 0 ? (
                  carePlan.activities.map((activity) => (
                    <View key={activity.activityId} style={styles.activityRow}>
                      <View style={styles.activityDot} />
                      <View style={styles.activityTextBlock}>
                        <Text style={styles.activityDescription}>
                          {activity.description || "Activity"}
                        </Text>
                        <Text style={styles.activityStatus}>
                          {formatCarePlanStatus(activity.status)}
                        </Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.activityEmptyText}>
                    No therapy activities are documented in this plan.
                  </Text>
                )}
              </View>
            </View>

          </>
        ) : !mostActionableCarePlan && secondaryCarePlanHistory.length === 0 ? (
          <>
            <Text style={styles.sectionTitle}>Care Plan</Text>
            <View style={styles.carePlanCard}>
              <Text style={styles.carePlanKicker}>Care plan status</Text>
              <Text style={styles.emptyCarePlanText}>No current care plans.</Text>
            </View>
          </>
        ) : null}

        {careContextGroups.length > 0 ? (
          <View style={styles.contextGrid}>
            <ContextCard title="Care Planning Context">
              {careContextGroups.map((group) => (
                <CareContextTimelineGroup key={group.key} group={group} />
              ))}
            </ContextCard>
          </View>
        ) : null}

        <View style={styles.safetyCard}>
          <Text style={styles.safetyKicker}>Safety considerations</Text>
          <Text style={styles.safetyHint}>
            Tap any consideration for details and a Concierge explanation.
          </Text>
          {safetyConsiderations.map((consideration, idx) => (
            <Pressable
              key={idx}
              style={styles.safetyRow}
              onPress={() => setOpenConsideration(consideration)}
            >
              <Text style={styles.safetyBullet}>{"\u2022"}</Text>
              <Text style={styles.safetyLine}>{consideration}</Text>
              <Text style={styles.safetyChevron}>{"\u203A"}</Text>
            </Pressable>
            ))}
        </View>
      </ScrollView>

      <Modal
        visible={therapyCompletionConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!uc3CompletionRunning) {
            setTherapyCompletionConfirmVisible(false);
          }
        }}
      >
        <Pressable
          style={styles.confirmOverlay}
          onPress={() => {
            if (!uc3CompletionRunning) {
              setTherapyCompletionConfirmVisible(false);
            }
          }}
        >
          <Pressable style={styles.confirmSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.confirmTitle}>Confirm therapy completion</Text>
            <Text style={styles.confirmMessage}>{"Was today\u2019s therapy session completed?"}</Text>
            <View style={styles.confirmActions}>
              <Pressable
                style={[styles.confirmButton, styles.confirmCancelButton]}
                onPress={() => setTherapyCompletionConfirmVisible(false)}
                disabled={uc3CompletionRunning}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmButton, styles.confirmPrimaryButton]}
                onPress={() => { void confirmTherapyCompleted(); }}
                disabled={uc3CompletionRunning}
              >
                <Text style={styles.confirmPrimaryText}>Confirm</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Combined safety explanation dialog (safety note + reason + recommendation) */}
      <Modal
        visible={openConsideration !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenConsideration(null)}
      >
        <Pressable style={styles.explainOverlay} onPress={() => setOpenConsideration(null)}>
          <Pressable style={styles.explainSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.explainHeader}>
              <Text style={styles.explainKicker}>Safety Consideration</Text>
              <Pressable onPress={() => setOpenConsideration(null)} hitSlop={12}>
                <Text style={styles.explainClose}>×</Text>
              </Pressable>
            </View>

            <Text style={styles.explainTitle}>{openConsideration}</Text>

            <View style={styles.explainBlock}>
              <Text style={styles.explainLabel}>Why this matters</Text>
              <Text style={styles.explainBody}>
                {patientName}&apos;s vitals are outside the configured
                safe range (oxygen below cutoff, elevated respiratory and heart
                rate). This consideration is part of the configured safety plan
                to catch deterioration early.
              </Text>
            </View>

            <View style={styles.explainBlock}>
              <Text style={styles.explainLabel}>Recommendation</Text>
              <Text style={styles.explainBody}>
                Check on {patientName} immediately. Consider ER or 911 if
                symptoms are severe. The app will not act automatically.
              </Text>
            </View>

            <Pressable
              style={styles.explainSlmButton}
              onPress={() => {
                setSlmPrompt(`Explain this safety consideration for ${patientName} in plain, calm language a family caregiver can act on: "${openConsideration ?? ""}". Include why it matters, what to watch for, and what to do next.`);
                setSlmOpen(true);
                setOpenConsideration(null);
              }}
            >
              <AppIcon name="care" size={18} color={AppTheme.colors.white} />
              <Text style={styles.explainSlmText}>Explain with Concierge</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <SlmInsightSheet
        visible={slmOpen}
        onClose={() => {
          setSlmOpen(false);
          setSlmPrompt("");
        }}
        title="Concierge explanation"
        reason="safety_note_explain"
        prompt={slmPrompt}
      />

      {/* Field edit modal */}
      <Modal
        visible={activeEditingField !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setEditingField(null);
          setEditingPatientId(null);
        }}
      >
        <Pressable
          style={styles.editOverlay}
          onPress={() => {
            setEditingField(null);
            setEditingPatientId(null);
          }}
        >
          <Pressable style={styles.editSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.editTitle}>
              {activeEditingField ? `Edit ${getDailyCareEditTitle(activeEditingField)}` : "Edit entry"}
            </Text>
            <TextInput
              style={styles.editInput}
              value={editDraft}
              onChangeText={setEditDraft}
              placeholder={activeEditingField ? getDailyCareEditPlaceholder(activeEditingField) : "0"}
              keyboardType="numeric"
              autoFocus
            />
            {editError ? <Text style={styles.editError}>{editError}</Text> : null}
            <View style={styles.editActions}>
              <Pressable
                style={[styles.editButton, styles.editCancel]}
                onPress={() => {
                  setEditingField(null);
                  setEditingPatientId(null);
                }}
              >
                <Text style={styles.editCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.editButton} onPress={saveFieldEdit}>
                <Text style={styles.editSaveText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

/**
 * Split the safety-notes string into individual, period-less considerations.
 * Splits on newlines and sentence-ending periods; strips trailing punctuation.
 */
function parseSafetyConsiderations(notes: string): string[] {
  const raw = notes
    .split(/\n|\.|\u2022|\u2023|\u25E6|\u2043/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
  const unique = Array.from(new Set(raw));
  return unique.length > 0 ? unique : ["No safety notes provided."];
}

function buildCompletedExerciseEntry(snapshot: PatientRecordSnapshot, exerciseKey: RehabExerciseKey): DailyCareEntry {
  const patientId = snapshot.patient?.patientId;
  if (!patientId) throw new Error("Cannot update daily care without an active patient.");

  const existingEntry =
    snapshot.todayDailyCareEntry && !isSeededDemoDailyEntry(snapshot.todayDailyCareEntry)
      ? snapshot.todayDailyCareEntry
      : null;
  const now = new Date().toISOString();
  const assignedExerciseKeys = getAssignedDevelopmentRehabExercises(snapshot.rehabExerciseAssignments)
    .map((exercise) => exercise.key);
  const completedExerciseKeys = new Set(filterCompletedExerciseKeysForAssignments(
    existingEntry?.completedExerciseKeys,
    snapshot.rehabExerciseAssignments,
  ));
  completedExerciseKeys.has(exerciseKey)
    ? completedExerciseKeys.delete(exerciseKey)
    : completedExerciseKeys.add(exerciseKey);

  return {
    ...(existingEntry ?? {
      entryId: `dce-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
      patientId,
      entryDate: now.slice(0, 10),
      therapyCompleted: false,
      setsCompleted: 0,
      recommendedSets: 0,
      caregiverConcern: false,
      createdAt: now,
    }),
    patientId,
    carePlanId: existingEntry?.carePlanId ?? snapshot.carePlan?.planId ?? null,
    assignedExerciseKeys,
    completedExerciseKeys: Array.from(completedExerciseKeys),
    updatedAt: now,
  };
}

function withDailyCareEntry(snapshot: PatientRecordSnapshot, entry: DailyCareEntry): PatientRecordSnapshot {
  const hasEntry = snapshot.rehabDailyEntries.some((item) => item.entryDate === entry.entryDate);
  const rehabDailyEntries = (hasEntry
    ? snapshot.rehabDailyEntries.map((item) => item.entryDate === entry.entryDate ? entry : item)
    : [...snapshot.rehabDailyEntries, entry]).sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  return { ...snapshot, todayDailyCareEntry: entry, rehabDailyEntries };
}

function createTherapyCompletionUc3EvaluationKey(entryDate: string, now: Date): string {
  return `therapy_completed:${entryDate}:${now.toISOString()}`;
}

function getTherapyCompletionUc3StatusMessage(result: Uc3EvaluationServiceResult): string {
  if (result.status === "success") {
    const persisted = result.persistedResult;
    if (persisted.eventType === "INSUFFICIENT_DATA") {
      return "Therapy completion saved. Concierge needs more rehabilitation data before it can summarize progress.";
    }
    if (persisted.emergencyThresholdBreach || persisted.severity === "urgent") {
      return "Therapy completion saved. Rehabilitation progress updated with an urgent safety review result.";
    }
    if (persisted.requiresHumanReview) {
      return "Therapy completion saved. Rehabilitation progress updated with a provider review result.";
    }
    return "Therapy completion saved. Rehabilitation progress updated.";
  }

  if (result.status === "not_ready") {
    return "Therapy completion saved. Concierge needs more rehabilitation data before it can update progress.";
  }

  return "Therapy completion saved. Rehabilitation progress could not be updated.";
}

function getTherapyCompletionUc4StatusMessage(result: Uc4EvaluationServiceResult): string {
  if (result.status === "success") {
    if (result.runStatus === "completed") {
      return result.cards.length > 0
        ? "Care focus checklist updated."
        : "Care focus ran with no new checklist cards.";
    }
    if (result.runStatus === "paused") {
      return result.pauseReason
        ? `Care focus paused: ${result.pauseReason}.`
        : "Care focus paused.";
    }
    return "Care focus ran with no new checklist cards.";
  }

  if (result.status === "not_ready") {
    return "Care focus is not ready to update yet.";
  }

  return "Care focus could not be updated.";
}

function ContextCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.contextCard}>
      <Text style={styles.contextCardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function CareContextSummaryCard({
  item,
  secondary = false,
}: {
  item: PatientCareContextItem;
  secondary?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const sourceLabel = formatCareContextSource(item);
  const label = secondary ? "Background context" : null;

  return (
    <View style={[styles.careContextItemCard, secondary && styles.careContextItemSecondary]}>
      {label ? (
        <Text style={styles.backgroundContextTitle}>{label}</Text>
      ) : null}
      <Text style={styles.careContextItemTitle}>{item.plainTitle}</Text>
      <Text style={styles.careContextItemSummary}>{item.factualSummary}</Text>
      <Text style={styles.careContextItemMeta}>{sourceLabel}</Text>

      {item.sourceExcerpt ? (
        <Pressable
          style={styles.sourceExcerptToggle}
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? "Hide" : "Show"} source details for ${item.plainTitle}`}
        >
          <Text style={styles.sourceExcerptToggleText}>
            {expanded ? "Hide source details" : "View source details"}
          </Text>
        </Pressable>
      ) : null}

      {expanded ? (
        <View style={styles.sourceExcerptBox}>
          <Text style={styles.sourceExcerptText}>{item.sourceExcerpt}</Text>
        </View>
      ) : null}
    </View>
  );
}

function CareContextTimelineGroup({ group }: { group: CareContextDisplayGroup }) {
  return (
    <View style={styles.careContextTimelineGroup}>
      <Text style={styles.careContextTimelineTitle}>{group.title}</Text>
      {group.items.map(({ item, secondary }) => (
        <CareContextSummaryCard
          key={item.itemId}
          item={item}
          secondary={secondary}
        />
      ))}
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

function Uc3ResultCard({ display, onExplain }: { display: Uc3ResultDisplay; onExplain?: () => void }) {
  const toneStyle =
    display.tone === "urgent"
      ? styles.uc3ResultCardUrgent
      : display.tone === "review"
        ? styles.uc3ResultCardReview
        : null;

  return (
    <View style={[styles.uc3ResultCard, toneStyle]}>
      <View style={styles.uc3ResultHeader}>
        <Text style={styles.uc3ResultKicker}>{display.title}</Text>
        {display.reviewLabel ? (
          <Text
            style={[
              styles.uc3ResultBadge,
              display.tone === "urgent" ? styles.uc3ResultBadgeUrgent : null,
            ]}
          >
            {display.reviewLabel}
          </Text>
        ) : null}
      </View>
      <Text style={styles.uc3ResultStatus}>{display.statusLabel}</Text>
      {display.generatedAtLabel ? (
        <Text style={styles.uc3ResultMeta}>{display.generatedAtLabel}</Text>
      ) : null}
      {display.explanation ? (
        <Text style={styles.uc3ResultExplanation}>{display.explanation}</Text>
      ) : null}
      {display.dataQualityLabel ? (
        <Text style={styles.uc3ResultMeta}>{display.dataQualityLabel}</Text>
      ) : null}
      {display.detailLines.length > 0 ? (
        <View style={styles.uc3ResultDetails}>
          {display.detailLines.map((line) => (
            <Text key={line} style={styles.uc3ResultDetailLine}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      {onExplain ? (
        <Pressable style={styles.uc3ExplainButton} onPress={onExplain}>
          <Text style={styles.uc3ExplainButtonText}>Explain this result</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function RehabPlanMetricList({ metrics }: { metrics: CarePlanRehabMetric[] }) {
  return (
    <View style={styles.rehabGoalList}>
      <Text style={styles.rehabGoalTitle}>Rehabilitation targets</Text>
      {metrics.map((metric) => (
        <View key={metric.id} style={styles.rehabGoalRow}>
          <Text style={styles.rehabGoalName}>{metric.displayName}</Text>
          <Text style={styles.rehabGoalValue}>
            {formatRehabPlanMetricValue(metric)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function EditableSymptomBox({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: number | null;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.symptomBox} onPress={onPress}>
      <Text style={styles.symptomValue}>{Number.isFinite(value) ? value : "—"}</Text>
      <Text style={styles.symptomLabel}>{label} ›</Text>
    </Pressable>
  );
}

function EditableDailyFactBox({
  label,
  value,
  unit,
  onPress,
}: {
  label: string;
  value?: number | null;
  unit: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.dailyFactBox} onPress={onPress}>
      <Text style={styles.dailyFactValue}>{Number.isFinite(value) ? value : "—"}</Text>
      <Text style={styles.dailyFactLabel}>{label}</Text>
      <Text style={styles.dailyFactUnit}>{unit}</Text>
    </Pressable>
  );
}

function ExerciseChecklistRow({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.exerciseChecklistRow}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
    >
      <View
        style={[
          styles.completionCheckbox,
          checked && styles.completionCheckboxChecked,
        ]}
      >
        {checked ? <Text style={styles.completionCheckmark}>✓</Text> : null}
      </View>
      <Text style={styles.exerciseChecklistLabel}>{label}</Text>
    </Pressable>
  );
}

function formatRehabPlanMetricValue(metric: CarePlanRehabMetric): string {
  return `${formatRehabPlanNumber(metric.baselineValue, metric.metricKey)} -> ${formatRehabPlanNumber(
    metric.targetValue,
    metric.metricKey,
  )} ${metric.unit}`.trim();
}

function formatRehabPlanNumber(
  value: number | null | undefined,
  metricKey?: CarePlanRehabMetric["metricKey"],
): string {
  if (!Number.isFinite(value)) return "—";
  if (metricKey === "adherence") return Number(value).toFixed(2);
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function getDailyCareEditTitle(field: DailyCareEditField): string {
  switch (field) {
    case "setsCompleted":
      return "daily sets";
    case "exerciseRepetitions":
      return "exercise repetitions";
    case "romDegrees":
      return "ROM degrees";
    case "walkingMinutes":
      return "walking minutes";
    case "painScore":
      return "pain";
    case "fatigue":
      return "fatigue";
    default:
      return "entry";
  }
}

function getDailyCareEditPlaceholder(field: DailyCareEditField): string {
  switch (field) {
    case "setsCompleted":
      return "Completed sets";
    case "exerciseRepetitions":
      return "Repetition count";
    case "romDegrees":
      return "ROM degrees";
    case "walkingMinutes":
      return "Walking minutes";
    case "painScore":
      return "Pain score";
    case "fatigue":
      return "Value";
    default:
      return "Value";
  }
}

function validateDailyCareField(field: DailyCareEditField, value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Enter a valid number.";
  }
  if (field === "painScore" || field === "fatigue") return "";
  if (value < 0) return "Enter zero or a positive number.";
  if (field === "walkingMinutes" && value > 1440) {
    return "Walking minutes must fit within one day.";
  }
  if (field === "romDegrees" && value > 360) {
    return "ROM degrees must be 360 or less.";
  }
  return "";
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatSets(entry: DailyCareEntry | null): string {
  if (!entry) return "—";
  const completed = entry.setsCompleted > 0 && Number.isFinite(entry.setsCompleted)
    ? String(entry.setsCompleted)
    : "—";
  if (entry.recommendedSets > 0) {
    return `${completed}/${entry.recommendedSets}`;
  }
  return completed;
}

function isSeededDemoDailyEntry(entry: DailyCareEntry): boolean {
  return (
    entry.therapyDay === 21 &&
    entry.carePlanId === "careplan_abc123" &&
    entry.therapyCompleted === true &&
    entry.setsCompleted === 3 &&
    entry.recommendedSets === 3 &&
    entry.painBefore === 3 &&
    entry.painAfter === 4 &&
    entry.fatigue === 5 &&
    entry.assistanceRequired === "some" &&
    entry.caregiverConcern === false &&
    entry.notes === "Completed all exercises but shoulder movement looked about the same as last week."
  );
}

function formatLoggedBy(name: string, role: string): string {
  if (!isProvided(name) || !isProvided(role)) {
    return "Not provided";
  }
  return `${name} · ${role}`;
}

function isProvided(value?: string): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "not provided";
}

function formatCareTeam(value?: string): string {
  if (!value) return "Not provided";
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return "Not provided";
    const names = parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    return names.length > 0 ? names.join(", ") : "Not provided";
  } catch {
    return "Not provided";
  }
}

function formatCarePlanDate(value?: string): string {
  if (!value) return "Not provided";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function formatCarePlanStatus(value?: string): string {
  if (!value) return "Not provided";
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isMostActionableCarePlan(plan: CarePlan): boolean {
  const title = plan.title?.toLowerCase() ?? "";
  const description = plan.description?.toLowerCase() ?? "";
  return (
    title.includes("orthosis") ||
    title.includes("splint") ||
    description.includes("orthosis") ||
    description.includes("splint")
  );
}

function isMainCareContextItem(item: PatientCareContextItem): boolean {
  return item.handling.includes("care_planning_context");
}

function isAdditionalCareContextItem(item: PatientCareContextItem): boolean {
  return (
    item.handling.includes("slm_context_ready") &&
    !isMainCareContextItem(item) &&
    !item.handling.includes("raw_context_only") &&
    !item.handling.includes("needs_human_review")
  );
}

function buildCareContextGroups(
  events: PatientTimelineEvent[],
  items: PatientCareContextItem[],
): CareContextDisplayGroup[] {
  const itemsByEvent = new Map<
    PatientTimelineEvent["eventType"],
    { mainItems: PatientCareContextItem[]; backgroundItems: PatientCareContextItem[] }
  >();
  const sortedEvents = [...events].sort(
    (a, b) => a.daysFromFirstVisit - b.daysFromFirstVisit || a.visitIndex - b.visitIndex,
  );

  sortedEvents.forEach((event) => {
    itemsByEvent.set(event.eventType, {
      mainItems: [],
      backgroundItems: [],
    });
  });

  const ungroupedMainItems: PatientCareContextItem[] = [];
  const ungroupedBackgroundItems: PatientCareContextItem[] = [];

  items.forEach((item) => {
    const isMain = isMainCareContextItem(item);
    const isBackground = isAdditionalCareContextItem(item);
    if (!isMain && !isBackground) return;

    const relatedEventType = item.relatedTimelineEvent as PatientTimelineEvent["eventType"] | undefined;
    const eventItems = relatedEventType ? itemsByEvent.get(relatedEventType) : undefined;
    if (eventItems) {
      if (isMain) eventItems.mainItems.push(item);
      else eventItems.backgroundItems.push(item);
      return;
    }

    if (isMain) ungroupedMainItems.push(item);
    else ungroupedBackgroundItems.push(item);
  });

  const eventGroups = sortedEvents.flatMap((event) => {
    const eventItems = itemsByEvent.get(event.eventType);
    if (!eventItems) return [];
    const displayItems = toCareContextDisplayItems(eventItems.mainItems, eventItems.backgroundItems);
    if (displayItems.length === 0) return [];
    return [{
      key: event.eventId,
      title: formatCareContextEventTitle(event),
      items: displayItems,
    }];
  });
  const ungroupedItems = toCareContextDisplayItems(ungroupedMainItems, ungroupedBackgroundItems);

  return ungroupedItems.length > 0
    ? [
        ...eventGroups,
        {
          key: "ungrouped-care-context",
          title: "Additional care context",
          items: ungroupedItems,
        },
      ]
    : eventGroups;
}

function formatCareContextEventTitle(event: PatientTimelineEvent): string {
  return event.title || formatCareContextEventType(event.eventType);
}

function formatCareContextEventType(type: PatientTimelineEvent["eventType"]): string {
  switch (type) {
    case "pre_op_planning":
      return "Pre-op planning";
    case "operative_event":
      return "Operative context";
    case "discharge_restrictions":
      return "Discharge restrictions";
    case "post_op_follow_up":
      return "Post-op follow-up";
    case "ot_orthosis_plan":
      return "Orthosis plan";
    case "equipment_orthotics_support":
      return "Equipment and brace support";
    default:
      return String(type).replace(/_/g, " ");
  }
}

function formatCareContextSource(item: PatientCareContextItem): string {
  const documentName = item.sourceDocument
    .replace(/_deidentified_timeline\.json$/i, "")
    .replace(/_deidentified\.xml$/i, "");
  const visitText = typeof item.visitIndex === "number" ? `visit ${item.visitIndex}` : null;
  return [documentName, item.sourceSection, visitText].filter(Boolean).join(" \u00B7 ");
}

function toCareContextDisplayItems(
  mainItems: PatientCareContextItem[],
  backgroundItems: PatientCareContextItem[],
): CareContextDisplayItem[] {
  return [
    ...mainItems.map((item) => ({ item, secondary: false })),
    ...backgroundItems.map((item) => ({ item, secondary: true })),
  ];
}

function ProgressMetric({
  label,
  measurements,
  target,
  maxVal,
  unit,
}: {
  label: string;
  measurements: RehabilitationMeasurement[];
  target: number;
  maxVal: number;
  unit: string;
}) {
  if (measurements.length === 0) {
    return (
      <View style={styles.mlUnavailableCard}>
        <Text style={styles.mlUnavailableLabel}>{label}</Text>
        <Text style={styles.mlUnavailableText}>No data yet.</Text>
      </View>
    );
  }

  const latest = measurements[measurements.length - 1];
  const first = measurements[0];
  const progress = Math.min(latest.value / maxVal, 1);
  const targetPercent = Math.min(target / maxVal, 1) * 100;
  const delta = latest.value - first.value;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);

  return (
    <View style={styles.progressMetric}>
      <View style={styles.progressMetricHeader}>
        <Text style={styles.progressMetricLabel}>{label}</Text>
        <Text style={styles.progressMetricValue}>
          {latest.value.toFixed(1)} {unit}{"  "}
          <Text style={{ color: delta >= 0 ? "#16A34A" : "#DC2626", fontSize: 12 }}>
            {deltaStr} from baseline
          </Text>
        </Text>
      </View>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${progress * 100}%` },
          ]}
        />
        <View
          style={[
            styles.progressTargetMarker,
            { left: `${targetPercent}%` },
          ]}
        />
      </View>
      <Text style={styles.progressTargetLabel}>
        Target: {target} {unit}
      </Text>
    </View>
  );
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
  patientName: {
    color: AppTheme.colors.textMuted,
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
    marginBottom: 4,
  },
  safetyHint: {
    color: "#92400E",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 10,
  },
  safetyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(180,83,9,0.15)",
    gap: 8,
  },
  safetyBullet: {
    color: "#B45309",
    fontSize: 16,
    fontWeight: "900",
  },
  safetyLine: {
    flex: 1,
    color: "#92400E",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
  },
  safetyChevron: {
    color: "#B45309",
    fontSize: 20,
    fontWeight: "900",
  },
  safetyText: {
    color: "#92400E",
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "700",
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.46)",
    justifyContent: "center",
    padding: 20,
  },
  confirmSheet: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    padding: 22,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    ...AppTheme.shadow,
  },
  confirmTitle: {
    color: AppTheme.colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
  },
  confirmMessage: {
    color: AppTheme.colors.textSoft,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    marginTop: 8,
  },
  confirmActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18,
  },
  confirmButton: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmCancelButton: {
    backgroundColor: AppTheme.colors.softSurface,
  },
  confirmPrimaryButton: {
    backgroundColor: AppTheme.colors.brand,
  },
  confirmCancelText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    fontWeight: "900",
  },
  confirmPrimaryText: {
    color: AppTheme.colors.white,
    fontSize: 14,
    fontWeight: "900",
  },
  explainOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  explainSheet: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    padding: 22,
  },
  explainHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  explainKicker: {
    color: AppTheme.colors.brand,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  explainClose: {
    color: AppTheme.colors.textSoft,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 26,
  },
  explainTitle: {
    color: AppTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 23,
    marginBottom: 16,
  },
  explainBlock: {
    marginBottom: 14,
  },
  explainLabel: {
    color: AppTheme.colors.sectionText,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  explainBody: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    lineHeight: 21,
  },
  explainSlmButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 6,
  },
  explainSlmText: {
    color: AppTheme.colors.white,
    fontSize: 15,
    fontWeight: "900",
  },
  editOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  editSheet: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    padding: 22,
  },
  editTitle: {
    color: AppTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 14,
  },
  editInput: {
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: AppTheme.colors.text,
  },
  editError: {
    color: AppTheme.colors.danger,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 8,
  },
  editActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 16,
  },
  editButton: {
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  editCancel: {
    backgroundColor: AppTheme.colors.softSurface,
  },
  editCancelText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    fontWeight: "900",
  },
  editSaveText: {
    color: AppTheme.colors.white,
    fontSize: 14,
    fontWeight: "900",
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
  contextGrid: {
    gap: 14,
    marginBottom: 24,
  },
  contextCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 16,
  },
  contextCardTitle: {
    color: AppTheme.colors.sectionText,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  contextMutedText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
  },
  contextBulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    paddingVertical: 5,
  },
  contextBulletDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: AppTheme.colors.brand,
    marginTop: 6,
  },
  contextBulletText: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "800",
  },
  contextToggle: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    paddingHorizontal: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  contextToggleText: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
  },
  contextToggleCount: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  careContextGroupCard: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 14,
    marginTop: 10,
  },
  careContextGroupTitle: {
    color: AppTheme.colors.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "900",
  },
  careContextGroupMeta: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    marginTop: 5,
  },
  careContextGroupSummary: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: 8,
  },
  careContextItemsBlock: {
    marginTop: 12,
  },
  careContextItemsTitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  backgroundContextBlock: {
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    marginTop: 12,
    paddingTop: 12,
  },
  backgroundContextTitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  careContextTimelineGroup: {
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    paddingTop: 12,
    marginTop: 12,
  },
  careContextTimelineTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "900",
  },
  careContextItemCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 14,
    marginTop: 10,
  },
  careContextItemSecondary: {
    backgroundColor: AppTheme.colors.softSurface,
  },
  careContextItemTitle: {
    color: AppTheme.colors.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "900",
  },
  careContextItemSummary: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: 6,
  },
  careContextItemMeta: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    marginTop: 8,
  },
  sourceExcerptToggle: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: AppTheme.colors.brandSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 10,
  },
  sourceExcerptToggleText: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: "900",
  },
  sourceExcerptBox: {
    borderLeftWidth: 3,
    borderLeftColor: AppTheme.colors.brand,
    paddingLeft: 10,
    marginTop: 10,
  },
  sourceExcerptText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  sectionTitle: {
    color: AppTheme.colors.sectionText,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 14,
  },
  historyToggle: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    paddingHorizontal: 14,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  historyToggleText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "900",
  },
  historyToggleCount: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  carePlanCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 18,
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
  carePlanHeaderText: {
    flex: 1,
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
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
  },
  carePlanSubtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
  },
  emptyCarePlanText: {
    color: AppTheme.colors.text,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "800",
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
  activityList: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  activityEmptyText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  rehabGoalList: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    gap: 10,
  },
  rehabGoalTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  rehabGoalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rehabGoalName: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  rehabGoalValue: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "900",
    textAlign: "right",
  },
  guidanceCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 14,
  },
  activityTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  activitySubtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    marginTop: -4,
  },
  activityRow: {
    flexDirection: "row",
    gap: 10,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: AppTheme.colors.brand,
    marginTop: 6,
  },
  activityTextBlock: {
    flex: 1,
  },
  activityDescription: {
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  activityStatus: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "800",
    marginTop: 2,
  },
  timelineSource: {
    color: AppTheme.colors.textSoft,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "900",
    marginTop: 4,
  },
  timelineWhy: {
    color: AppTheme.colors.sectionText,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "800",
    marginTop: 4,
  },
  relatedEventList: {
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    marginTop: 14,
    paddingTop: 12,
    gap: 10,
  },
  relatedEventRow: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 12,
    padding: 12,
  },
  relatedEventTitle: {
    color: AppTheme.colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
  },
  relatedEventBody: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    marginTop: 3,
  },
  relatedEventMeta: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    marginTop: 4,
  },
  assignedExerciseBlock: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: AppTheme.colors.border,
    paddingVertical: 14,
    marginBottom: 14,
    gap: 10,
  },
  assignedExerciseTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  assignedExerciseEmpty: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  exerciseChecklist: {
    gap: 8,
  },
  exerciseChecklistRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 38,
  },
  exerciseChecklistLabel: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  checkInAccordionCard: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    marginBottom: 14,
    overflow: "hidden",
  },
  checkInAccordionCardLast: {
    marginBottom: 18,
  },
  checkInAccordionCardAlert: {
    borderColor: AppTheme.colors.danger,
    backgroundColor: "#FEF2F2",
  },
  checkInAccordionHeader: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  checkInAccordionHeaderText: {
    flex: 1,
  },
  checkInAccordionTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  checkInAccordionTitleAlert: {
    color: AppTheme.colors.danger,
  },
  checkInAccordionSummary: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 3,
  },
  checkInAccordionChevron: {
    width: 18,
    color: AppTheme.colors.textMuted,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  checkInAccordionBody: {
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    padding: 14,
  },
  skippedReasonBlock: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 14,
    marginBottom: 14,
    gap: 10,
  },
  skippedReasonTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  reasonOptionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  reasonOption: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  reasonOptionSelected: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
  },
  reasonOptionText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  reasonOptionTextSelected: {
    color: AppTheme.colors.brand,
  },
  completionRow: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 14,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  completionRowDisabled: {
    opacity: 0.65,
  },
  completionCheckbox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: AppTheme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppTheme.colors.surface,
  },
  completionCheckboxChecked: {
    backgroundColor: AppTheme.colors.brand,
  },
  completionCheckmark: {
    color: AppTheme.colors.white,
    fontSize: 15,
    fontWeight: "900",
  },
  completionTextBlock: {
    flex: 1,
  },
  completionTitle: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  completionSubtitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 3,
  },
  uc3CompletionStatus: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    marginTop: -6,
    marginBottom: 14,
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
  rehabMetricGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  dailyFactBox: {
    flex: 1,
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
    minHeight: 94,
  },
  dailyFactValue: {
    color: AppTheme.colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  dailyFactLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 5,
    textAlign: "center",
  },
  dailyFactUnit: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
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
  urgentSymptomBlock: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: AppTheme.colors.border,
    paddingVertical: 14,
    marginBottom: 18,
    gap: 10,
  },
  urgentSymptomTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  uc3ResultCard: {
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: 12,
    backgroundColor: AppTheme.colors.white,
    padding: 14,
    marginBottom: 18,
    gap: 8,
  },
  uc3ResultCardReview: {
    borderColor: "#F59E0B",
    backgroundColor: "#FFFBEB",
  },
  uc3ResultCardUrgent: {
    borderColor: AppTheme.colors.danger,
    backgroundColor: "#FEF2F2",
  },
  uc3ResultHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  uc3ResultKicker: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  uc3ResultBadge: {
    borderRadius: 999,
    backgroundColor: "#FDE68A",
    color: "#92400E",
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  uc3ResultBadgeUrgent: {
    backgroundColor: "#FEE2E2",
    color: AppTheme.colors.danger,
  },
  uc3ResultStatus: {
    color: AppTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  uc3ResultMeta: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  uc3ResultExplanation: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  uc3ResultDetails: {
    gap: 4,
  },
  uc3ResultDetailLine: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  uc3ExplainButton: {
    alignSelf: "flex-start",
    borderRadius: 8,
    backgroundColor: AppTheme.colors.brand,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 2,
  },
  uc3ExplainButtonText: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: "900",
  },
  uc4PriorityBlock: {
    borderTopWidth: 1,
    borderColor: AppTheme.colors.border,
    paddingTop: 14,
    marginBottom: 18,
    gap: 8,
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
  progressTargetLabel: {
    fontSize: 11,
    color: AppTheme.colors.textMuted,
    marginTop: 4,
  },
  mlUnavailableCard: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  mlUnavailableLabel: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 4,
  },
  mlUnavailableText: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
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
});
