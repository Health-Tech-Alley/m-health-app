import { useCallback, useEffect, useMemo, useState } from "react";
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
import { CitationList } from "@/components/common/CitationList";
import { usePatientRecord } from "@/contexts/patient-record-context";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/hooks/use-translation";
import type { AppLocale, TranslationKey, TranslateFn } from "@/localization/i18n";
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
import {
  getMedKnowledgeGlance,
  type MedKnowledgeGlance,
} from "@/services/medications/medKnowledgeGlance";

type MedStatus = "pending" | "confirmed";
type KnowledgeSectionKey = "indication" | "sideEffects" | "warnings" | "other";

interface MedRow {
  med: Medication;
  schedule?: MedicationSchedule;
  status: MedStatus;
  accent: string;
  confirmationRequired: boolean;
  confirmationLabelKey?: TranslationKey;
}

const CARE_PLAN_ACCENT = "#F5B800";
const CUSTOM_ACCENT = "#7C3AED";
const UNSAVED_PREFERENCE_TIMESTAMP = new Date(0).toISOString();
const UNNAMED_MEDICATION = "Unnamed medication";

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

function displayMedicationName(name: string, t: TranslateFn): string {
  return name === UNNAMED_MEDICATION ? t("medications.value.unnamedMedication") : name;
}

function medicationNameForEdit(name: string): string {
  return name === UNNAMED_MEDICATION ? "" : name;
}

function formatTimeOfDayLabel(timeOfDay: string, locale: AppLocale): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeOfDay.trim());
  if (!match) return timeOfDay;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return timeOfDay;
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function localizeMedSourceLabel(label: string, t: TranslateFn): string {
  return label === "Drug label" ? t("medications.source.drugLabel") : label;
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
      confirmationLabelKey: confirmationRequired
        ? required
          ? "medications.confirmation.requiredByCareTeam"
          : hasSavedPreference && schedule
            ? "medications.confirmation.selected"
            : hasSavedPreference
              ? "medications.confirmation.preferenceSaved"
              : "medications.confirmation.selected"
        : undefined,
    };
  });
}

