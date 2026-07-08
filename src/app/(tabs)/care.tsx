import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { AppIcon } from "@/components/AppIcon";
import { MainTabHeader } from "@/components/MainTabHeader";
import { SlmInsightSheet } from "@/components/slm-insight-sheet";
import { AppTheme } from "@/constants/theme";
import { useCriticalAlert } from "@/contexts/critical-alert-context";
import { usePatientRecord } from "@/contexts/patient-record-context";
import {
  getDailyCareEntry,
  upsertDailyCareEntry,
  type CarePlan,
  type DailyCareEntry,
  type PatientTimelineEvent,
} from "@/data";
import { getRehabilitationMeasurements } from "@/data/repositories/rehabilitationMeasurementRepository";
import type { RehabilitationMeasurement, RehabilitationMeasurementType } from "@/data/types";
import { getOnboardingProfile } from "@/services/onboarding/onboardingService";
import { useActivePatientView } from "@/hooks/useActivePatientView";
import {
  displayClinical,
  getCaregiverDisplay,
  getCaregiverRoleDisplay,
  getPatientAgeDisplay,
  getPatientDisplayName,
  getPrimaryDiagnosisDisplay,
} from "@/utils/patientDisplay";

export default function CareScreen() {
  const router = useRouter();
  const profile = getOnboardingProfile();
  const { patientId, snapshot } = usePatientRecord();
  const { reopenOnCareFocus } = useCriticalAlert();
  const activePatient = useActivePatientView();
  const patientName = getPatientDisplayName(activePatient);
  const diagnosis = getPrimaryDiagnosisDisplay(activePatient);
  const carePlan = snapshot?.carePlan ?? null;
  const carePlanHistory = snapshot?.carePlans ?? [];
  const timelineEvents = snapshot?.timelineEvents ?? [];
  const mostActionableCarePlan =
    carePlan ?? carePlanHistory.find(isMostActionableCarePlan) ?? null;
  const secondaryCarePlanHistory = carePlanHistory.filter(
    (plan) => plan.planId !== mostActionableCarePlan?.planId,
  );
  const importantClinicalEvents = timelineEvents.filter(
    (event) =>
      !(
        event.eventType === "ot_orthosis_plan" &&
        mostActionableCarePlan &&
        isMostActionableCarePlan(mostActionableCarePlan)
      ),
  );
  const { patient, loading, error, lastSynced } = useAppSelector(state => state.patient);
  const [patientProfile, setPatientProfile] = useState<any>(null);
  
  useEffect(() => {
      if (patient) {
        console.log('fhirBundleImported event listener: ', Object.keys(patient));
        const patientData =  patient["entry"]?.map(
            (entry: any) => {
              return entry && entry.resource && entry.resource.resourceType === "Patient" ? entry : null;
            }
        );
        setPatientProfile(patientData);
      }
  }, [patient]);

  const caregiverDisplay = getCaregiverDisplay(activePatient);
  const caregiverFirstName = isProvided(caregiverDisplay)
    ? caregiverDisplay.trim().split(/\s+/)[0]
    : "";
  const caregiverRole = getCaregiverRoleDisplay(activePatient);
  const patientPersonalInfo = patientProfile?.filter((entry: any) => entry && entry.resource && entry.resource.resourceType === "Patient")[0]?.resource;
  const patientFirstName = patientPersonalInfo?.name?.[0]?.given?.[0] || "Patient";
  const patientFamilyName = patientPersonalInfo?.name?.[0]?.family || "Name";
  const patientAge = patientPersonalInfo?.birthDate ? calculateAge(new Date(patientPersonalInfo?.birthDate)) : "N/A";

  

  // Re-surface the severity-3 critical-alert popup whenever the Care tab is
  // (re)opened, until the alert is dismissed or resolved.
  useFocusEffect(
    useCallback(() => {
      reopenOnCareFocus();
    }, [reopenOnCareFocus]),
  );

  // Daily care entry is sourced from SQLite only. Opening the screen must not
  // seed demo values for a patient that has not recorded care today.
  const [, setEntryVersion] = useState(0);
  const entry = patientId ? getDailyCareEntry(patientId) : null;
  const dailyEntry = entry && !isSeededDemoDailyEntry(entry) ? entry : null;

  const [editingField, setEditingField] = useState<null | "setsCompleted" | "painBefore" | "painAfter" | "fatigue" | "notes">(null);
  const [editDraft, setEditDraft] = useState("");

  const rehabMeasurements = useMemo(() => {
    if (!patientId) return [];
    return getRehabilitationMeasurements(patientId, "rehabilitation_berg_balance")
      .concat(getRehabilitationMeasurements(patientId, "rehabilitation_gait_speed"));
  }, [patientId]);

  const bergBalanceMeasurements = rehabMeasurements.filter(
    (m) => m.type === "rehabilitation_berg_balance",
  );
  const gaitSpeedMeasurements = rehabMeasurements.filter(
    (m) => m.type === "rehabilitation_gait_speed",
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

  const openFieldEdit = (field: "setsCompleted" | "painBefore" | "painAfter" | "fatigue" | "notes") => {
    setEditingField(field);
    setEditDraft(String(dailyEntry?.[field] ?? ""));
  };

  const saveFieldEdit = () => {
    if (!editingField || !patientId) {
      setEditingField(null);
      return;
    }
    const isNumeric = editingField !== "notes";
    const trimmedDraft = editDraft.trim();
    const newValue = isNumeric
      ? trimmedDraft.length > 0
        ? Number(trimmedDraft)
        : undefined
      : editDraft;
    upsertDailyCareEntry({
      ...(dailyEntry ?? {}),
      patientId,
      carePlanId: dailyEntry?.carePlanId ?? carePlan?.planId,
      [editingField]: newValue,
    });
    setEntryVersion((version) => version + 1);
    setEditingField(null);
    setEditDraft("");
  };
  const safetyConsiderations = parseSafetyConsiderations(
    profile.safety?.safetyNotes ?? "No safety notes provided.",
  );
  const [openConsideration, setOpenConsideration] = useState<string | null>(null);
  const [slmOpen, setSlmOpen] = useState(false);
  const [slmPrompt, setSlmPrompt] = useState("");

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <ScrollView
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

        <ObservationVitalsCard />

        {mostActionableCarePlan && !carePlan ? (
          <>
            <Text style={styles.sectionTitle}>Current Care Focus</Text>
            <View style={styles.carePlanCard}>
              <Text style={styles.carePlanKicker}>What to focus on now</Text>
              <Text style={styles.carePlanTitle}>
                {mostActionableCarePlan.title || "Documented care guidance"}
              </Text>
              {mostActionableCarePlan.description ? (
                <Text style={styles.carePlanSubtitle}>
                  {mostActionableCarePlan.description}
                </Text>
              ) : null}
              <Text style={styles.emptyCarePlanText}>
                Guidance documented in care records. This section does not
                create tasks or reminders.
              </Text>
            </View>
          </>
        ) : null}

        {secondaryCarePlanHistory.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Other Care Guidance</Text>
            <View style={styles.carePlanCard}>
              <Text style={styles.carePlanKicker}>Additional care notes from the record</Text>
              <Text style={styles.emptyCarePlanText}>
                These notes are documented in care records. Items with unknown status are not
                treated as current and do not create tasks or reminders.
              </Text>
              <View style={styles.activityList}>
                <Text style={styles.activityTitle}>Documented guidance</Text>
                {secondaryCarePlanHistory.map((plan) => (
                  <View key={plan.planId} style={styles.activityRow}>
                    <View style={styles.activityDot} />
                    <View style={styles.activityTextBlock}>
                      <Text style={styles.activityDescription}>
                        {plan.title || "Documented care guidance"}
                      </Text>
                      {plan.description ? (
                        <Text style={styles.activityStatus}>{plan.description}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : null}

        {importantClinicalEvents.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Important Health Events</Text>
            <View style={styles.carePlanCard}>
              <Text style={styles.carePlanKicker}>Documented events from care records</Text>
              <Text style={styles.emptyCarePlanText}>
                Important events documented in the record. These facts do
                not create tasks, reminders, diagnoses, or plans.
              </Text>
              <View style={styles.activityList}>
                {importantClinicalEvents.map((event) => (
                  <View key={event.eventId} style={styles.activityRow}>
                    <View style={styles.activityDot} />
                    <View style={styles.activityTextBlock}>
                      <Text style={styles.activityDescription}>{event.title}</Text>
                      <Text style={styles.activityStatus}>{event.summary}</Text>
                      <Text style={styles.timelineSource}>
                        {formatTimelineSource(event)}
                      </Text>
                      <Text style={styles.timelineWhy}>
                        {event.clinicalRelevance}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : null}

        {carePlan ? (
          <>
            <View style={styles.safetyCard}>
              <Text style={styles.safetyKicker}>Safety Considerations</Text>
              <Text style={styles.safetyHint}>
                Tap any consideration for details and a Concierge explanation.
              </Text>
              {safetyConsiderations.map((consideration, idx) => (
                <Pressable
                  key={idx}
                  style={styles.safetyRow}
                  onPress={() => setOpenConsideration(consideration)}
                >
                  <Text style={styles.safetyBullet}>•</Text>
                  <Text style={styles.safetyLine}>{consideration}</Text>
                  <Text style={styles.safetyChevron}>›</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionTitle}>Current Care Focus</Text>

            <View style={styles.carePlanCard}>
              <View style={styles.carePlanHeader}>
                <View style={styles.carePlanHeaderText}>
                  <Text style={styles.carePlanKicker}>What to focus on now</Text>
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

              <View style={styles.activityList}>
                <Text style={styles.activityTitle}>Activities</Text>
                {carePlan.activities.map((activity) => (
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
                ))}
              </View>

              {dailyEntry ? (
                <>
                  <Pressable style={styles.setsRow} onPress={() => openFieldEdit("setsCompleted")}>
                    <View>
                      <Text style={styles.setsLabel}>Daily Sets</Text>
                      <Text style={styles.setsValue}>
                        {formatSets(dailyEntry)}
                      </Text>
                    </View>

                    {dailyEntry.recommendedSets > 0 ? (
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

                  <View style={styles.symptomRow}>
                    <EditableSymptomBox
                      label="Pain Before"
                      value={dailyEntry.painBefore}
                      onPress={() => openFieldEdit("painBefore")}
                    />
                    <EditableSymptomBox
                      label="Pain After"
                      value={dailyEntry.painAfter}
                      onPress={() => openFieldEdit("painAfter")}
                    />
                    <EditableSymptomBox
                      label="Fatigue"
                      value={dailyEntry.fatigue}
                      onPress={() => openFieldEdit("fatigue")}
                    />
                  </View>

                  <ProgressMetric
                    label="Functional Task Score"
                    measurements={bergBalanceMeasurements}
                    target={56}
                    maxVal={56}
                    unit="pts"
                  />

                  <ProgressMetric
                    label="Guided Movement Score"
                    measurements={gaitSpeedMeasurements}
                    target={1.0}
                    maxVal={1.5}
                    unit="m/s"
                  />

                  {cpProgressMeasurements.length > 0 ? (
                    <ProgressMetric
                      label="CP progress (most recent)"
                      measurements={cpProgressMeasurements}
                      target={1}
                      maxVal={1}
                      unit=""
                    />
                  ) : null}

                  <Pressable style={styles.notesCard} onPress={() => openFieldEdit("notes")}>
                    <Text style={styles.notesLabel}>Caregiver Note · tap to edit</Text>
                    <Text style={styles.notesText}>{dailyEntry.notes || "Add caregiver note"}</Text>
                  </Pressable>

                  <View style={styles.consentRow}>
                    <View style={styles.consentDot} />
                    <Text style={styles.consentText}>
                      Sharing with provider enabled
                    </Text>
                  </View>
                </>
              ) : (
                <View style={styles.noDailyEntryCard}>
                  <Text style={styles.noDailyEntryTitle}>No daily care entry recorded yet.</Text>
                  <Text style={styles.noDailyEntryText}>
                    Add today&apos;s completed sets, pain, fatigue, or caregiver note.
                  </Text>
                  <View style={styles.noDailyEntryActions}>
                    <Pressable style={styles.addEntryButton} onPress={() => openFieldEdit("setsCompleted")}>
                      <Text style={styles.addEntryButtonText}>Add sets</Text>
                    </Pressable>
                    <Pressable style={styles.addEntryButton} onPress={() => openFieldEdit("painBefore")}>
                      <Text style={styles.addEntryButtonText}>Add pain</Text>
                    </Pressable>
                    <Pressable style={styles.addEntryButton} onPress={() => openFieldEdit("fatigue")}>
                      <Text style={styles.addEntryButtonText}>Add fatigue</Text>
                    </Pressable>
                    <Pressable style={styles.addEntryButton} onPress={() => openFieldEdit("notes")}>
                      <Text style={styles.addEntryButtonText}>Add note</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>

            <Text style={styles.sectionTitle}>Care Analysis</Text>

            <Pressable
              style={styles.mlButton}
              onPress={() => router.push("/care-management")}
            >
              <Text style={styles.mlButtonKicker}>ML Care Analysis</Text>
              <Text style={styles.mlButtonText}>
                Review anomaly detection, wearable scenario details, and generated
                care explanation.
              </Text>
              <Text style={styles.mlButtonLink}>Open care analysis →</Text>
            </Pressable>
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
      </ScrollView>

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

      {/* Field edit modal (pain before/after, fatigue, notes) */}
      <Modal
        visible={editingField !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingField(null)}
      >
        <Pressable style={styles.editOverlay} onPress={() => setEditingField(null)}>
          <Pressable style={styles.editSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.editTitle}>
              Edit {editingField?.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
            </Text>
            {editingField === "notes" ? (
              <TextInput
                style={[styles.editInput, styles.editInputMultiline]}
                value={editDraft}
                onChangeText={setEditDraft}
                placeholder="Caregiver note…"
                multiline
                textAlignVertical="top"
                autoFocus
              />
            ) : (
              <TextInput
                style={styles.editInput}
                value={editDraft}
                onChangeText={setEditDraft}
                placeholder="0–10"
                keyboardType="numeric"
                autoFocus
              />
            )}
            <View style={styles.editActions}>
              <Pressable
                style={[styles.editButton, styles.editCancel]}
                onPress={() => setEditingField(null)}
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

function CarePlanMeta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.carePlanMetaItem}>
      <Text style={styles.carePlanMetaLabel}>{label}</Text>
      <Text style={styles.carePlanMetaValue}>{value}</Text>
    </View>
  );
}

function EditableSymptomBox({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: number;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.symptomBox} onPress={onPress}>
      <Text style={styles.symptomValue}>{value ?? "–"}/10</Text>
      <Text style={styles.symptomLabel}>{label} ›</Text>
    </Pressable>
  );
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

function formatSets(entry: DailyCareEntry): string {
  const completed = entry.setsCompleted > 0 && Number.isFinite(entry.setsCompleted)
    ? String(entry.setsCompleted)
    : "Not provided";
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
    entry.functionalTaskScore === 2.6 &&
    entry.guidedMovementScore === 55 &&
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

function formatTimelineSource(event: PatientTimelineEvent): string {
  return `${event.sourceFile} · visit ${event.visitIndex} · ${event.sourceSection} · ${event.confidence} confidence`;
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
  editInputMultiline: {
    minHeight: 90,
    textAlignVertical: "top",
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
    marginBottom: 16,
    gap: 12,
  },
  activityTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
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
  noDailyEntryCard: {
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 16,
    padding: 16,
    marginTop: 2,
  },
  noDailyEntryTitle: {
    color: AppTheme.colors.text,
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 6,
  },
  noDailyEntryText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
  },
  noDailyEntryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
  },
  addEntryButton: {
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addEntryButtonText: {
    color: AppTheme.colors.white,
    fontSize: 13,
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
