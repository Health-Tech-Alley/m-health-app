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
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "@/components/AppIcon";
import { MainTabHeader } from "@/components/MainTabHeader";
import { AppTheme } from "@/constants/theme";
import { usePatientRecord } from "@/contexts/patient-record-context";
import {
  deleteAppointment,
  insertAppointment,
  updateAppointment,
  type Appointment
} from "@/data";
import { audit } from "@/services/audit/auditService";
import { dispatchImmediate } from "@/services/notifications/notificationService";
import { getOnboardingProfile } from "@/services/onboarding/onboardingService";
import { useAppSelector } from '@/store/hooks';

/* ---------------------------------------------------------------------- */
/* athenahealth — inline, minimal setup                                    */
/* ---------------------------------------------------------------------- */
// TODO: fill these in with your sandbox app credentials.
// NOTE: embedding a client secret in a shipped mobile app is not safe for
// production — fine for local sandbox testing only. For a real app, get
// the token from your own backend instead.
const ATHENA_BASE_URL = "https://api.preview.platform.athenahealth.com/v1";
const ATHENA_PRACTICE_ID = "195900";
const ATHENA_DEPARTMENT_ID = "1";
const ATHENA_PROVIDER_ID = "71"; // confirmed working provider in sandbox
const ATHENA_REASON_ID = "1285"; // "Follow-Up" — confirmed valid for provider 71 / department 1
const ATHENA_CLIENT_ID = "0oa105tul7l4hR4d5298";
const ATHENA_CLIENT_SECRET = "LkwklKnYAgw8-nBxfvhq38_RcLdUpPZwrojd3AbwCldnPPpM3qGEgrgAKhTmX6Mv";

let cachedToken: { value: string; expiresAt: number } | null = null;

/** Fetches (and caches) an OAuth2 client_credentials token. */
async function getAthenaToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  const response = await fetch("https://api.preview.platform.athenahealth.com/oauth2/v1/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${ATHENA_CLIENT_ID}:${ATHENA_CLIENT_SECRET}`),
    },
    body: "grant_type=client_credentials&scope=athena/service/Athenanet.MDP.*",
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error_description ?? "Failed to get athenahealth token");
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