export default function MedicationsScreen() {
  const theme = useTheme();
  const { locale, t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const brandIconColor =
    theme.appBackground === "#000000" ? AppTheme.colors.brandPale : AppTheme.colors.brand;
  const router = useRouter();
  const { patientId, snapshot, refresh } = usePatientRecord();

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
    setEditName(medicationNameForEdit(row.med.name));
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
        name: editName.trim() || UNNAMED_MEDICATION,
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
    void import("@/clinical-evidence/knowledge-bundle-runner").then(
      ({ scheduleMedicationKnowledgeSync }) =>
        scheduleMedicationKnowledgeSync(patientId),
    );
  };

  const handleDelete = (row: MedRow) => {
    if (!patientId) return;
    Alert.alert(
      t("medications.deleteDialog.title"),
      t("medications.deleteDialog.body", {
        name: displayMedicationName(row.med.name, t),
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
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
            void import("@/clinical-evidence/knowledge-bundle-runner").then(
              ({ scheduleMedicationKnowledgeSync }) =>
                scheduleMedicationKnowledgeSync(patientId),
            );
          },
        },
      ],
    );
  };

  const formatTimeLabel = (row: MedRow): string => {
    if (!row.schedule) return t("medications.scheduleNotProvided");
    return formatTimeOfDayLabel(row.schedule.timeOfDay, locale);
  };

  return (
    <SafeAreaView style={[styles.safeArea, themedStyles.screen]} edges={["top"]}>
      <View style={[styles.root, themedStyles.screen]}>
        <ScrollView
          style={themedStyles.screen}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, themedStyles.screen]}
        >
          <MainTabHeader
            title={t("medications.header.title")}
            eyebrow={t("medications.header.eyebrow")}
            icon="pill"
          />

          {nextDue ? (
            <View style={[styles.nextDueCard, themedStyles.nextDueCard]}>
              <View style={[styles.clockCircle, themedStyles.clockCircle]}>
                <Text style={styles.clockText}>⏰</Text>
              </View>

              <View style={styles.nextDueTextBlock}>
                <Text style={styles.nextDueLabel}>{t("medications.nextDue")}</Text>
                <Text style={styles.nextDueTitle}>
                  {displayMedicationName(nextDue.med.name, t)} · {nextDue.med.dosage ?? "—"}
                </Text>
                <Text style={styles.nextDueTime}>{formatTimeLabel(nextDue)}</Text>
              </View>

              <StatusPill status={nextDue.status} compact />
            </View>
          ) : null}

          <Pressable
            style={[styles.reminderPreferencesButton, themedStyles.card]}
            onPress={() => router.push("/notifications-reminders")}
            accessibilityRole="button"
            accessibilityLabel={t("medications.reminderPreferencesA11y")}
          >
            <AppIcon name="bell" size={18} color={brandIconColor} />
            <Text style={[styles.reminderPreferencesText, themedStyles.accentText]}>
              {t("medications.reminderPreferences")}
            </Text>
          </Pressable>

          <Text style={[styles.sectionLabel, themedStyles.sectionText]}>
            {t("medications.section.active")}
          </Text>

          {rows.length === 0 ? (
            <Text style={[styles.emptyText, themedStyles.secondaryText]}>
              {t("medications.empty")}
            </Text>
          ) : (
            <>
              {confirmationRequiredRows.length > 0 ? (
                <>
                  <Text style={[styles.sectionLabel, themedStyles.sectionText]}>
                    {t("medications.section.confirmationRequired")}
                  </Text>
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
                    style={[styles.historyToggle, themedStyles.controlSurface]}
                    onPress={() => setShowOtherCurrentMedications((current) => !current)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showOtherCurrentMedications }}
                    accessibilityLabel={t("medications.section.otherCurrent")}
                  >
                    <Text style={[styles.historyToggleText, themedStyles.secondaryText]}>
                      {t("medications.section.otherCurrent")}
                    </Text>
                    <Text style={[styles.historyToggleCount, themedStyles.mutedText]}>
                      {otherActiveRows.length}
                    </Text>
                  </Pressable>
                  {showOtherCurrentMedications ? (
                    <>
                      <Text style={[styles.sectionLabel, themedStyles.sectionText]}>
                        {t("medications.section.otherCurrent")}
                      </Text>
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

          <Pressable
            style={[styles.addMedicationButton, themedStyles.addMedicationButton]}
            onPress={openAdd}
            accessibilityRole="button"
            accessibilityLabel={t("medications.action.addA11y")}
          >
            <Text style={[styles.addMedicationText, themedStyles.secondaryText]}>
              ➕ {t("medications.action.add")}
            </Text>
          </Pressable>
          {medicationCandidates.length > 0 ? (
            <>
              <Pressable
                style={[styles.historyToggle, themedStyles.controlSurface]}
                onPress={() => setShowMedicationHistory((current) => !current)}
                accessibilityRole="button"
                accessibilityState={{ expanded: showMedicationHistory }}
                accessibilityLabel={
                  showMedicationHistory
                    ? t("medications.history.hide")
                    : t("medications.history.view")
                }
              >
                <Text style={[styles.historyToggleText, themedStyles.secondaryText]}>
                  {showMedicationHistory
                    ? t("medications.history.hide")
                    : t("medications.history.view")}
                </Text>
                <Text style={[styles.historyToggleCount, themedStyles.mutedText]}>
                  {medicationCandidates.length}
                </Text>
              </Pressable>
              {showMedicationHistory ? (
                <>
                  <Text style={[styles.sectionLabel, themedStyles.sectionText]}>
                    {t("medications.history.title")}
                  </Text>
                  <Text style={[styles.candidateIntro, themedStyles.secondaryText]}>
                    {t("medications.history.intro")}
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
          <Pressable style={[styles.modalSheet, themedStyles.card]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, themedStyles.primaryText]}>
              {editing === "new"
                ? t("medications.modal.addTitle")
                : t("medications.modal.editTitle")}
            </Text>

            <Text style={[styles.modalLabel, themedStyles.sectionText]}>
              {t("medications.modal.name")}
            </Text>
            <TextInput
              style={[styles.modalInput, themedStyles.modalInput]}
              value={editName}
              onChangeText={setEditName}
              placeholder={t("medications.modal.namePlaceholder")}
              placeholderTextColor={theme.appTextMuted}
              accessibilityLabel={t("medications.modal.name")}
            />

            <Text style={[styles.modalLabel, themedStyles.sectionText]}>
              {t("medications.modal.dose")}
            </Text>
            <TextInput
              style={[styles.modalInput, themedStyles.modalInput]}
              value={editDose}
              onChangeText={setEditDose}
              placeholder={t("medications.modal.dosePlaceholder")}
              placeholderTextColor={theme.appTextMuted}
              accessibilityLabel={t("medications.modal.dose")}
            />

            <Text style={[styles.modalLabel, themedStyles.sectionText]}>
              {t("medications.modal.instructions")}
            </Text>
            <TextInput
              style={[styles.modalInput, themedStyles.modalInput]}
              value={editInstructions}
              onChangeText={setEditInstructions}
              placeholder={t("medications.modal.instructionsPlaceholder")}
              placeholderTextColor={theme.appTextMuted}
              accessibilityLabel={t("medications.modal.instructions")}
            />

            <Text style={[styles.modalLabel, themedStyles.sectionText]}>
              {t("medications.modal.time")}
            </Text>
            <TextInput
              style={[styles.modalInput, themedStyles.modalInput]}
              value={editTime}
              onChangeText={setEditTime}
              placeholder={t("medications.modal.timePlaceholder")}
              placeholderTextColor={theme.appTextMuted}
              accessibilityLabel={t("medications.modal.time")}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, styles.modalCancel, themedStyles.modalCancel]}
                onPress={() => setEditing(null)}
                accessibilityRole="button"
                accessibilityLabel={t("common.cancel")}
              >
                <Text style={[styles.modalCancelText, themedStyles.secondaryText]}>
                  {t("common.cancel")}
                </Text>
              </Pressable>
              <Pressable
                style={styles.modalButton}
                onPress={saveEdit}
                accessibilityRole="button"
                accessibilityLabel={t("common.save")}
              >
                <Text style={styles.modalSaveText}>{t("common.save")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Custom-med Concierge check */}
      <SlmInsightSheet
        visible={slmCheckMed !== null}
        onClose={() => setSlmCheckMed(null)}
        title={t("medications.slm.title")}
        reason="custom_med_check"
        allowMinimize={false}
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
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const brandIconColor =
    theme.appBackground === "#000000" ? AppTheme.colors.brandPale : AppTheme.colors.brand;
  const isConfirmed = row.status === "confirmed";
  const isCustom = row.med.source === "custom";
  const showConfirmationUi = row.confirmationRequired;
  const medName = displayMedicationName(row.med.name, t);
  const [openSection, setOpenSection] = useState<
    null | KnowledgeSectionKey
  >(null);
  const { patientId: activePatientId } = usePatientRecord();
  const glance = useMemo(
    () => getMedKnowledgeGlance(row.med.name, activePatientId),
    [row.med.name, activePatientId],
  );

  const toggleSection = (key: NonNullable<typeof openSection>) => {
    setOpenSection((current) => (current === key ? null : key));
  };

  return (
    <View style={[styles.medicationCard, themedStyles.card]}>
      <View style={styles.medicationHeader}>
        <View style={[styles.medDot, { backgroundColor: row.accent }]} />

        <View style={styles.medicationTitleBlock}>
          <View style={styles.nameRow}>
            <Text style={[styles.medicationName, themedStyles.primaryText]}>{medName}</Text>
            {isCustom ? (
              <View style={styles.customBadge}>
                <Text style={styles.customBadgeText}>
                  {t("medications.badge.custom")}
                </Text>
              </View>
            ) : null}
            {row.confirmationLabelKey ? (
              <View style={[styles.confirmationBadge, themedStyles.brandSoftSurface]}>
                <Text style={[styles.confirmationBadgeText, themedStyles.accentText]}>
                  {t(row.confirmationLabelKey)}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.medicationDose, themedStyles.secondaryText]}>
            {row.med.dosage ?? "—"} · {row.med.frequency ?? row.med.indication ?? "—"}
          </Text>
        </View>

        {showConfirmationUi ? <StatusPill status={row.status} /> : null}
      </View>

      <View style={[styles.timeBox, isConfirmed && styles.timeBoxConfirmed, themedStyles.controlSurface]}>
        <Text style={[styles.timeText, themedStyles.secondaryText, isConfirmed && styles.timeTextConfirmed]}>
          ⏰ {timeLabel}
        </Text>
      </View>

      <MedKnowledgeCollapsibles
        glance={glance}
        medIndication={row.med.indication}
        openSection={openSection}
        onToggle={toggleSection}
      />

      <View style={styles.actionRow}>
        {showConfirmationUi ? (
          <Pressable
            style={[
              styles.primaryAction,
              isConfirmed && styles.primaryActionConfirmed,
              isConfirmed && themedStyles.primaryActionConfirmed,
            ]}
            onPress={onToggleConfirm}
            accessibilityRole="button"
            accessibilityLabel={
              isConfirmed
                ? t("medications.action.confirmedUndoA11y", { name: medName })
                : t("medications.action.confirmGivenA11y", { name: medName })
            }
          >
            <Text
              style={[
                styles.primaryActionText,
                isConfirmed && styles.primaryActionTextConfirmed,
                isConfirmed && themedStyles.primaryActionTextConfirmed,
              ]}
            >
              ✅{" "}
              {isConfirmed
                ? t("medications.action.confirmedUndo")
                : t("medications.action.confirmGiven")}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          style={[styles.iconButton, themedStyles.iconButton]}
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={t("medications.action.editA11y", { name: medName })}
        >
          <AppIcon name="note" size={20} color={theme.appTextMuted} />
        </Pressable>

        {isCustom ? (
          <Pressable
            style={[styles.iconButton, themedStyles.iconButton]}
            onPress={onSlmCheck}
            accessibilityRole="button"
            accessibilityLabel={t("medications.action.conciergeCheckA11y", {
              name: medName,
            })}
          >
            <AppIcon name="care" size={20} color={brandIconColor} />
          </Pressable>
        ) : null}

        {onDelete ? (
          <Pressable
            style={[styles.iconButton, themedStyles.iconButton, styles.iconButtonDanger]}
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel={t("medications.action.deleteA11y", { name: medName })}
          >
            <Text style={styles.deleteIconText}>🗑</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function MedKnowledgeCollapsibles({
  glance,
  medIndication,
  openSection,
  onToggle,
}: {
  glance: MedKnowledgeGlance | null;
  medIndication?: string;
  openSection: null | KnowledgeSectionKey;
  onToggle: (key: KnowledgeSectionKey) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const indicationText = glance?.indication ?? medIndication?.trim() ?? null;
  const sideEffects = glance?.sideEffects ?? null;
  const warnings = glance?.warnings ?? null;
  const other = glance?.other ?? null;
  const hasAny = Boolean(indicationText || sideEffects || warnings || other);
  if (!hasAny) return null;

  const rows: Array<{
    key: KnowledgeSectionKey;
    labelKey: TranslationKey;
    body: string;
  }> = [];
  if (indicationText) {
    rows.push({
      key: "indication",
      labelKey: "medications.knowledge.indication",
      body: indicationText,
    });
  }
  if (sideEffects) {
    rows.push({
      key: "sideEffects",
      labelKey: "medications.knowledge.sideEffects",
      body: sideEffects,
    });
  }
  if (warnings) {
    rows.push({
      key: "warnings",
      labelKey: "medications.knowledge.warnings",
      body: warnings,
    });
  }
  if (other && !indicationText && !sideEffects && !warnings) {
    rows.push({
      key: "other",
      labelKey: "medications.knowledge.other",
      body: other,
    });
  }

  return (
    <View style={[styles.knowledgeBlock, themedStyles.knowledgeBlock]}>
      {rows.map((row) => {
        const open = openSection === row.key;
        const label = t(row.labelKey);
        return (
          <View key={row.key} style={[styles.knowledgeRow, themedStyles.knowledgeRow]}>
            <Pressable
              style={styles.knowledgeHeader}
              onPress={() => onToggle(row.key)}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={
                open
                  ? t("medications.knowledge.collapseA11y", { label })
                  : t("medications.knowledge.expandA11y", { label })
              }
            >
              <Text style={[styles.knowledgeLabel, themedStyles.primaryText]}>{label}</Text>
              <Text style={[styles.knowledgeChevron, themedStyles.mutedText]}>{open ? '▾' : '▸'}</Text>
            </Pressable>
            {open ? (
              <Text style={[styles.knowledgeBody, themedStyles.secondaryText]}>{row.body}</Text>
            ) : null}
          </View>
        );
      })}
      {glance?.sourceLabels?.length ? (
        <CitationList
          sources={glance.sourceLabels.map((label) => ({
            label: localizeMedSourceLabel(label, t),
          }))}
          collapsible
          defaultExpanded={false}
          compact
          maxItems={6}
        />
      ) : null}
    </View>
  );
}

function MedicationCandidateCard({
  candidate,
}: {
  candidate: MedicationCandidate;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const isDark = theme.appBackground === "#000000";

  return (
    <View style={[styles.medicationCard, themedStyles.card, styles.candidateCard, themedStyles.candidateCard]}>
      <View style={styles.medicationHeader}>
        <View style={[styles.medDot, { backgroundColor: isDark ? AppTheme.colors.brandPale : AppTheme.colors.brandDark }]} />
        <View style={styles.medicationTitleBlock}>
          <View style={styles.nameRow}>
            <Text style={[styles.medicationName, themedStyles.primaryText]}>{candidate.name}</Text>
            <View style={[styles.reviewBadge, themedStyles.warningSurface]}>
              <Text style={[styles.reviewBadgeText, themedStyles.warningText]}>
                {t("medications.candidate.reviewOnly")}
              </Text>
            </View>
          </View>
          <Text style={[styles.medicationDose, themedStyles.secondaryText]}>
            {t("medications.candidate.categoryContext", {
              category: candidate.category,
            })}
          </Text>
        </View>
      </View>

      <Text style={[styles.candidateIntro, themedStyles.secondaryText]}>
        {t("medications.candidate.saved")}
      </Text>

      <View style={[styles.reviewAction, themedStyles.reviewAction]}>
        <Text style={[styles.reviewActionText, themedStyles.accentText]}>
          {t("medications.candidate.context")}
        </Text>
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
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const label =
    status === "confirmed"
      ? t("medications.status.confirmed")
      : t("medications.status.pending");
  return (
    <View
      style={[
        styles.statusPill,
        status === "pending" && styles.statusPending,
        status === "pending" && themedStyles.warningSurface,
        status === "confirmed" && styles.statusConfirmed,
        status === "confirmed" && themedStyles.brandSoftSurface,
        compact && styles.statusPillCompact,
      ]}
    >
      <Text
        style={[
          styles.statusText,
          status === "pending" && styles.statusTextPending,
          status === "pending" && themedStyles.warningText,
          status === "confirmed" && styles.statusTextConfirmed,
          status === "confirmed" && themedStyles.accentText,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === "#000000";

  return StyleSheet.create({
    screen: {
      backgroundColor: theme.appBackground,
    },
    card: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    candidateCard: {
      backgroundColor: isDark ? theme.appSurface : "#FBFFFE",
      borderColor: isDark ? theme.appBorder : AppTheme.colors.brandSoft,
    },
    controlSurface: {
      backgroundColor: theme.appControlSurface,
      borderColor: theme.appBorder,
    },
    nextDueCard: {
      ...(isDark
        ? {
            backgroundColor: theme.appSurface,
            borderColor: theme.appBorder,
            borderWidth: 1,
          }
        : null),
    },
    clockCircle: {
      backgroundColor: isDark ? theme.appControlSurface : "rgba(255,255,255,0.2)",
    },
    primaryText: {
      color: theme.appText,
    },
    secondaryText: {
      color: theme.appTextSupporting,
    },
    mutedText: {
      color: theme.appTextMuted,
    },
    sectionText: {
      color: theme.appSectionText,
    },
    accentText: {
      color: isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand,
    },
    brandSoftSurface: {
      backgroundColor: theme.appBrandSoftSurface,
    },
    warningSurface: {
      backgroundColor: isDark ? "rgba(249, 115, 22, 0.16)" : AppTheme.colors.warningSoft,
    },
    warningText: {
      color: isDark ? AppTheme.colors.warning : "#B77900",
    },
    addMedicationButton: {
      borderColor: theme.appBorder,
    },
    knowledgeBlock: {
      backgroundColor: theme.appControlSurface,
      borderColor: theme.appBorder,
    },
    knowledgeRow: {
      borderBottomColor: theme.appBorder,
    },
    primaryActionConfirmed: {
      backgroundColor: isDark ? theme.appControlSurface : AppTheme.colors.brandSoft,
      borderColor: isDark ? AppTheme.colors.brandPale : "#A7F3D0",
    },
    primaryActionTextConfirmed: {
      color: isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand,
    },
    iconButton: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    reviewAction: {
      backgroundColor: theme.appBrandSoftSurface,
      borderColor: isDark ? AppTheme.colors.brandPale : AppTheme.colors.brandPale,
    },
    modalInput: {
      backgroundColor: theme.appInputBackground,
      borderColor: theme.appBorder,
      color: theme.appText,
    },
    modalCancel: {
      backgroundColor: theme.appControlSurface,
    },
  });
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
    paddingTop: 22,
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
  knowledgeBlock: {
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
    overflow: "hidden",
  },
  knowledgeRow: {
    borderBottomWidth: 1,
    borderBottomColor: AppTheme.colors.border,
  },
  knowledgeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 40,
  },
  knowledgeLabel: {
    color: AppTheme.colors.text,
    fontSize: 12,
    fontWeight: "900",
    flex: 1,
  },
  knowledgeChevron: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "900",
  },
  knowledgeBody: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  knowledgeSources: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 12,
    paddingVertical: 8,
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
