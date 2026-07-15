import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { AppIcon } from "@/components/AppIcon";
import { MainTabHeader } from "@/components/MainTabHeader";
import { SlmInsightSheet } from "@/components/slm-insight-sheet";
import { AppTheme } from "@/constants/theme";
import { usePatientRecord } from "@/contexts/patient-record-context";
import { useActivePatientView } from "@/hooks/useActivePatientView";
import {
  deleteMedication,
  getActiveMedications,
  getActiveMedicationSchedules,
  getMedicationById,
  getMedicationConfirmationPreference,
  getMedicationConfirmationRequirementsForPatient,
  upsertMedication,
  upsertMedicationSchedule,
  type Medication,
  type MedicationCandidate,
  type MedicationConfirmationPreference,
  type MedicationConfirmationRequirement,
  type MedicationSchedule,
} from "@/data";
import { audit } from "@/services/audit/auditService";
import { getPatientDisplayName } from "@/utils/patientDisplay";

type MedStatus = "pending" | "confirmed";

interface MedRow {
  med: Medication;
  schedule?: MedicationSchedule;
  status: MedStatus;
  accent: string;
  confirmationRequired: boolean;
  confirmationLabel?: "Required by care team" | "Confirmation selected" | "Confirmation preference saved";
}

const CARE_PLAN_ACCENT = "#F5B800";
const CUSTOM_ACCENT = "#7C3AED";
const UNSAVED_PREFERENCE_TIMESTAMP = new Date(0).toISOString();

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

/** Build the joined med+schedule rows from the DB. */
function loadMedRows(patientId: string): MedRow[] {
  const meds = getActiveMedications(patientId);
  const schedules = getActiveMedicationSchedules(patientId);
  let preference: Pick<
    MedicationConfirmationPreference,
    "confirmationMode" | "selectedMedicationIds" | "createdAt"
  >;
  let requirements: Record<string, MedicationConfirmationRequirement>;
  try {
    preference = getMedicationConfirmationPreference(patientId);
    requirements = getMedicationConfirmationRequirementsForPatient(patientId);
  } catch {
    preference = {
      confirmationMode: "all",
      selectedMedicationIds: [],
      createdAt: UNSAVED_PREFERENCE_TIMESTAMP,
    };
    requirements = {};
  }
  const hasSavedPreference = preference.createdAt !== UNSAVED_PREFERENCE_TIMESTAMP;
  const hasSavedRequirements = Object.keys(requirements).length > 0;
  return meds.map((med) => {
    const schedule = schedules.find((s) => s.medicationId === med.medicationId);
    const requirement = requirements[med.medicationId];
    const required = requirement?.confirmationRequirement === "required";
    const confirmationRequired =
      required ||
      (preference.confirmationMode === "all" && hasSavedPreference) ||
      (preference.confirmationMode === "personalized" &&
        preference.selectedMedicationIds.includes(med.medicationId)) ||
      (!hasSavedPreference && !hasSavedRequirements && med.source === "fhir");
    return {
      med,
      schedule,
      status: "pending" as MedStatus,
      accent: med.source === "custom" ? CUSTOM_ACCENT : CARE_PLAN_ACCENT,
      confirmationRequired,
      confirmationLabel: confirmationRequired
        ? required
          ? "Required by care team"
          : hasSavedPreference && schedule
            ? "Confirmation selected"
            : hasSavedPreference
              ? "Confirmation preference saved"
              : "Confirmation selected"
        : undefined,
    };
  });
}