/** Simple authenticated request helper against the practice-scoped API. */
async function athenaRequest<T>(
  path: string,
  method: "GET" | "POST" | "PUT",
  params?: Record<string, string>,
  body?: Record<string, string>,
): Promise<T> {
  const token = await getAthenaToken();
  const url = new URL(`${ATHENA_BASE_URL}/${ATHENA_PRACTICE_ID}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.error ?? `athenahealth error ${response.status} on ${method} ${path}`);
  }
  return data as T;
}

/** MM/DD/YYYY, the format athenahealth's scheduling API expects. */
function toAthenaDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

interface OpenSlot {
  appointmentid: string;
  date: string; // MM/DD/YYYY
  starttime: string; // HH:MM
  [key: string]: unknown;
}

/** Searches for open slots for the confirmed working provider/department/reason. */
async function searchOpenSlots(startDate: string, endDate: string): Promise<OpenSlot[]> {
  const result = await athenaRequest<{ appointments?: OpenSlot[] } | OpenSlot[]>(
    "/appointments/open",
    "GET",
    {
      departmentid: ATHENA_DEPARTMENT_ID,
      providerid: ATHENA_PROVIDER_ID,
      reasonid: ATHENA_REASON_ID,
      startdate: toAthenaDate(startDate),
      enddate: toAthenaDate(endDate),
    },
  );
  const slots = Array.isArray(result) ? result : result.appointments ?? [];
  // Sort chronologically so the list reads naturally.
  return slots.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.starttime.localeCompare(b.starttime);
  });
}

async function searchUpcomingAppointments(patientId: string, startDate: string, endDate: string): Promise<Appointment[]> {
  const result = await athenaRequest<{ appointments?: Appointment[] } | Appointment[]>(
    "/appointments/booked",
    "GET",
    {
      departmentid: ATHENA_DEPARTMENT_ID,
      providerid: ATHENA_PROVIDER_ID,
      reasonid: ATHENA_REASON_ID,
      startdate: toAthenaDate(startDate),
      enddate: toAthenaDate(endDate),
      patientid: patientId,
    },
  );
  console.log("Fetched upcoming appointments:", result);
  const slots = Array.isArray(result) ? result : result.appointments ?? [];
  // Sort chronologically so the list reads naturally.
  return slots.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.date + a.time).localeCompare(b.date + b.time);
  });
}

/** Books a specific slot for a patient. */
async function bookSlot(appointmentId: string, patientId: string): Promise<any| null> {
  console.log(`Booking slot ${appointmentId} for patient ${patientId}...`);
  const response = await athenaRequest(`/appointments/${appointmentId}`, "PUT", undefined, {
    patientid: patientId,
    departmentid: ATHENA_DEPARTMENT_ID,
    providerid: ATHENA_PROVIDER_ID,
    reasonid: ATHENA_REASON_ID,
  });
  console.log("Booking response:", response);
  return response ? (Array.isArray(response) ? response[0] : response) : null;
}

function formatSlotLabel(slot: OpenSlot): string {
  const [month, day, year] = slot.date.split("/");
  const parsed = new Date(`${year}-${month}-${day}T00:00:00`);
  const dateLabel = Number.isNaN(parsed.getTime())
    ? slot.date
    : parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${dateLabel} · ${slot.starttime}`;
}

/* ---------------------------------------------------------------------- */

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

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function emptyForm(profile: ReturnType<typeof getOnboardingProfile>) {
  return {
    appointmentType: "Primary care",
    providerName: profile.primaryCareProvider.name,
    location: "Main clinic",
    reason: "Follow up on breathing episodes",
    reminder: "1 day before",
  };
}

export default function ScheduleScreen() {
  const profile = getOnboardingProfile();
  const { patientId } = usePatientRecord();
  const athenaPatientId = '14167'
  const { patient, loading, error, lastSynced } = useAppSelector(state => state.patient);


  const [form, setForm] = useState(() => emptyForm(profile));
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [toastOpacity] = useState(new Animated.Value(0));
  const [booking, setBooking] = useState(false);

  // Slot search state
  const [rangeStart, setRangeStart] = useState(() => todayIsoDate());
  const [rangeEnd, setRangeEnd] = useState(() => addDaysIso(todayIsoDate(), 13));
  const [slots, setSlots] = useState<OpenSlot[]>([]);
  const [searchingSlots, setSearchingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<OpenSlot | null>(null);

  const [editing, setEditing] = useState<Appointment | null>(null);
  const [editForm, setEditForm] = useState(emptyForm(profile));
  const [todayIso] = useState(() => todayIsoDate());

  const reload = useCallback(async () => {
    setUpcoming([]); // clear while loading
    if (patientId) setUpcoming(await searchUpcomingAppointments(athenaPatientId, todayIsoDate(), addDaysIso(todayIsoDate(), 90)));
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

  const handleFindTimes = async () => {
    setSearchingSlots(true);
    setSelectedSlot(null);
    try {
      const results = await searchOpenSlots(rangeStart, rangeEnd);
      setSlots(results);
      if (results.length === 0) {
        Alert.alert("No open times", "No available slots in that date range. Try a wider range.");
      }
    } catch (err) {
      Alert.alert("Couldn't load times", err instanceof Error ? err.message : String(err));
      setSlots([]);
    } finally {
      setSearchingSlots(false);
    }
  };

  const handleSchedule = async () => {
    if (!patientId || !selectedSlot) return;
    setBooking(true);

    try {
      const response = await bookSlot(selectedSlot.appointmentid, athenaPatientId);
      if (response) {
        await dispatchImmediate({
              patientId: patientId,
              scope: 'anomaly',
              title: "Appointment booked",
              body: 'Appointment booked with athenahealth',
              severity: 1,
            });
      }
      const appt = insertAppointment({
        patientId,
        type: form.appointmentType,
        provider: form.providerName,
        date: selectedSlot.date,
        time: selectedSlot.starttime,
        location: form.location,
        reason: form.reason,
        reminder: form.reminder,
        status: "scheduled",
        appointmentid: selectedSlot.date + " " + selectedSlot.starttime + Math.floor(Math.random() * 100), // generate a unique ID for local storage
      });

      audit({
        actor: "caregiver",
        action: "schedule_appointment",
        resourceType: "appointment",
        resourceId: appt.appointmentid,
        patientId,
        payload: { type: appt.type, date: appt.date, athenaAppointmentId: selectedSlot.appointmentid },
      });

      reload();
      // showToast("Appointment booked with athenahealth");
      setForm(emptyForm(profile));
      setSlots([]);
      setSelectedSlot(null);
    } catch (err) {
      Alert.alert("Couldn't book appointment", err instanceof Error ? err.message : String(err));
    } finally {
      setBooking(false);
    }
  };

  const openEdit = (appt: Appointment) => {
    setEditing(appt);
    setEditForm({
      appointmentType: appt.type,
      providerName: appt.provider ?? profile.primaryCareProvider.name,
      location: appt.location ?? "",
      reason: appt.reason ?? "",
      reminder: appt.reminder ?? "1 day before",
    });
  };

  const saveEdit = () => {
    if (!patientId || !editing) return;
    // Editing here only updates local details (location/reason/reminder/type).
    // Changing the actual date/time would require re-picking a slot — use
    // Delete + re-schedule for that, to keep this simple.
    updateAppointment({
      ...editing,
      type: editForm.appointmentType,
      provider: editForm.providerName,
      location: editForm.location,
      reason: editForm.reason,
      reminder: editForm.reminder,
    });

    audit({
      actor: "caregiver",
      action: "edit_appointment",
      resourceType: "appointment",
      resourceId: editing.appointmentid,
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
            deleteAppointment(appt.appointmentid);
            audit({
              actor: "caregiver",
              action: "delete_appointment",
              resourceType: "appointment",
              resourceId: appt.appointmentid,
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
          <MainTabHeader
            title="Schedule"
            eyebrow="Caregiver Concierge"
            subtitle="Create doctor appointments and caregiver reminders."
            rightContent={
              <View style={styles.headerIconCircle}>
                <AppIcon name="calendarPlus" size={30} color={AppTheme.colors.brand} />
              </View>
            }
          />

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
              placeholder="Dr. Adam Bricker"
            />

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
            <Text style={styles.sectionTitle}>Find a time</Text>
            <Text style={styles.helperText}>Search open slots within a date range, then pick one.</Text>

            <View style={styles.twoColumnFields}>
              <Field
                containerStyle={styles.twoColumnField}
                label="From"
                value={rangeStart}
                onChangeText={setRangeStart}
                placeholder="YYYY-MM-DD"
              />
              <Field
                containerStyle={styles.twoColumnField}
                label="To"
                value={rangeEnd}
                onChangeText={setRangeEnd}
                placeholder="YYYY-MM-DD"
              />
            </View>

            <Pressable
              style={[styles.scheduleButton, searchingSlots && styles.scheduleButtonDisabled]}
              onPress={handleFindTimes}
              disabled={searchingSlots}
            >
              <Text style={styles.scheduleButtonText}>
                {searchingSlots ? "Searching…" : "Find available times"}
              </Text>
            </Pressable>

            {slots.length > 0 ? (
              <View style={styles.slotList}>
                {slots.map((slot) => {
                  const selected = selectedSlot?.appointmentid === slot.appointmentid;
                  return (
                    <Pressable
                      key={slot.appointmentid}
                      style={[styles.slotRow, selected && styles.slotRowSelected]}
                      onPress={() => setSelectedSlot(slot)}
                    >
                      <Text style={[styles.slotRowText, selected && styles.slotRowTextSelected]}>
                        {formatSlotLabel(slot)}
                      </Text>
                      {selected ? <AppIcon name="edit" size={14} color={AppTheme.colors.white} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Reminder</Text>

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

            <Pressable
              style={[
                styles.scheduleButton,
                (!selectedSlot || booking) && styles.scheduleButtonDisabled,
              ]}
              onPress={handleSchedule}
              disabled={!selectedSlot || booking}
            >
              <Text style={styles.scheduleButtonText}>
                {booking
                  ? "Booking…"
                  : selectedSlot
                    ? `Book ${formatSlotLabel(selectedSlot)}`
                    : "Pick a time above first"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>APPOINTMENTS</Text>

            {upcoming.length === 0 ? (
              <Text style={styles.emptyText}>No upcoming appointments.</Text>
            ) : (
              upcoming.map((appt) => {
                const statusLabel = appt.date === todayIso ? "TODAY" : "SCHEDULED";
                const dateTimeLabel = formatAppointmentDateTime(appt.date, appt.time);

                return (
                  <View key={appt.appointmentid} style={styles.appointmentCard}>
                    <View style={styles.appointmentAccent} />
                    {/* <Text>Appointment ID: {appt ? appt.appointmentid : "N/A"}</Text> */}
                    <Pressable
                      style={styles.appointmentMain}
                      onPress={() => openEdit(appt)}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${appt.type} appointment on ${appt.date}`}
                    >
                      <View style={styles.appointmentTextBlock}>
                        <View style={styles.appointmentTitleRow}>
                          <Text style={styles.appointmentType}>{appt.type}</Text>
                          <View
                            style={[
                              styles.statusBadge,
                              statusLabel === "TODAY" && styles.statusBadgeToday,
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusBadgeText,
                                statusLabel === "TODAY" && styles.statusBadgeTextToday,
                              ]}
                            >
                              {statusLabel}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.appointmentProvider}>{appt.provider}</Text>
                        <View style={styles.appointmentMetaRow}>
                          <Text
                            style={styles.appointmentClockIcon}
                            accessible={false}
                            importantForAccessibility="no"
                          >
                            🕒
                          </Text>
                          <Text style={styles.appointmentDateTime}>{dateTimeLabel}</Text>
                        </View>
                        <View style={styles.appointmentActions}>
                          <Pressable
                            style={styles.appointmentActionButton}
                            onPress={() => openEdit(appt)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Edit ${appt.type} appointment on ${appt.date}`}
                          >
                            <AppIcon name="edit" size={13} color={AppTheme.colors.brand} />
                            <Text style={styles.editLink}>Edit</Text>
                          </Pressable>
                          <Pressable
                            style={styles.appointmentActionButton}
                            onPress={() => handleDelete(appt)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete ${appt.type} appointment on ${appt.date}`}
                          >
                            <AppIcon name="delete" size={13} color={AppTheme.colors.danger} />
                            <Text style={styles.deleteLink}>Delete</Text>
                          </Pressable>
                        </View>
                      </View>
                    </Pressable>
                  </View>
                );
              })
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

              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.modalLabel}>Type</Text>
                <View style={styles.modalChipRow}>
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
                <Text style={styles.helperText}>
                  To change the date/time, delete this appointment and book a new slot instead.
                </Text>
              </ScrollView>

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
  containerStyle,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.fieldBlock, containerStyle]}>
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
  containerStyle,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.fieldBlock, containerStyle]}>
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

function formatAppointmentDateTime(date: string, time?: string): string {
  // athenahealth-returned dates are MM/DD/YYYY; locally-created ones may be
  // YYYY-MM-DD, so handle both.
  const isoLike = date.includes("/") ? date.split("/").reverse().join("-").replace(/^(\d{2})-(\d{2})-(\d{4})$/, "$3-$1-$2") : date;
  const parsed = new Date(`${isoLike}T00:00:00`);
  const dateLabel = Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });

  return time ? `${dateLabel} at ${time}` : dateLabel;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AppTheme.colors.screen },
  root: { flex: 1, backgroundColor: AppTheme.colors.screen },
  content: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 124 },
  headerIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
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
  fieldBlock: {
    marginBottom: 16,
    width: "100%",
  },
  twoColumnField: {
    flex: 1,
    width: undefined,
  },
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
  twoColumnFields: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  scheduleButton: {
    minHeight: 58,
    borderRadius: 20,
    backgroundColor: AppTheme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  scheduleButtonDisabled: {
    opacity: 0.6,
  },
  scheduleButtonText: {
    color: AppTheme.colors.white,
    fontSize: 16,
    fontWeight: "900",
  },
  slotList: {
    marginTop: 16,
    gap: 8,
  },
  slotRow: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  slotRowSelected: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  slotRowText: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  slotRowTextSelected: {
    color: AppTheme.colors.white,
  },
  emptyText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    paddingVertical: 16,
  },
  appointmentCard: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 12,
    marginBottom: 10,
    ...AppTheme.shadow,
  },
  appointmentAccent: {
    position: "absolute",
    top: 10,
    bottom: 10,
    left: 0,
    width: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: AppTheme.colors.brand,
  },
  appointmentMain: {
    minHeight: 0,
  },
  appointmentTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  appointmentType: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 21,
  },
  appointmentTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  appointmentProvider: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    fontWeight: "800",
    marginTop: 3,
  },
  appointmentMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 7,
  },
  appointmentClockIcon: {
    fontSize: 13,
    lineHeight: 16,
  },
  appointmentDateTime: {
    flex: 1,
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  statusBadge: {
    borderRadius: AppTheme.radius.pill,
    backgroundColor: AppTheme.colors.brandSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusBadgeToday: {
    backgroundColor: AppTheme.colors.warningSoft,
  },
  statusBadgeText: {
    color: AppTheme.colors.brand,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  statusBadgeTextToday: {
    color: AppTheme.colors.warning,
  },
  appointmentActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 7,
  },
  appointmentActionButton: {
    minHeight: 32,
    minWidth: 64,
    borderRadius: 12,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
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
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  modalSheet: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    padding: 20,
    maxHeight: "100%",
    overflow: "hidden",
  },
  modalScroll: {
    flexShrink: 1,
  },
  modalScrollContent: {
    paddingBottom: 4,
  },
  modalTitle: {
    color: AppTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 18,
  },
  modalLabel: {
    color: AppTheme.colors.sectionText,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  modalChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 18,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
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