import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import { usePatientRecord } from "@/contexts/patient-record-context";
import {
  replacePatientSafetyNotesForPatient,
  setPrimaryProviderForPatient,
  upsertCaregiver,
  upsertPatient,
  upsertPatientSafetyProfileForPatient,
} from "@/data";
import type { Caregiver, Medication, Patient, PatientRecordSnapshot, PatientSafetySnapshot, Provider } from "@/data/types";
import { useActivePatientView } from "@/hooks/useActivePatientView";
import { useTheme } from "@/hooks/use-theme";
import {
  displayClinical,
  displayEntered,
  getComorbiditiesDisplay,
  getPatientAgeDisplay,
  getPatientDisplayName,
  getPrimaryDiagnosisDisplay,
} from "@/utils/patientDisplay";
import {
  getOnboardingProfile,
  saveOnboardingProfile,
} from "@/services/onboarding/onboardingService";

type DetailValue = string | number | boolean | null | undefined;
type EditableCaregiver = { name?: string; relationship?: string; phone?: string; experience?: string; availability?: string; languagePreference?: string; mainConcern?: string };
type EditableProvider = { name?: string | null; phone?: string | null; email?: string | null; role?: string | null };
type ProviderSaveInput = Parameters<typeof setPrimaryProviderForPatient>[0];
type PatientSafetySaveInput = Parameters<typeof upsertPatientSafetyProfileForPatient>[0];

type EditableField = "caregiverName" | "caregiverRelationship" | "caregiverPhone" | "caregiverExperience" | "caregiverMainConcern" | "caregiverLanguage" | "patientPreferredName" | "patientName" | "patientAge" | "patientRoutine" | "patientGmfcs" | "patientFms" | "patientMacs" | "patientCfcs" | "patientEdacs" | "providerName" | "providerPhone" | "providerEmail" | "providerRole" | "safetyEmergencyContactName" | "safetyEmergencyContactRelationship" | "safetyEmergencyContactPhone" | "safetyEmergencyInstructions" | "safetyNotes" | "safetyAcknowledgement";
type EditKind = "number" | "multiline" | "select" | "phone" | "email";

const LANGUAGE_OPTIONS = ["English", "Español", "English + Español", "Other"];
const LEVEL_OPTIONS = ["Not assessed", "I", "II", "III", "IV", "V"];
const FMS_OPTIONS = ["Not assessed", "1", "2", "3", "4", "5", "6"];
const SAFETY_ACKNOWLEDGEMENT_OPTIONS = ["Not provided", "Needs review", "Acknowledged"];

const CAREGIVER_RECORD_KEYS: Partial<Record<EditableField, keyof Caregiver>> = { caregiverName: "name", caregiverRelationship: "relationship", caregiverExperience: "experience", caregiverMainConcern: "mainConcern", caregiverLanguage: "languagePreference" };
const CAREGIVER_PROFILE_KEYS: Partial<Record<EditableField, keyof EditableCaregiver>> = { caregiverName: "name", caregiverRelationship: "relationship", caregiverPhone: "phone", caregiverExperience: "experience", caregiverMainConcern: "mainConcern", caregiverLanguage: "languagePreference" };
const PATIENT_FIELD_KEYS: Partial<Record<EditableField, keyof Patient>> = { patientPreferredName: "preferredName", patientName: "name", patientAge: "age", patientRoutine: "baselineDailyRoutine", patientGmfcs: "gmfcs", patientFms: "fms", patientMacs: "macs", patientCfcs: "cfcs", patientEdacs: "edacs" };
const PROVIDER_FIELD_KEYS: Partial<Record<EditableField, keyof EditableProvider>> = { providerName: "name", providerPhone: "phone", providerEmail: "email", providerRole: "role" };
const EDIT_LABELS: Record<EditableField, string> = { caregiverName: "Caregiver name", caregiverRelationship: "Relationship", caregiverPhone: "Phone", caregiverExperience: "Experience", caregiverMainConcern: "Main concern", caregiverLanguage: "Language", patientPreferredName: "Preferred name", patientName: "Full name", patientAge: "Age", patientRoutine: "Routine", patientGmfcs: "GMFCS", patientFms: "FMS", patientMacs: "MACS", patientCfcs: "CFCS", patientEdacs: "EDACS", providerName: "Provider name", providerPhone: "Provider phone", providerEmail: "Provider email", providerRole: "Provider role", safetyEmergencyContactName: "Emergency contact name", safetyEmergencyContactRelationship: "Relationship", safetyEmergencyContactPhone: "Emergency contact phone", safetyEmergencyInstructions: "Emergency instructions", safetyNotes: "Safety notes", safetyAcknowledgement: "911 acknowledgement" };
const EDIT_KINDS: Partial<Record<EditableField, EditKind>> = { patientAge: "number", patientRoutine: "multiline", caregiverLanguage: "select", patientGmfcs: "select", patientFms: "select", patientMacs: "select", patientCfcs: "select", patientEdacs: "select", providerPhone: "phone", providerEmail: "email", safetyEmergencyContactPhone: "phone", safetyEmergencyInstructions: "multiline", safetyNotes: "multiline", safetyAcknowledgement: "select" };

