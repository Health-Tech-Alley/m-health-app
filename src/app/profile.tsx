import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import { usePatientRecord } from "@/contexts/patient-record-context";
import { upsertCaregiver } from "@/data";
import type { Medication } from "@/data/types";
import { useActivePatientView } from "@/hooks/useActivePatientView";
import {
  displayClinical,
  displayEntered,
  getCaregiverDisplay,
  getCaregiverRoleDisplay,
  getComorbiditiesDisplay,
  getPatientAgeDisplay,
  getPatientDisplayName,
  getPrimaryDiagnosisDisplay,
} from "@/utils/patientDisplay";
import {
  applyActiveCaregiverToOnboardingProfile,
  getOnboardingProfile,
  saveOnboardingProfile,
} from "@/services/onboarding/onboardingService";

type DetailValue = string | number | boolean | null | undefined;

type EditableField = "name" | "relationship" | "phone" | "mainConcern";

function phoneFromCaregiverAvailability(availability?: string | null): string | undefined {
  return availability?.match(/^Phone:\s*(.+)$/i)?.[1]?.trim();
}

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState(() => getOnboardingProfile());
  const { snapshot, refresh } = usePatientRecord();
  const activePatient = useActivePatientView();

  // Prefer SQLite caregiver for the *active* patient over the global onboarding
  // singleton (which stays Luis after Elena seed until a profile switch syncs it).
  useEffect(() => {
    const cg = snapshot?.caregiver;
    if (!cg?.name) return;
    applyActiveCaregiverToOnboardingProfile(cg);
    setProfile(getOnboardingProfile());
  }, [
    snapshot?.patient?.patientId,
    snapshot?.caregiver?.caregiverId,
    snapshot?.caregiver?.name,
    snapshot?.caregiver?.relationship,
    snapshot?.caregiver?.mainConcern,
    snapshot?.lastRefreshedAt,
  ]);

  const caregiver = useMemo(() => {
    const base = profile.caregiver;
    const cg = snapshot?.caregiver;
    if (!cg) return base;
    const phone = phoneFromCaregiverAvailability(cg.availability) ?? base.phone;
    return {
      ...base,
      name: cg.name || base.name,
      relationship: cg.relationship ?? base.relationship,
      phone,
      experience: cg.experience ?? base.experience,
      availability: phoneFromCaregiverAvailability(cg.availability)
        ? base.availability
        : (cg.availability ?? base.availability),
      languagePreference: cg.languagePreference ?? base.languagePreference,
      mainConcern: cg.mainConcern ?? base.mainConcern,
    };
  }, [profile.caregiver, snapshot?.caregiver]);

  const provider = profile.primaryCareProvider;
  const safety = profile.safety;
  const caregiverName =
    (activePatient?.caregiver?.name?.trim() || caregiver.name) || "Not provided";
  const caregiverRole =
    (activePatient?.caregiver?.relationship?.trim() || caregiver.relationship) ||
    "Not provided";
  const patientName = getPatientDisplayName(activePatient);
  const patientAge = getPatientAgeDisplay(activePatient);
  const medicationSummary = formatMedicationSummary(snapshot?.medications ?? []);

  const [editing, setEditing] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState("");

  const openEdit = (field: EditableField) => {
    setEditing(field);
    setDraft(String(caregiver[field] ?? ""));
  };

  const saveEdit = () => {
    if (!editing) {
      setEditing(null);
      return;
    }
    const trimmed = draft.trim();
    const nextCaregiver = {
      ...profile.caregiver,
      name: editing === "name" ? trimmed : caregiver.name,
      relationship:
        editing === "relationship" ? trimmed : caregiver.relationship,
      phone: editing === "phone" ? trimmed : caregiver.phone,
      mainConcern:
        editing === "mainConcern" ? trimmed : caregiver.mainConcern,
    };
    const updatedProfile = {
      ...profile,
      caregiver: nextCaregiver,
    };
    saveOnboardingProfile(updatedProfile);
    setProfile(updatedProfile);

    // Persist to SQLite for the active patient when we have a caregiver row.
    if (snapshot?.caregiver) {
      const nextSqlite = { ...snapshot.caregiver };
      if (editing === "name") nextSqlite.name = trimmed;
      else if (editing === "relationship") nextSqlite.relationship = trimmed;
      else if (editing === "mainConcern") nextSqlite.mainConcern = trimmed;
      else if (editing === "phone") {
        nextSqlite.availability = trimmed
          ? `Phone: ${trimmed}`
          : snapshot.caregiver.availability;
      }
      upsertCaregiver(nextSqlite);
      refresh();
    }
    setEditing(null);
    setDraft("");
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.root}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
          <Text style={styles.topTitle}>Profile</Text>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={styles.profileHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(caregiverName)}</Text>
            </View>

            <View style={styles.headerTextBlock}>
              <Text style={styles.caregiverName}>
                {formatDetailValue(caregiverName)}
              </Text>

              <Text style={styles.roleText}>
                Caregiver · {formatDetailValue(caregiverRole)}
              </Text>

              <Text style={styles.patientLink}>
                Caring for {formatDetailValue(patientName)},{" "}
                {formatDetailValue(patientAge)}
              </Text>
            </View>
          </View>

          <ProfileCard title="Caregiver · tap to edit" icon="profile">
            <EditableDetailRow label="Name" value={caregiver.name} onPress={() => openEdit("name")} />
            <EditableDetailRow label="Relationship" value={caregiver.relationship} onPress={() => openEdit("relationship")} />
            <EditableDetailRow label="Phone" value={caregiver.phone} onPress={() => openEdit("phone")} />
            <DetailRow label="Experience" value={caregiver.experience} />
            <DetailRow label="Availability" value={caregiver.availability} />
            <EditableDetailRow label="Main concern" value={caregiver.mainConcern} onPress={() => openEdit("mainConcern")} />
            <DetailRow label="Language" value={caregiver.languagePreference} />
          </ProfileCard>

          <ProfileCard title="Patient" icon="care">
            <DetailRow label="Name" value={patientName} />
            <DetailRow label="Age" value={patientAge} />
            <DetailRow label="Primary diagnosis" value={getPrimaryDiagnosisDisplay(activePatient)} />
            <DetailRow label="Comorbidities" value={getComorbiditiesDisplay(activePatient)} />
            <DetailRow label="SpO₂ cutoff" value={displayClinical(activePatient?.spo2Cutoff)} />
            <DetailRow label="Baseline HR" value={displayEntered(activePatient?.baselineHeartRate)} />
            <DetailRow label="GMFCS" value={displayEntered(activePatient?.classifications.gmfcs)} />
            <DetailRow label="FMS" value={displayEntered(activePatient?.classifications.fms)} />
            <DetailRow label="MACS" value={displayEntered(activePatient?.classifications.macs)} />
            <DetailRow label="CFCS" value={displayEntered(activePatient?.classifications.cfcs)} />
            <DetailRow label="EDACS" value={displayEntered(activePatient?.classifications.edacs)} />
            <DetailRow
              label="Routine"
              value={formatImportedRoutine(activePatient?.baselineDailyRoutine)}
              multiline
            />
            <DetailRow
              label="Medications"
              value={displayClinical(medicationSummary)}
              multiline
            />
          </ProfileCard>

          <ProfileCard title="Primary Care Provider" icon="provider">
            <DetailRow label="Name" value={provider.name} />
            <DetailRow label="Phone" value={provider.phone} />
            <DetailRow label="Email" value={provider.email} />
          </ProfileCard>

          <ProfileCard title="Safety" icon="alert">
            <DetailRow label="Emergency contact" value={safety?.emergencyContact} />
            <DetailRow label="Safety notes" value={safety?.safetyNotes} multiline />
            <DetailRow
              label="911 disclaimer"
              value={
                safety?.emergencyDisclaimerAccepted
                  ? "Accepted"
                  : "Needs review"
              }
            />
          </ProfileCard>
        </ScrollView>

        {/* Caregiver field edit modal */}
        <Modal
          visible={editing !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setEditing(null)}
        >
          <Pressable style={styles.editOverlay} onPress={() => setEditing(null)}>
            <Pressable style={styles.editSheet} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.editTitle}>
                Edit {editing?.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
              </Text>
              <TextInput
                style={styles.editInput}
                value={draft}
                onChangeText={setDraft}
                autoFocus
                placeholder="Enter value…"
                placeholderTextColor={AppTheme.colors.textMuted}
              />
              <View style={styles.editActions}>
                <Pressable
                  style={[styles.editButton, styles.editCancel]}
                  onPress={() => setEditing(null)}
                >
                  <Text style={styles.editCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.editButton} onPress={saveEdit}>
                  <Text style={styles.editSaveText}>Save</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

function ProfileCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: AppIconName;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIconCircle}>
          <AppIcon name={icon} size={18} color={AppTheme.colors.brand} />
        </View>

        <Text style={styles.cardTitle}>{title}</Text>
      </View>

      {children}
    </View>
  );
}

function DetailRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: DetailValue;
  multiline?: boolean;
}) {
  return (
    <View style={[styles.detailRow, multiline && styles.detailRowMultiline]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[styles.detailValue, multiline && styles.detailValueMultiline]}
      >
        {formatDetailValue(value)}
      </Text>
    </View>
  );
}

function EditableDetailRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: DetailValue;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.detailRow} onPress={onPress}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{formatDetailValue(value)}</Text>
      <Text style={styles.editChevron}>›</Text>
    </Pressable>
  );
}

function getInitials(name: DetailValue): string {
  const safeName = formatDetailValue(name);

  if (safeName === "Not provided") {
    return "CG";
  }

  return safeName
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatMedicationSummary(medications: Medication[]): string {
  return medications
    .map((medication) => {
      const details = [medication.dosage, medication.frequency ?? medication.indication]
        .map((value) => value?.trim())
        .filter(Boolean);
      return details.length > 0
        ? `${medication.name}: ${details.join(" · ")}`
        : medication.name;
    })
    .join("\n");
}

function formatImportedRoutine(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text || "Not provided in imported EHR";
}

function formatDetailValue(value: DetailValue): string {
  if (value === null || value === undefined) {
    return "Not provided";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  const text = String(value).trim();
  return text.length > 0 ? text : "Not provided";
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
    paddingTop: 16,
    paddingBottom: 40,
  },

  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 22,
    marginBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: AppTheme.colors.border,
  },
  avatar: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: AppTheme.colors.brandSoft,
    borderWidth: 1,
    borderColor: "#B7FFF1",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 18,
  },
  avatarText: {
    color: AppTheme.colors.brand,
    fontSize: 21,
    fontWeight: "900",
  },
  headerTextBlock: {
    flex: 1,
  },
  caregiverName: {
    color: AppTheme.colors.text,
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 5,
  },
  roleText: {
    color: AppTheme.colors.textSoft,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 5,
  },
  patientLink: {
    color: AppTheme.colors.brand,
    fontSize: 14,
    fontWeight: "800",
  },

  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    marginBottom: 16,
    overflow: "hidden",
    ...AppTheme.shadow,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: AppTheme.colors.border,
  },
  cardIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  cardTitle: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },

  detailRow: {
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: AppTheme.colors.border,
    flexDirection: "row",
    alignItems: "center",
  },
  detailRowMultiline: {
    alignItems: "flex-start",
  },
  detailLabel: {
    flex: 1,
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  detailValue: {
    flex: 1.25,
    color: AppTheme.colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    textAlign: "right",
  },
  detailValueMultiline: {
    textAlign: "right",
  },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backButton: {
    paddingVertical: 6,
    paddingRight: 6,
  },
  backText: {
    color: AppTheme.colors.brand,
    fontWeight: "800",
    fontSize: 15,
  },
  topTitle: {
    color: AppTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  editChevron: {
    color: AppTheme.colors.brand,
    fontSize: 16,
    fontWeight: "900",
    marginLeft: 8,
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
  editCancel: { backgroundColor: AppTheme.colors.softSurface },
  editCancelText: { color: AppTheme.colors.textSoft, fontSize: 14, fontWeight: "900" },
  editSaveText: { color: AppTheme.colors.white, fontSize: 14, fontWeight: "900" },
});
