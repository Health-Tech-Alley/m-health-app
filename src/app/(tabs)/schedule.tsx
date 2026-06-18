import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import { usePatientRecord } from "@/contexts/patient-record-context";
import {
  deleteAppointment,
  getUpcomingAppointments,
  insertAppointment,
  updateAppointment,
  type Appointment,
} from "@/data";
import { audit } from "@/services/audit/auditService";
import { getOnboardingProfile } from "@/services/onboarding/onboardingService";

const appointmentTypes = [
  "Primary care",
  "Pulmonology",
  "Neurology",
  "Physical therapy",
  "Medication review",
];

const reminderOptions = [
  "15 min before",
  "1 hour before",
  "1 day before",
  "1 week before",
];

function emptyForm(profile: ReturnType<typeof getOnboardingProfile>) {
  const today = new Date();
  today.setDate(today.getDate() + 1);
  return {
    appointmentType: "Primary care",
    providerName: profile.primaryCareProvider.name,
    date: today.toISOString().slice(0, 10),
    time: "10:30 AM",
    location: "Main clinic",
    reason: "Follow up on breathing episodes",
    reminder: "1 day before",
  };
}

export default function ScheduleScreen() {
  const profile = getOnboardingProfile();
  const { patientId } = usePatientRecord();

  const [form, setForm] = useState(() => emptyForm(profile));
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [toastOpacity] = useState(new Animated.Value(0));

  const [editing, setEditing] = useState<Appointment | null>(null);
  const [editForm, setEditForm] = useState(emptyForm(profile));

  const reload = useCallback(() => {
    if (patientId) setUpcoming(getUpcomingAppointments(patientId));
  }, [patientId]);

  useEffect(() => {
    const handle = setTimeout(() => reload(), 0);
    return () => clearTimeout(handle);
  }, [reload]);

  const showToast = (message: string) => {
    setToast(message);
    Animated.timing(toastOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 600,
        delay: 1800,
        useNativeDriver: true,
      }).start(() => setToast(null));
    });
  };

  const handleSchedule = () => {
    if (!patientId) return;
    const appt = insertAppointment({
      patientId,
      type: form.appointmentType,
      provider: form.providerName,
      date: form.date,
      time: form.time,
      location: form.location,
      reason: form.reason,
      reminder: form.reminder,
      status: "scheduled",
    });
    audit({
      actor: "caregiver",
      action: "schedule_appointment",
      resourceType: "appointment",
      resourceId: appt.appointmentId,
      patientId,
      payload: { type: appt.type, date: appt.date },
    });
    reload();
    showToast("Appointment added — you'll be notified");
    setForm(emptyForm(profile));
  };

  const openEdit = (appt: Appointment) => {
    setEditing(appt);
    setEditForm({
      appointmentType: appt.type,
      providerName: appt.provider ?? profile.primaryCareProvider.name,
      date: appt.date,
      time: appt.time ?? "10:00 AM",
      location: appt.location ?? "",
      reason: appt.reason ?? "",
      reminder: appt.reminder ?? "1 day before",
    });
  };

  const saveEdit = () => {
    if (!patientId || !editing) return;
    updateAppointment({
      ...editing,
      type: editForm.appointmentType,
      provider: editForm.providerName,
      date: editForm.date,
      time: editForm.time,
      location: editForm.location,
      reason: editForm.reason,
      reminder: editForm.reminder,
    });
    audit({
      actor: "caregiver",
      action: "edit_appointment",
      resourceType: "appointment",
      resourceId: editing.appointmentId,
      patientId,
    });
    setEditing(null);
    reload();
  };

  const handleDelete = (appt: Appointment) => {
    if (!patientId) return;
    Alert.alert(
      "Delete appointment",
      `Delete the ${appt.type} appointment on ${appt.date}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteAppointment(appt.appointmentId);
            audit({
              actor: "caregiver",
              action: "delete_appointment",
              resourceType: "appointment",
              resourceId: appt.appointmentId,
              patientId,
            });
            reload();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.root}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.kicker}>Caregiver Concierge</Text>
              <Text style={styles.title}>Schedule</Text>
              <Text style={styles.subtitle}>
                Create doctor appointments and caregiver reminders.
              </Text>
            </View>

            <View style={styles.headerIconCircle}>
              <AppIcon name="calendarPlus" size={30} color={AppTheme.colors.brand} />
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Appointment type</Text>

            <View style={styles.chipRow}>
              {appointmentTypes.map((type) => {
                const selected = form.appointmentType === type;
                return (
                  <Pressable
                    key={type}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setForm({ ...form, appointmentType: type })}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {type}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Field
              label="Provider"
              value={form.providerName}
              onChangeText={(v) => setForm({ ...form, providerName: v })}
              placeholder="Dr. Smith"
            />

            <View style={styles.twoColumnFields}>
              <Field
                label="Date"
                value={form.date}
                onChangeText={(v) => setForm({ ...form, date: v })}
                placeholder="YYYY-MM-DD"
              />
              <Field
                label="Time"
                value={form.time}
                onChangeText={(v) => setForm({ ...form, time: v })}
                placeholder="10:30 AM"
              />
            </View>

            <Field
              label="Location"
              value={form.location}
              onChangeText={(v) => setForm({ ...form, location: v })}
              placeholder="Clinic name or address"
            />

            <LargeField
              label="Reason for visit"
              value={form.reason}
              onChangeText={(v) => setForm({ ...form, reason: v })}
              placeholder="What should the provider review?"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Reminder</Text>
            <Text style={styles.helperText}>
              Choose when the caregiver should be reminded before the appointment.
            </Text>

            <View style={styles.chipRow}>
              {reminderOptions.map((option) => {
                const selected = form.reminder === option;
                return (
                  <Pressable
                    key={option}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setForm({ ...form, reminder: option })}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable style={styles.scheduleButton} onPress={handleSchedule}>
              <Text style={styles.scheduleButtonText}>Schedule appointment</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Upcoming</Text>

            {upcoming.length === 0 ? (
              <Text style={styles.emptyText}>No upcoming appointments.</Text>
            ) : (
              upcoming.map((appt) => (
                <View key={appt.appointmentId} style={styles.appointmentRow}>
                  <View style={styles.appointmentIconCircle}>
                    <AppIcon name="doctor" size={22} color={AppTheme.colors.brand} />
                  </View>

                  <View style={styles.appointmentTextBlock}>
                    <Text style={styles.appointmentType}>{appt.type}</Text>
                    <Text style={styles.appointmentProvider}>{appt.provider}</Text>
                  </View>

                  <View style={styles.appointmentTimeBlock}>
                    <Text style={styles.appointmentDate}>{appt.date}</Text>
                    <Text style={styles.appointmentTime}>{appt.time}</Text>
                    <View style={styles.appointmentActions}>
                      <Pressable onPress={() => openEdit(appt)} hitSlop={8}>
                        <Text style={styles.editLink}>Edit</Text>
                      </Pressable>
                      <Pressable onPress={() => handleDelete(appt)} hitSlop={8}>
                        <Text style={styles.deleteLink}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>

        {/* Fading toast */}
        {toast ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.toast, { opacity: toastOpacity }]}
          >
            <Text style={styles.toastText}>{toast}</Text>
          </Animated.View>
        ) : null}

        {/* Edit modal */}
        {editing ? (
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>Edit appointment</Text>

              <Text style={styles.modalLabel}>Type</Text>
              <View style={styles.chipRow}>
                {appointmentTypes.map((type) => {
                  const selected = editForm.appointmentType === type;
                  return (
                    <Pressable
                      key={type}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => setEditForm({ ...editForm, appointmentType: type })}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {type}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Field
                label="Provider"
                value={editForm.providerName}
                onChangeText={(v) => setEditForm({ ...editForm, providerName: v })}
                placeholder="Dr. Smith"
              />
              <View style={styles.twoColumnFields}>
                <Field
                  label="Date"
                  value={editForm.date}
                  onChangeText={(v) => setEditForm({ ...editForm, date: v })}
                  placeholder="YYYY-MM-DD"
                />
                <Field
                  label="Time"
                  value={editForm.time}
                  onChangeText={(v) => setEditForm({ ...editForm, time: v })}
                  placeholder="10:30 AM"
                />
              </View>
              <Field
                label="Location"
                value={editForm.location}
                onChangeText={(v) => setEditForm({ ...editForm, location: v })}
                placeholder="Clinic name or address"
              />
              <LargeField
                label="Reason"
                value={editForm.reason}
                onChangeText={(v) => setEditForm({ ...editForm, reason: v })}
                placeholder="Reason for visit"
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
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={AppTheme.colors.textMuted}
      />
    </View>
  );
}

function LargeField({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, styles.largeInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={AppTheme.colors.textMuted}
        multiline
        textAlignVertical="top"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AppTheme.colors.screen },
  root: { flex: 1, backgroundColor: AppTheme.colors.screen },
  content: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 124 },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 24,
    gap: 16,
  },
  kicker: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  subtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
    marginTop: 8,
  },
  headerIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 20,
    marginBottom: 20,
    ...AppTheme.shadow,
  },
  sectionTitle: {
    color: AppTheme.colors.sectionText,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  helperText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    marginBottom: 14,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  chip: {
    borderRadius: AppTheme.radius.pill,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  chipSelected: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  chipText: { color: AppTheme.colors.textSoft, fontSize: 13, fontWeight: "900" },
  chipTextSelected: { color: AppTheme.colors.white },
  fieldBlock: { flex: 1, marginBottom: 14 },
  fieldLabel: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
  },
  input: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  largeInput: { minHeight: 102, textAlignVertical: "top" },
  twoColumnFields: { flexDirection: "row", gap: 12 },
  scheduleButton: {
    minHeight: 58,
    borderRadius: 20,
    backgroundColor: AppTheme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  scheduleButtonText: {
    color: AppTheme.colors.white,
    fontSize: 16,
    fontWeight: "900",
  },
  emptyText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    paddingVertical: 16,
  },
  appointmentRow: {
    minHeight: 86,
    borderRadius: 18,
    backgroundColor: AppTheme.colors.softSurface,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  appointmentIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },
  appointmentTextBlock: { flex: 1 },
  appointmentType: { color: AppTheme.colors.text, fontSize: 15, fontWeight: "900" },
  appointmentProvider: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 3,
  },
  appointmentTimeBlock: { alignItems: "flex-end" },
  appointmentDate: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
  },
  appointmentTime: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3,
  },
  appointmentActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 6,
  },
  editLink: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: "900",
  },
  deleteLink: {
    color: AppTheme.colors.danger,
    fontSize: 12,
    fontWeight: "900",
  },
  toast: {
    position: "absolute",
    bottom: 110,
    left: 24,
    right: 24,
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  toastText: {
    color: AppTheme.colors.white,
    fontSize: 14,
    fontWeight: "900",
  },
  modalOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  modalSheet: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    padding: 20,
    maxHeight: "90%",
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
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 14,
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