function phoneFromCaregiverAvailability(availability?: string | null): string | undefined {
  return availability?.match(/^Phone:\s*(.+)$/i)?.[1]?.trim();
}

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState(() => getOnboardingProfile());
  const {
    snapshot,
    patientId: activePatientId,
    mutatePatientRecord,
    refresh,
  } = usePatientRecord();
  const activePatient = useActivePatientView();
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  const caregiver = useMemo(() => {
    const base = profile.caregiver;
    const cg = snapshot?.caregiver;
    if (!cg) return null;
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

  const provider: EditableProvider = snapshot?.primaryCareProvider ?? {
    ...profile.primaryCareProvider,
    role: null,
  };
  const onboardingSafety = profile.safety;
  const patientSafety = snapshot?.patientSafety ?? null;
  const patientSafetyNotes = patientSafety?.safetyNotes ?? snapshot?.safetyNotes ?? "";
  const legacyEmergencyContact = onboardingSafety?.emergencyContact?.trim() ?? "";
  const hasStructuredEmergencyContact = Boolean(
    patientSafety?.emergencyContactName?.trim() ||
      patientSafety?.emergencyContactRelationship?.trim() ||
      patientSafety?.emergencyContactPhone?.trim() ||
      patientSafety?.emergencyInstructions?.trim(),
  );
  const showLegacyEmergencyContact =
    !hasStructuredEmergencyContact && legacyEmergencyContact.length > 0;
  const caregiverName =
    activePatient?.caregiver?.name?.trim() || "Not provided";
  const caregiverRole =
    activePatient?.caregiver?.relationship?.trim() || "Not provided";
  const patientName = getPatientDisplayName(activePatient);
  const formalPatientName = snapshot?.patient?.name?.trim() || "Not provided";
  const patientAge = getPatientAgeDisplay(activePatient);
  const medicationSummary = formatMedicationSummary(snapshot?.medications ?? []);

  const [editing, setEditing] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openEdit = (field: EditableField) => {
    setSaveError(null);
    setEditing(field);
    setDraft(getEditableFieldValue(field, caregiver, snapshot?.patient, provider, patientSafety, patientSafetyNotes));
  };

  const closeEditor = () => {
    if (saving) return;
    setEditing(null); setDraft(""); setSaveError(null);
  };

  const saveEdit = async () => {
    if (!editing || saving) return;

    const field = editing;
    const validation = validateDraft(field, draft, getEditableFieldValue(field, caregiver, snapshot?.patient, provider, patientSafety, patientSafetyNotes));
    if (validation.error) {
      setSaveError(validation.error);
      return;
    }
    if (validation.noop) {
      closeEditor();
      return;
    }

    const intendedPatientId = activePatientId ?? snapshot?.patient?.patientId;
    if (!intendedPatientId) {
      setSaveError("No active patient is selected.");
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      if (field.startsWith("caregiver")) {
        let caregiverForPersist: Caregiver | null = null;
        await mutatePatientRecord((latestSnapshot) => {
          const patientId = latestSnapshot.patient?.patientId;
          if (!patientId || patientId !== intendedPatientId) {
            throw new Error(`Cannot update caregiver for inactive patient: ${intendedPatientId}`);
          }
          const nextCaregiver = patchCaregiverField(latestSnapshot, field, validation.value);
          caregiverForPersist = nextCaregiver;
          return { ...latestSnapshot, caregiver: nextCaregiver };
        }, () => {
          if (!caregiverForPersist) throw new Error("Caregiver update was not prepared.");
          upsertCaregiver(caregiverForPersist);
        });
        updateCaregiverMirror(field, validation.value);
      } else if (field.startsWith("provider")) {
        let providerForPersist: ProviderSaveInput | null = null;
        let persistedProvider: Provider | null = null;
        let needsSnapshotRefresh = false;
        const compatibilityProvider = getOnboardingProfile().primaryCareProvider;
        await mutatePatientRecord((latestSnapshot) => {
          const patient = latestSnapshot.patient;
          if (!patient || patient.patientId !== intendedPatientId) {
            throw new Error(`Cannot update provider for inactive patient: ${intendedPatientId}`);
          }
          const prepared = prepareProviderFieldSave(latestSnapshot, field, validation.value, compatibilityProvider);
          providerForPersist = prepared.input;
          needsSnapshotRefresh = prepared.optimisticProvider === null;
          return prepared.optimisticProvider
            ? { ...latestSnapshot, primaryCareProvider: prepared.optimisticProvider }
            : latestSnapshot;
        }, () => {
          if (!providerForPersist) throw new Error("Provider update was not prepared.");
          persistedProvider = setPrimaryProviderForPatient(providerForPersist);
        });
        if (persistedProvider) updateProviderMirror(persistedProvider);
        if (needsSnapshotRefresh) refresh();
      } else if (field.startsWith("safety")) {
        if (field === "safetyNotes") {
          let safetyNotesForPersist: string | null = null;
          await mutatePatientRecord((latestSnapshot) => {
            const patient = latestSnapshot.patient;
            if (!patient || patient.patientId !== intendedPatientId) {
              throw new Error(`Cannot update Safety for inactive patient: ${intendedPatientId}`);
            }
            const nextSafetyNotes = validation.value;
            const nextSafety = createOptimisticPatientSafety(latestSnapshot, {
              safetyNotes: nextSafetyNotes,
            });
            safetyNotesForPersist = nextSafetyNotes || null;
            return {
              ...latestSnapshot,
              safetyNotes: nextSafetyNotes,
              patientSafety: nextSafety,
            };
          }, () => {
            replacePatientSafetyNotesForPatient(intendedPatientId, safetyNotesForPersist);
          });
          updateSafetyMirror({ safetyNotes: validation.value });
        } else {
          let safetyForPersist: PatientSafetySaveInput | null = null;
          await mutatePatientRecord((latestSnapshot) => {
            const patient = latestSnapshot.patient;
            if (!patient || patient.patientId !== intendedPatientId) {
              throw new Error(`Cannot update Safety for inactive patient: ${intendedPatientId}`);
            }
            const prepared = prepareSafetyProfileFieldSave(
              latestSnapshot,
              field,
              validation.value,
            );
            safetyForPersist = prepared.input;
            return { ...latestSnapshot, patientSafety: prepared.optimisticSafety };
          }, () => {
            if (!safetyForPersist) throw new Error("Safety update was not prepared.");
            upsertPatientSafetyProfileForPatient(safetyForPersist);
          });
          if (field === "safetyAcknowledgement") {
            updateSafetyMirror({
              emergencyDisclaimerAccepted: safetyAcknowledgementToValue(validation.value),
            });
          }
        }
      } else {
        let patientForPersist: Patient | null = null;
        await mutatePatientRecord((latestSnapshot) => {
          const patient = latestSnapshot.patient;
          if (!patient || patient.patientId !== intendedPatientId) {
            throw new Error(`Cannot update profile for inactive patient: ${intendedPatientId}`);
          }
          const nextPatient = patchPatientField(patient, field, validation.value);
          patientForPersist = nextPatient;
          return { ...latestSnapshot, patient: nextPatient };
        }, () => {
          if (!patientForPersist) throw new Error("Patient update was not prepared.");
          upsertPatient(patientForPersist);
        });
      }

      setEditing(null);
      setDraft("");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Profile update failed. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const updateCaregiverMirror = (field: EditableField, value: string) => {
    const mirrorKey = CAREGIVER_PROFILE_KEYS[field as keyof typeof CAREGIVER_PROFILE_KEYS];
    if (!mirrorKey) return;
    setProfile((current) => {
      const updatedProfile = {
        ...current,
        caregiver: { ...current.caregiver, [mirrorKey]: value },
      };
      saveOnboardingProfile(updatedProfile);
      return updatedProfile;
    });
  };

  const updateProviderMirror = (nextProvider: Provider) => {
    setProfile((current) => {
      const updatedProfile = {
        ...current,
        primaryCareProvider: {
          ...current.primaryCareProvider,
          name: nextProvider.name,
          phone: nextProvider.phone ?? "",
          email: nextProvider.email ?? "",
        },
      };
      saveOnboardingProfile(updatedProfile);
      return updatedProfile;
    });
  };

  const updateSafetyMirror = (patch: {
    safetyNotes?: string;
    emergencyDisclaimerAccepted?: boolean | null;
  }) => {
    setProfile((current) => {
      const updatedProfile = {
        ...current,
        safety: {
          ...current.safety,
          ...(patch.safetyNotes !== undefined
            ? { safetyNotes: patch.safetyNotes }
            : {}),
          ...(patch.emergencyDisclaimerAccepted !== undefined
            ? {
                emergencyDisclaimerAccepted:
                  patch.emergencyDisclaimerAccepted ?? undefined,
              }
            : {}),
        },
      };
      saveOnboardingProfile(updatedProfile);
      return updatedProfile;
    });
  };

  const editingLabel = editing ? EDIT_LABELS[editing] : "profile field";
  const editingKind = editing ? EDIT_KINDS[editing] ?? "text" : "text";
  const keyboardType = editingKind === "number" ? "number-pad" : editingKind === "phone" ? "phone-pad" : editingKind === "email" ? "email-address" : "default";
  const autoCapitalize = editingKind === "email" ? "none" : editing === "providerName" || editing === "safetyEmergencyContactName" ? "words" : undefined;
  const selectOptions = editing ? getSelectOptions(editing, draft) : [];

  return (
    <SafeAreaView style={[styles.safeArea, themedStyles.screen]} edges={["top", "bottom"]}>
      <View style={[styles.root, themedStyles.screen]}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
          <Text style={[styles.topTitle, themedStyles.primaryText]}>Profile</Text>
        </View>

        <ScrollView
          style={themedStyles.screen}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={[styles.profileHeader, themedStyles.divider]}>
            <View style={[styles.avatar, themedStyles.softSurface]}>
              <Text style={styles.avatarText}>{getInitials(caregiverName)}</Text>
            </View>

            <View style={styles.headerTextBlock}>
              <Text style={[styles.caregiverName, themedStyles.primaryText]}>
                {formatDetailValue(caregiverName)}
              </Text>

              <Text style={[styles.roleText, themedStyles.secondaryText]}>
                Caregiver · {formatDetailValue(caregiverRole)}
              </Text>

              <Text style={styles.patientLink}>
                Caring for {formatDetailValue(patientName)},{" "}
                {formatDetailValue(patientAge)}
              </Text>
            </View>
          </View>

          <ProfileCard title="Caregiver · tap to edit" icon="profile">
            <EditableDetailRow label="Name" value={caregiver?.name} onPress={() => openEdit("caregiverName")} />
            <EditableDetailRow label="Relationship" value={caregiver?.relationship} onPress={() => openEdit("caregiverRelationship")} />
            <EditableDetailRow label="Phone" value={caregiver?.phone} onPress={() => openEdit("caregiverPhone")} />
            <EditableDetailRow label="Experience" value={caregiver?.experience} onPress={() => openEdit("caregiverExperience")} />
            <DetailRow label="Availability" value={caregiver?.availability} />
            <EditableDetailRow label="Main concern" value={caregiver?.mainConcern} onPress={() => openEdit("caregiverMainConcern")} />
            <EditableDetailRow label="Language" value={caregiver?.languagePreference} onPress={() => openEdit("caregiverLanguage")} />
          </ProfileCard>

          <ProfileCard title="Patient" icon="care">
            <EditableDetailRow label="Preferred name" value={patientName} onPress={() => openEdit("patientPreferredName")} />
            <EditableDetailRow label="Full name" value={formalPatientName} onPress={() => openEdit("patientName")} />
            <EditableDetailRow label="Age" value={patientAge} onPress={() => openEdit("patientAge")} />
            <DetailRow label="Primary diagnosis" value={getPrimaryDiagnosisDisplay(activePatient)} />
            <DetailRow label="Comorbidities" value={getComorbiditiesDisplay(activePatient)} />
            <DetailRow label="SpO₂ cutoff" value={displayClinical(activePatient?.spo2Cutoff)} />
            <DetailRow label="Baseline HR" value={displayEntered(activePatient?.baselineHeartRate)} />
            <EditableDetailRow label="GMFCS" value={displayEntered(activePatient?.classifications.gmfcs)} onPress={() => openEdit("patientGmfcs")} />
            <EditableDetailRow label="FMS" value={displayEntered(activePatient?.classifications.fms)} onPress={() => openEdit("patientFms")} />
            <EditableDetailRow label="MACS" value={displayEntered(activePatient?.classifications.macs)} onPress={() => openEdit("patientMacs")} />
            <EditableDetailRow label="CFCS" value={displayEntered(activePatient?.classifications.cfcs)} onPress={() => openEdit("patientCfcs")} />
            <EditableDetailRow label="EDACS" value={displayEntered(activePatient?.classifications.edacs)} onPress={() => openEdit("patientEdacs")} />
            <EditableDetailRow label="Routine" value={formatImportedRoutine(activePatient?.baselineDailyRoutine)} multiline onPress={() => openEdit("patientRoutine")} />
            <DetailRow
              label="Medications"
              value={displayClinical(medicationSummary)}
              multiline
            />
          </ProfileCard>

          <ProfileCard title="Primary Care Provider" icon="provider">
            <EditableDetailRow label="Name" value={provider.name} onPress={() => openEdit("providerName")} />
            <EditableDetailRow label="Phone" value={provider.phone} onPress={() => openEdit("providerPhone")} />
            <EditableDetailRow label="Email" value={provider.email} onPress={() => openEdit("providerEmail")} />
            <EditableDetailRow label="Role" value={provider.role} onPress={() => openEdit("providerRole")} />
          </ProfileCard>

          <ProfileCard title="Safety" icon="alert">
            <EditableDetailRow label="Emergency contact name" value={patientSafety?.emergencyContactName} onPress={() => openEdit("safetyEmergencyContactName")} />
            <EditableDetailRow label="Relationship" value={patientSafety?.emergencyContactRelationship} onPress={() => openEdit("safetyEmergencyContactRelationship")} />
            <EditableDetailRow label="Phone" value={patientSafety?.emergencyContactPhone} onPress={() => openEdit("safetyEmergencyContactPhone")} />
            <EditableDetailRow label="Emergency instructions" value={patientSafety?.emergencyInstructions} multiline onPress={() => openEdit("safetyEmergencyInstructions")} />
            <EditableDetailRow label="Safety notes" value={patientSafetyNotes} multiline onPress={() => openEdit("safetyNotes")} />
            <EditableDetailRow label="911 acknowledgement" value={formatSafetyAcknowledgement(patientSafety?.emergencyDisclaimerAccepted)} onPress={() => openEdit("safetyAcknowledgement")} />
            {showLegacyEmergencyContact ? (
              <DetailRow
                label="Previous contact information"
                value={legacyEmergencyContact}
                multiline
              />
            ) : null}
          </ProfileCard>
        </ScrollView>

        <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={closeEditor}>
          <Pressable style={styles.editOverlay} onPress={closeEditor}>
            <Pressable style={[styles.editSheet, themedStyles.card]} onPress={(e) => e.stopPropagation()}>
              <Text style={[styles.editTitle, themedStyles.primaryText]}>Edit {editingLabel}</Text>
              {editingKind === "select" ? (
                <View style={styles.optionList}>
                  {selectOptions.map((option) => {
                    const selected = option === draft;
                    const label = getOptionLabel(editing, option);
                    return (
                      <Pressable key={option} style={[styles.optionRow, themedStyles.optionSurface, selected && styles.optionRowSelected]} onPress={() => setDraft(option)} accessibilityRole="button" accessibilityLabel={`Select ${label}`} accessibilityState={{ selected, disabled: saving }} disabled={saving}>
                        <Text style={[styles.optionText, themedStyles.primaryText, selected && styles.optionTextSelected]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <TextInput style={[styles.editInput, themedStyles.input, editingKind === "multiline" && styles.editInputMultiline]} value={draft} onChangeText={setDraft} autoFocus multiline={editingKind === "multiline"} keyboardType={keyboardType} autoCapitalize={autoCapitalize} placeholder="Enter value..." placeholderTextColor={theme.appTextMuted} accessibilityLabel={editingLabel} editable={!saving} />
              )}
              {saveError ? (
                <Text style={styles.editError} accessibilityRole="alert">{saveError}</Text>
              ) : null}
              <View style={styles.editActions}>
                <Pressable style={[styles.editButton, styles.editCancel, themedStyles.controlSurface]} onPress={closeEditor} accessibilityRole="button" accessibilityLabel="Cancel profile edit" accessibilityState={{ disabled: saving }} disabled={saving}>
                  <Text style={[styles.editCancelText, themedStyles.secondaryText]}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.editButton, saving && styles.editButtonDisabled]} onPress={saveEdit} accessibilityRole="button" accessibilityLabel={`Save ${editingLabel}`} accessibilityState={{ disabled: saving }} disabled={saving}>
                  <Text style={styles.editSaveText}>{saving ? "Saving" : "Save"}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

function getEditableFieldValue(
  field: EditableField,
  caregiver: EditableCaregiver | null,
  patient: Patient | null | undefined,
  provider: EditableProvider | null | undefined,
  safety: PatientSafetySnapshot | null,
  safetyNotes: string,
): string {
  if (field === "caregiverPhone") return caregiver?.phone ?? "";
  const caregiverKey = CAREGIVER_PROFILE_KEYS[field];
  if (caregiverKey) return String(caregiver?.[caregiverKey] ?? "");
  const providerKey = PROVIDER_FIELD_KEYS[field];
  if (providerKey) return String(provider?.[providerKey] ?? "");
  if (field === "safetyEmergencyContactName") return safety?.emergencyContactName ?? "";
  if (field === "safetyEmergencyContactRelationship") return safety?.emergencyContactRelationship ?? "";
  if (field === "safetyEmergencyContactPhone") return safety?.emergencyContactPhone ?? "";
  if (field === "safetyEmergencyInstructions") return safety?.emergencyInstructions ?? "";
  if (field === "safetyNotes") return safetyNotes;
  if (field === "safetyAcknowledgement") {
    return formatSafetyAcknowledgement(safety?.emergencyDisclaimerAccepted);
  }
  const patientKey = PATIENT_FIELD_KEYS[field];
  return patientKey ? String(patient?.[patientKey] ?? "") : "";
}

function validateDraft(field: EditableField, draft: string, currentValue: string): { value: string; noop?: boolean; error?: string } {
  const value = draft.trim();
  const current = currentValue.trim();
  if (field === "providerName" && !value) {
    return { value, error: "Provider name is required." };
  }
  if (value === current) return { value, noop: true };
  if (!value && current && !isOptionalSafetyTextField(field)) {
    return { value, error: "Leave the existing value in place or enter a new value." };
  }
  if (!value) {
    return current && isOptionalSafetyTextField(field)
      ? { value }
      : { value, noop: true };
  }
  if (field === "patientAge" && !/^\d+$/.test(value)) {
    return { value, error: "Age must be a nonnegative whole number." };
  }
  return { value };
}

function patchCaregiverField(latestSnapshot: PatientRecordSnapshot, field: EditableField, value: string): Caregiver {
  const now = new Date().toISOString();
  const patientId = latestSnapshot.patient?.patientId ?? "";
  const nextCaregiver: Caregiver = latestSnapshot.caregiver
    ? { ...latestSnapshot.caregiver }
    : { caregiverId: `caregiver-${patientId}`, patientId, name: "Caregiver", createdAt: now };
  const caregiverKey = CAREGIVER_RECORD_KEYS[field];

  if (field === "caregiverPhone") nextCaregiver.availability = `Phone: ${value}`;
  else if (caregiverKey) Object.assign(nextCaregiver, { [caregiverKey]: value });
  if (!nextCaregiver.name.trim()) {
    nextCaregiver.name = "Caregiver";
  }
  return nextCaregiver;
}

function patchPatientField(patient: Patient, field: EditableField, value: string): Patient {
  const patientKey = PATIENT_FIELD_KEYS[field];
  return patientKey
    ? { ...patient, [patientKey]: value, updatedAt: new Date().toISOString() }
    : { ...patient, updatedAt: new Date().toISOString() };
}

function prepareProviderFieldSave(
  latestSnapshot: PatientRecordSnapshot,
  field: EditableField,
  value: string,
  compatibilityProvider: EditableProvider,
): { input: ProviderSaveInput; optimisticProvider: Provider | null } {
  const patientId = latestSnapshot.patient?.patientId ?? "";
  const existingProvider = latestSnapshot.primaryCareProvider ?? null;
  const baseName = existingProvider?.name ?? compatibilityProvider.name ?? "";
  const basePhone = existingProvider?.phone ?? (existingProvider ? "" : compatibilityProvider.phone) ?? "";
  const baseEmail = existingProvider?.email ?? (existingProvider ? "" : compatibilityProvider.email) ?? "";
  const baseRole = existingProvider?.role ?? "";
  const name = field === "providerName" ? value : baseName.trim();
  const phone = field === "providerPhone" ? value : basePhone.trim();
  const email = field === "providerEmail" ? value : baseEmail.trim();
  const role = field === "providerRole" ? value : baseRole.trim();

  if (!name) {
    throw new Error("Provider name is required before saving contact details.");
  }

  const input: ProviderSaveInput = {
    providerId: existingProvider?.providerId,
    patientId,
    name,
    phone: phone || null,
    email: email || null,
    role: role || null,
  };

  return {
    input,
    optimisticProvider: existingProvider
      ? {
          ...existingProvider,
          name,
          phone: phone || null,
          email: email || null,
          role: role || null,
          isPrimary: true,
        }
      : null,
  };
}

function prepareSafetyProfileFieldSave(
  latestSnapshot: PatientRecordSnapshot,
  field: EditableField,
  value: string,
): { input: PatientSafetySaveInput; optimisticSafety: PatientSafetySnapshot } {
  const baseSafety = createOptimisticPatientSafety(latestSnapshot);
  const input: PatientSafetySaveInput = { patientId: baseSafety.patientId };
  let optimisticSafety = baseSafety;

  if (field === "safetyEmergencyContactName") {
    const nextValue = value || null;
    input.emergencyContactName = nextValue;
    optimisticSafety = { ...baseSafety, emergencyContactName: nextValue };
  } else if (field === "safetyEmergencyContactRelationship") {
    const nextValue = value || null;
    input.emergencyContactRelationship = nextValue;
    optimisticSafety = { ...baseSafety, emergencyContactRelationship: nextValue };
  } else if (field === "safetyEmergencyContactPhone") {
    const nextValue = value || null;
    input.emergencyContactPhone = nextValue;
    optimisticSafety = { ...baseSafety, emergencyContactPhone: nextValue };
  } else if (field === "safetyEmergencyInstructions") {
    const nextValue = value || null;
    input.emergencyInstructions = nextValue;
    optimisticSafety = { ...baseSafety, emergencyInstructions: nextValue };
  } else if (field === "safetyAcknowledgement") {
    const nextValue = safetyAcknowledgementToValue(value);
    input.emergencyDisclaimerAccepted = nextValue;
    optimisticSafety = { ...baseSafety, emergencyDisclaimerAccepted: nextValue };
  }

  return { input, optimisticSafety };
}

function createOptimisticPatientSafety(
  latestSnapshot: PatientRecordSnapshot,
  patch: Partial<PatientSafetySnapshot> = {},
): PatientSafetySnapshot {
  const patientId = latestSnapshot.patient?.patientId ?? "";
  const currentSafety = latestSnapshot.patientSafety;
  return {
    patientId: currentSafety?.patientId ?? patientId,
    safetyNotes: currentSafety?.safetyNotes ?? latestSnapshot.safetyNotes ?? "",
    emergencyContactName: currentSafety?.emergencyContactName ?? null,
    emergencyContactRelationship:
      currentSafety?.emergencyContactRelationship ?? null,
    emergencyContactPhone: currentSafety?.emergencyContactPhone ?? null,
    emergencyInstructions: currentSafety?.emergencyInstructions ?? null,
    emergencyDisclaimerAccepted:
      currentSafety?.emergencyDisclaimerAccepted ?? null,
    updatedAt: currentSafety?.updatedAt ?? null,
    ...patch,
  };
}

function formatSafetyAcknowledgement(value: boolean | null | undefined): string {
  if (value === true) return "Acknowledged";
  if (value === false) return "Needs review";
  return "Not provided";
}

function safetyAcknowledgementToValue(value: string): boolean | null {
  if (value === "Acknowledged") return true;
  if (value === "Needs review") return false;
  return null;
}

function isOptionalSafetyTextField(field: EditableField): boolean {
  return (
    field === "safetyEmergencyContactName" ||
    field === "safetyEmergencyContactRelationship" ||
    field === "safetyEmergencyContactPhone" ||
    field === "safetyEmergencyInstructions" ||
    field === "safetyNotes"
  );
}

function getSelectOptions(field: EditableField, currentValue: string): string[] {
  if (field === "safetyAcknowledgement") return SAFETY_ACKNOWLEDGEMENT_OPTIONS;
  const options = field === "caregiverLanguage" ? LANGUAGE_OPTIONS : field === "patientFms" ? FMS_OPTIONS : EDIT_KINDS[field] === "select" ? LEVEL_OPTIONS : [];
  const customValue = currentValue.trim();
  if (customValue && !options.includes(customValue)) return [customValue, ...options];
  return options;
}

function getOptionLabel(field: EditableField | null, value: string): string {
  return field && field !== "patientFms" && LEVEL_OPTIONS.includes(value) && value !== "Not assessed" ? `Level ${value}` : value;
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
  const themedStyles = createThemedStyles(useTheme());

  return (
    <View style={[styles.card, themedStyles.card]}>
      <View style={[styles.cardHeader, themedStyles.divider]}>
        <View style={[styles.cardIconCircle, themedStyles.softSurface]}>
          <AppIcon name={icon} size={18} color={AppTheme.colors.brand} />
        </View>

        <Text style={[styles.cardTitle, themedStyles.primaryText]}>{title}</Text>
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
  const themedStyles = createThemedStyles(useTheme());

  return (
    <View style={[styles.detailRow, themedStyles.divider, multiline && styles.detailRowMultiline]}>
      <Text style={[styles.detailLabel, themedStyles.secondaryText]}>{label}</Text>
      <Text
        style={[styles.detailValue, themedStyles.primaryText, multiline && styles.detailValueMultiline]}
      >
        {formatDetailValue(value)}
      </Text>
    </View>
  );
}

function EditableDetailRow({
  label,
  value,
  multiline,
  onPress,
}: {
  label: string;
  value: DetailValue;
  multiline?: boolean;
  onPress: () => void;
}) {
  const themedStyles = createThemedStyles(useTheme());

  return (
    <Pressable
      style={[styles.detailRow, themedStyles.divider, multiline && styles.detailRowMultiline]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${label}`}
    >
      <Text style={[styles.detailLabel, themedStyles.secondaryText]}>{label}</Text>
      <Text
        style={[styles.detailValue, themedStyles.primaryText, multiline && styles.detailValueMultiline]}
      >
        {formatDetailValue(value)}
      </Text>
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

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { backgroundColor: theme.appBackground },
    card: { backgroundColor: theme.appSurface, borderColor: theme.appBorder },
    divider: { borderBottomColor: theme.appBorder },
    softSurface: { backgroundColor: theme.appBrandSoftSurface, borderColor: theme.appProfileAvatarBorder },
    controlSurface: { backgroundColor: theme.appControlSurface },
    input: { color: theme.appText, backgroundColor: theme.appInputBackground, borderColor: theme.appBorder },
    optionSurface: { backgroundColor: theme.appInputBackground, borderColor: theme.appBorder },
    primaryText: { color: theme.appText },
    secondaryText: { color: theme.appTextSupporting },
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
  editInputMultiline: { minHeight: 110, textAlignVertical: "top" },
  editError: { color: AppTheme.colors.danger, fontSize: 13, lineHeight: 18, fontWeight: "800", marginTop: 12 },
  optionList: { gap: 8 },
  optionRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  optionRowSelected: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  optionText: { fontSize: 14, lineHeight: 19, fontWeight: "900" },
  optionTextSelected: { color: AppTheme.colors.white },
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
  editButtonDisabled: { opacity: 0.6 },
  editCancel: { backgroundColor: AppTheme.colors.softSurface },
  editCancelText: { color: AppTheme.colors.textSoft, fontSize: 14, fontWeight: "900" },
  editSaveText: { color: AppTheme.colors.white, fontSize: 14, fontWeight: "900" },
});
