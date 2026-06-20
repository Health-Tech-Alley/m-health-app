import { useCallback, useState } from "react";
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

import { AppIcon } from "@/components/AppIcon";
import { SlmInsightSheet } from "@/components/slm-insight-sheet";
import { AppTheme } from "@/constants/theme";
import { usePatientRecord } from "@/contexts/patient-record-context";
import {
  deleteMedication,
  getActiveMedications,
  getActiveMedicationSchedules,
  getMedicationById,
  upsertMedication,
  upsertMedicationSchedule,
  type Medication,
  type MedicationSchedule,
} from "@/data";
import { audit } from "@/services/audit/auditService";
import { getOnboardingProfile } from "@/services/onboarding/onboardingService";

type MedStatus = "pending" | "confirmed";

interface MedRow {
  med: Medication;
  schedule?: MedicationSchedule;
  status: MedStatus;
  accent: string;
}

const CARE_PLAN_ACCENT = "#F5B800";
const CUSTOM_ACCENT = "#7C3AED";

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

/** Build the joined med+schedule rows from the DB. */
function loadMedRows(patientId: string): MedRow[] {
  const meds = getActiveMedications(patientId);
  const schedules = getActiveMedicationSchedules(patientId);
  return meds.map((med) => {
    const schedule = schedules.find((s) => s.medicationId === med.medicationId);
    return {
      med,
      schedule,
      status: "pending" as MedStatus,
      accent: med.source === "custom" ? CUSTOM_ACCENT : CARE_PLAN_ACCENT,
    };
  });
}

export default function MedicationsScreen() {
  const profile = getOnboardingProfile();
  const { patientId } = usePatientRecord();

  const patientFirstName =
    profile.patient.name.trim().split(/\s+/)[0] || "Patient";

  const [rows, setRows] = useState<MedRow[]>(() =>
    patientId ? loadMedRows(patientId) : [],
  );

  // Edit / add / SLM-check modal state
  const [editing, setEditing] = useState<MedRow | "new" | null>(null);
  const [editName, setEditName] = useState("");
  const [editDose, setEditDose] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [editTime, setEditTime] = useState("");
  const [slmCheckMed, setSlmCheckMed] = useState<Medication | null>(null);

  const reload = useCallback(() => {
    if (patientId) setRows(loadMedRows(patientId));
  }, [patientId]);

  const nextDue = rows.find((r) => r.status === "pending") ?? rows[0];

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
            reload();
          },
        },
      ],
    );
  };

  const formatTimeLabel = (row: MedRow): string => {
    if (!row.schedule) return "No schedule";
    return row.schedule.timeOfDay;
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.root}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={styles.headerRow}>
            <View style={styles.headerIconCircle}>
              <AppIcon name="pill" size={25} color={AppTheme.colors.white} />
            </View>

            <View style={styles.headerTextBlock}>
              <Text style={styles.kicker}>Caregiver Concierge ACCESS-DP</Text>
              <Text style={styles.title}>Medication Management</Text>
            </View>

            <Text style={styles.patientName}>{patientFirstName}</Text>
          </View>

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

          <Text style={styles.sectionLabel}>Current Medications</Text>

          {rows.length === 0 ? (
            <Text style={styles.emptyText}>No medications yet. Add one below.</Text>
          ) : (
            rows.map((row) => (
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
            ))
          )}

          <Pressable style={styles.addMedicationButton} onPress={openAdd}>
            <Text style={styles.addMedicationText}>➕ Add Medication</Text>
          </Pressable>
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

      {/* Custom-med SLM check */}
      <SlmInsightSheet
        visible={slmCheckMed !== null}
        onClose={() => setSlmCheckMed(null)}
        title="Concierge medication check"
        reason="custom_med_check"
        prompt={
          slmCheckMed
            ? `A caregiver is considering adding the medication "${slmCheckMed.name}" (${slmCheckMed.dosage ?? "dose not specified"}, ${slmCheckMed.frequency ?? "frequency not specified"}) for ${profile.patient.name}, who has these conditions: ${profile.patient.conditions ?? "not specified"} and takes these current medications: ${profile.patient.currentMedications ?? "none listed"}. Is this a reasonable choice? In plain, calm language for a family caregiver, summarize the main considerations, potential interactions or red flags to watch for, and whether to keep, modify, or remove it — and always recommend confirming with the prescriber.`
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
          </View>
          <Text style={styles.medicationDose}>
            {row.med.dosage ?? "—"} · {row.med.frequency ?? row.med.indication ?? "—"}
          </Text>
        </View>

        <StatusPill status={row.status} />
      </View>

      <View style={[styles.timeBox, isConfirmed && styles.timeBoxConfirmed]}>
        <Text style={[styles.timeText, isConfirmed && styles.timeTextConfirmed]}>
          ⏰ {timeLabel}
        </Text>
      </View>

      <View style={styles.actionRow}>
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
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 124,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 28,
  },
  headerIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: AppTheme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  headerTextBlock: { flex: 1 },
  kicker: {
    color: AppTheme.colors.brand,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "900",
  },
  patientName: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 8,
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
  medicationCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 22,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    ...AppTheme.shadow,
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
  medicationDose: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
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