export default function MedicationsScreen() {
  const router = useRouter();
  const { patientId, snapshot, refresh } = usePatientRecord();
  const activePatient = useActivePatientView();

  const patientFirstName =
    getPatientDisplayName(activePatient).trim().split(/\s+/)[0] || "Patient";

  const [rows, setRows] = useState<MedRow[]>(() =>
    patientId ? loadMedRows(patientId) : [],
  );

  // Edit / add / SLM-check modal state
  const [editing, setEditing] = useState<MedRow | "new" | null>(null);
  const [editName, setEditName] = useState("");
  const [editDose, setEditDose] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [editTime, setEditTime] = useState("");
  const [showOtherCurrentMedications, setShowOtherCurrentMedications] = useState(false);
  const [showMedicationHistory, setShowMedicationHistory] = useState(false);
  const [slmCheckMed, setSlmCheckMed] = useState<Medication | null>(null);

  const reload = useCallback(() => {
    if (patientId) setRows(loadMedRows(patientId));
  }, [patientId]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (!patientId) {
        setRows([]);
        return;
      }
      setRows(loadMedRows(patientId));
    }, 0);

    return () => clearTimeout(handle);
  }, [patientId, snapshot?.lastRefreshedAt, snapshot?.medications.length]);

  const nextDue = rows.find((r) => r.confirmationRequired && r.status === "pending");
  const confirmationRequiredRows = rows.filter((row) => row.confirmationRequired);
  const otherActiveRows = rows.filter((row) => !row.confirmationRequired);
  const medicationCandidates =
    snapshot?.medicationCandidates.filter(
      (candidate) => !rows.some((row) => row.med.medicationId === candidate.candidateId),
    ) ?? [];

  const toggleConfirm = (medId: string) => {
    setRows((current) =>
      current.map((r) =>
        r.med.medicationId === medId
          ? { ...r, status: r.status === "confirmed" ? "pending" : "confirmed" }
          : r,
      ),
    );
    const row = rows.find((r) => r.med.medicationId === medId);
    if (row && patientId) {
      audit({
        actor: "caregiver",
        action: row.status === "confirmed" ? "unconfirm_medication" : "confirm_medication",
        resourceType: "medication",
        resourceId: medId,
        patientId,
        payload: { name: row.med.name },
      });
    }
  };

  const openEdit = (row: MedRow) => {
    setEditing(row);
    setEditName(row.med.name);
    setEditDose(row.med.dosage ?? "");
    setEditInstructions(row.med.frequency ?? "");
    setEditTime(row.schedule?.timeOfDay ?? "");
  };

  const openAdd = () => {
    setEditing("new");
    setEditName("");
    setEditDose("");
    setEditInstructions("");
    setEditTime("08:00");
  };

  const saveEdit = () => {
    if (!patientId || !editing) return;
    if (editing === "new") {
      const medId = makeId("med");
      upsertMedication({
        medicationId: medId,
        patientId,
        name: editName.trim() || "Unnamed medication",
        dosage: editDose.trim() || undefined,
        frequency: editInstructions.trim() || undefined,
        active: true,
        source: "custom",
      });
      if (editTime.trim()) {
        upsertMedicationSchedule({
          scheduleId: makeId("sched"),
          medicationId: medId,
          patientId,
          timeOfDay: editTime.trim(),
          active: true,
          createdAt: new Date().toISOString(),
        });
      }
      audit({
        actor: "caregiver",
        action: "add_medication",
        resourceType: "medication",
        resourceId: medId,
        patientId,
        payload: { name: editName.trim(), source: "custom" },
      });
    } else {
      const updated: Medication = {
        ...editing.med,
        name: editName.trim() || editing.med.name,
        dosage: editDose.trim() || undefined,
        frequency: editInstructions.trim() || undefined,
        source: editing.med.source ?? "care_plan",
      };
      upsertMedication(updated);
      if (editing.schedule && editTime.trim()) {
        upsertMedicationSchedule({ ...editing.schedule, timeOfDay: editTime.trim() });
      } else if (!editing.schedule && editTime.trim()) {
        upsertMedicationSchedule({
          scheduleId: makeId("sched"),
          medicationId: editing.med.medicationId,
          patientId,
          timeOfDay: editTime.trim(),
          active: true,
          createdAt: new Date().toISOString(),
        });
      }
      audit({
        actor: "caregiver",
        action: "edit_medication",
        resourceType: "medication",
        resourceId: editing.med.medicationId,
        patientId,
        payload: { name: editName.trim() },
      });
    }
    setEditing(null);
    refresh();
    reload();
  };

  const handleDelete = (row: MedRow) => {
    if (!patientId) return;
    Alert.alert(
      "Delete medication",
      `Remove ${row.med.name}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteMedication(row.med.medicationId, true);
            audit({
              actor: "caregiver",
              action: "delete_medication",
              resourceType: "medication",
              resourceId: row.med.medicationId,
              patientId,
              payload: { name: row.med.name },
            });
            refresh();
            reload();
          },
        },
      ],
    );
  };

  const formatTimeLabel = (row: MedRow): string => {
    if (!row.schedule) return "Schedule not provided";
    return row.schedule.timeOfDay;
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.root}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <MainTabHeader
            title="Medication Management"
            eyebrow="Caregiver Concierge ACCESS-DP"
            icon="pill"
            rightContent={<Text style={styles.patientName}>{patientFirstName}</Text>}
          />

          {nextDue ? (
            <View style={styles.nextDueCard}>
              <View style={styles.clockCircle}>
                <Text style={styles.clockText}>⏰</Text>
              </View>

              <View style={styles.nextDueTextBlock}>
                <Text style={styles.nextDueLabel}>Next Due</Text>
                <Text style={styles.nextDueTitle}>
                  {nextDue.med.name} · {nextDue.med.dosage ?? "—"}
                </Text>
                <Text style={styles.nextDueTime}>{formatTimeLabel(nextDue)}</Text>
              </View>

              <StatusPill status={nextDue.status} compact />
            </View>
          ) : null}

          <Pressable
            style={styles.reminderPreferencesButton}
            onPress={() => router.push("/notifications-reminders")}
            accessibilityRole="button"
            accessibilityLabel="Open reminder preferences"
          >
            <AppIcon name="bell" size={18} color={AppTheme.colors.brand} />
            <Text style={styles.reminderPreferencesText}>Reminder preferences</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>Active medications</Text>

          {rows.length === 0 ? (
            <Text style={styles.emptyText}>No medications yet. Add one below.</Text>
          ) : (
            <>
              {confirmationRequiredRows.length > 0 ? (
                <>
                  <Text style={styles.sectionLabel}>Confirmation required</Text>
                  {confirmationRequiredRows.map((row) => (
                    <MedicationCard
                      key={row.med.medicationId}
                      row={row}
                      timeLabel={formatTimeLabel(row)}
                      onToggleConfirm={() => toggleConfirm(row.med.medicationId)}
                      onEdit={() => openEdit(row)}
                      onDelete={
                        row.med.source === "custom" ? () => handleDelete(row) : undefined
                      }
                      onSlmCheck={() => setSlmCheckMed(getMedicationById(row.med.medicationId))}
                    />
                  ))}
                </>
              ) : null}

              {otherActiveRows.length > 0 ? (
                <>
                  <Pressable
                    style={styles.historyToggle}
                    onPress={() => setShowOtherCurrentMedications((current) => !current)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showOtherCurrentMedications }}
                  >
                    <Text style={styles.historyToggleText}>Other current medications</Text>
                    <Text style={styles.historyToggleCount}>{otherActiveRows.length}</Text>
                  </Pressable>
                  {showOtherCurrentMedications ? (
                    <>
                      <Text style={styles.sectionLabel}>Other current medications</Text>
                      {otherActiveRows.map((row) => (
                        <MedicationCard
                          key={row.med.medicationId}
                          row={row}
                          timeLabel={formatTimeLabel(row)}
                          onToggleConfirm={() => toggleConfirm(row.med.medicationId)}
                          onEdit={() => openEdit(row)}
                          onDelete={
                            row.med.source === "custom" ? () => handleDelete(row) : undefined
                          }
                          onSlmCheck={() => setSlmCheckMed(getMedicationById(row.med.medicationId))}
                        />
                      ))}
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          )}

          <Pressable style={styles.addMedicationButton} onPress={openAdd}>
            <Text style={styles.addMedicationText}>➕ Add Medication</Text>
          </Pressable>
          {medicationCandidates.length > 0 ? (
            <>
              <Pressable
                style={styles.historyToggle}
                onPress={() => setShowMedicationHistory((current) => !current)}
                accessibilityRole="button"
                accessibilityState={{ expanded: showMedicationHistory }}
              >
                <Text style={styles.historyToggleText}>
                  {showMedicationHistory ? "Hide" : "View"} historical / review medications
                </Text>
                <Text style={styles.historyToggleCount}>{medicationCandidates.length}</Text>
              </Pressable>
              {showMedicationHistory ? (
                <>
                  <Text style={styles.sectionLabel}>Medication history / review candidates</Text>
                  <Text style={styles.candidateIntro}>
                    Saved for medication review. These are separate from current medications.
                  </Text>
                  {medicationCandidates.map((candidate) => (
                    <MedicationCandidateCard
                      key={candidate.candidateId}
                      candidate={candidate}
                    />
                  ))}
                </>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </View>

      {/* Edit / Add modal */}
      <Modal
        visible={editing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setEditing(null)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>
              {editing === "new" ? "Add Medication" : "Edit Medication"}
            </Text>

            <Text style={styles.modalLabel}>Name</Text>
            <TextInput
              style={styles.modalInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="e.g. Albuterol"
              placeholderTextColor={AppTheme.colors.textMuted}
            />

            <Text style={styles.modalLabel}>Dose</Text>
            <TextInput
              style={styles.modalInput}
              value={editDose}
              onChangeText={setEditDose}
              placeholder="e.g. 2 puffs"
              placeholderTextColor={AppTheme.colors.textMuted}
            />

            <Text style={styles.modalLabel}>Instructions / Frequency</Text>
            <TextInput
              style={styles.modalInput}
              value={editInstructions}
              onChangeText={setEditInstructions}
              placeholder="e.g. Once daily"
              placeholderTextColor={AppTheme.colors.textMuted}
            />

            <Text style={styles.modalLabel}>Administration time (HH:mm, 24h)</Text>
            <TextInput
              style={styles.modalInput}
              value={editTime}
              onChangeText={setEditTime}
              placeholder="e.g. 20:00"
              placeholderTextColor={AppTheme.colors.textMuted}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, styles.modalCancel]}
                onPress={() => setEditing(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalButton} onPress={saveEdit}>
                <Text style={styles.modalSaveText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Custom-med Concierge check */}
      <SlmInsightSheet
        visible={slmCheckMed !== null}
        onClose={() => setSlmCheckMed(null)}
        title="Concierge medication check"
        reason="custom_med_check"
        prompt={
          slmCheckMed
            ? `A caregiver is considering adding the medication "${slmCheckMed.name}" (${slmCheckMed.dosage ?? "dose not specified"}, ${slmCheckMed.frequency ?? "frequency not specified"}) for ${snapshot?.patient?.name ?? "the selected patient"}, who has these conditions: ${snapshot?.conditions.map((condition) => condition.name).filter(Boolean).join(", ") || "not specified"} and takes these current medications: ${snapshot?.medications.map((medication) => medication.name).filter(Boolean).join(", ") || "none listed"}. Is this a reasonable choice? In plain, calm language for a family caregiver, summarize the main considerations, potential interactions or red flags to watch for, and whether to keep, modify, or remove it — and always recommend confirming with the prescriber.`
            : ""
        }
      />
    </SafeAreaView>
  );
}

function MedicationCard({
  row,
  timeLabel,
  onToggleConfirm,
  onEdit,
  onDelete,
  onSlmCheck,
}: {
  row: MedRow;
  timeLabel: string;
  onToggleConfirm: () => void;
  onEdit: () => void;
  onDelete?: () => void;
  onSlmCheck: () => void;
}) {
  const isConfirmed = row.status === "confirmed";
  const isCustom = row.med.source === "custom";
  const showConfirmationUi = row.confirmationRequired;

  return (
    <View style={styles.medicationCard}>
      <View style={styles.medicationHeader}>
        <View style={[styles.medDot, { backgroundColor: row.accent }]} />

        <View style={styles.medicationTitleBlock}>
          <View style={styles.nameRow}>
            <Text style={styles.medicationName}>{row.med.name}</Text>
            {isCustom ? (
              <View style={styles.customBadge}>
                <Text style={styles.customBadgeText}>Custom</Text>
              </View>
            ) : null}
            {row.confirmationLabel ? (
              <View style={styles.confirmationBadge}>
                <Text style={styles.confirmationBadgeText}>{row.confirmationLabel}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.medicationDose}>
            {row.med.dosage ?? "—"} · {row.med.frequency ?? row.med.indication ?? "—"}
          </Text>
        </View>

        {showConfirmationUi ? <StatusPill status={row.status} /> : null}
      </View>

      <View style={[styles.timeBox, isConfirmed && styles.timeBoxConfirmed]}>
        <Text style={[styles.timeText, isConfirmed && styles.timeTextConfirmed]}>
          ⏰ {timeLabel}
        </Text>
      </View>

      <View style={styles.actionRow}>
        {showConfirmationUi ? (
          <Pressable
            style={[
              styles.primaryAction,
              isConfirmed && styles.primaryActionConfirmed,
            ]}
            onPress={onToggleConfirm}
          >
            <Text
              style={[
                styles.primaryActionText,
                isConfirmed && styles.primaryActionTextConfirmed,
              ]}
            >
              {isConfirmed ? "✅ Confirmed · tap to undo" : "✅ Confirm Given"}
            </Text>
          </Pressable>
        ) : null}

        <Pressable style={styles.iconButton} onPress={onEdit}>
          <AppIcon name="note" size={20} color={AppTheme.colors.textMuted} />
        </Pressable>

        {isCustom ? (
          <Pressable style={styles.iconButton} onPress={onSlmCheck}>
            <AppIcon name="care" size={20} color={AppTheme.colors.brand} />
          </Pressable>
        ) : null}

        {onDelete ? (
          <Pressable style={[styles.iconButton, styles.iconButtonDanger]} onPress={onDelete}>
            <Text style={styles.deleteIconText}>🗑</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function MedicationCandidateCard({
  candidate,
}: {
  candidate: MedicationCandidate;
}) {
  const sourceDetail = [
    candidate.sourceFile,
    typeof candidate.visitIndex === "number" ? `visit ${candidate.visitIndex}` : undefined,
    typeof candidate.daysFromFirstVisit === "number"
      ? `${candidate.daysFromFirstVisit} days from first visit`
      : undefined,
  ].filter(Boolean).join(" · ");

  void sourceDetail;

  return (
    <View style={[styles.medicationCard, styles.candidateCard]}>
      <View style={styles.medicationHeader}>
        <View style={[styles.medDot, { backgroundColor: AppTheme.colors.brandDark }]} />
        <View style={styles.medicationTitleBlock}>
          <View style={styles.nameRow}>
            <Text style={styles.medicationName}>{candidate.name}</Text>
            <View style={styles.reviewBadge}>
              <Text style={styles.reviewBadgeText}>Review only</Text>
            </View>
          </View>
          <Text style={styles.medicationDose}>
            {candidate.category} - historical/review context
          </Text>
        </View>
      </View>

      <Text style={styles.candidateIntro}>
        Saved for review. No reminders are set from this item.
      </Text>

      <View style={styles.reviewAction}>
        <Text style={styles.reviewActionText}>Historical / review context</Text>
      </View>
    </View>
  );
}

function StatusPill({
  status,
  compact,
}: {
  status: MedStatus;
  compact?: boolean;
}) {
  const label = status === "confirmed" ? "Confirmed" : "Pending";
  return (
    <View
      style={[
        styles.statusPill,
        status === "pending" && styles.statusPending,
        status === "confirmed" && styles.statusConfirmed,
        compact && styles.statusPillCompact,
      ]}
    >
      <Text
        style={[
          styles.statusText,
          status === "pending" && styles.statusTextPending,
          status === "confirmed" && styles.statusTextConfirmed,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
  },
  root: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 124,
  },
  patientName: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "900",
  },
  nextDueCard: {
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 22,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  clockCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  clockText: {
    color: AppTheme.colors.white,
    fontSize: 24,
    fontWeight: "900",
  },
  nextDueTextBlock: { flex: 1 },
  nextDueLabel: {
    color: AppTheme.colors.white,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    opacity: 0.9,
    marginBottom: 4,
  },
  nextDueTitle: {
    color: AppTheme.colors.white,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
  },
  nextDueTime: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 5,
  },
  reminderPreferencesButton: {
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 18,
  },
  reminderPreferencesText: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
  },
  sectionLabel: {
    color: AppTheme.colors.sectionText,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 10,
    marginLeft: 4,
  },
  emptyText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    paddingVertical: 24,
  },
  candidateIntro: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    marginBottom: 10,
  },
  medicationCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 22,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    ...AppTheme.shadow,
  },
  candidateCard: {
    borderColor: AppTheme.colors.brandSoft,
    backgroundColor: "#FBFFFE",
  },
  medicationHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  medDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginTop: 7,
    marginRight: 10,
  },
  medicationTitleBlock: { flex: 1, paddingRight: 10 },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  medicationName: {
    color: AppTheme.colors.text,
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
  },
  customBadge: {
    backgroundColor: AppTheme.colors.purple,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 4,
  },
  customBadgeText: {
    color: AppTheme.colors.white,
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  confirmationBadge: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 4,
  },
  confirmationBadgeText: {
    color: AppTheme.colors.brand,
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  reviewBadge: {
    backgroundColor: AppTheme.colors.warningSoft,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 4,
  },
  reviewBadgeText: {
    color: "#B77900",
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  medicationDose: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  candidateSource: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    marginTop: 2,
  },
  statusPill: {
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  statusPillCompact: { paddingHorizontal: 12, paddingVertical: 7 },
  statusPending: { backgroundColor: AppTheme.colors.warningSoft },
  statusConfirmed: { backgroundColor: AppTheme.colors.brandSoft },
  statusText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  statusTextPending: { color: "#B77900" },
  statusTextConfirmed: { color: AppTheme.colors.brand },
  timeBox: {
    minHeight: 38,
    borderRadius: 18,
    backgroundColor: AppTheme.colors.softSurface,
    justifyContent: "center",
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  timeBoxConfirmed: { backgroundColor: AppTheme.colors.softSurface },
  timeText: { color: AppTheme.colors.textSoft, fontSize: 13, fontWeight: "800" },
  timeTextConfirmed: { color: AppTheme.colors.textSoft },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  primaryAction: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: AppTheme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryActionConfirmed: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  primaryActionText: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  primaryActionTextConfirmed: { color: AppTheme.colors.brand },
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: AppTheme.colors.surface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonDanger: { borderColor: AppTheme.colors.dangerLight },
  deleteIconText: { fontSize: 18 },
  addMedicationButton: {
    minHeight: 58,
    borderRadius: 22,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: AppTheme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
    marginBottom: 12,
  },
  addMedicationText: {
    color: AppTheme.colors.textSoft,
    fontSize: 15,
    fontWeight: "800",
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
  reviewAction: {
    minHeight: 44,
    borderRadius: 16,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: AppTheme.colors.brandPale,
  },
  reviewActionText: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  modalSheet: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    padding: 22,
  },
  modalTitle: {
    color: AppTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 14,
  },
  modalLabel: {
    color: AppTheme.colors.sectionText,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 5,
    marginTop: 10,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: AppTheme.colors.text,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18,
  },
  modalButton: {
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  modalCancel: { backgroundColor: AppTheme.colors.softSurface },
  modalCancelText: { color: AppTheme.colors.textSoft, fontSize: 14, fontWeight: "900" },
  modalSaveText: { color: AppTheme.colors.white, fontSize: 14, fontWeight: "900" },
});
