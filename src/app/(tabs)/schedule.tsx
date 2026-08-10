import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
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
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/hooks/use-translation";
import type { AppLocale, TranslateFn } from "@/localization/i18n";
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

function formatTimeForDisplay(time24: string, locale: AppLocale): string {
  const match = time24.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return time24;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return time24;
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
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
  const slots = Array.isArray(result) ? result : result.appointments ?? [];
  return slots.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.date + a.time).localeCompare(b.date + b.time);
  });
}

/** Books a specific slot for a patient. */
async function bookSlot(appointmentId: string, patientId: string): Promise<any | null> {
  const response = await athenaRequest(`/appointments/${appointmentId}`, "PUT", undefined, {
    patientid: patientId,
    departmentid: ATHENA_DEPARTMENT_ID,
    providerid: ATHENA_PROVIDER_ID,
    reasonid: ATHENA_REASON_ID,
  });
  return response ? (Array.isArray(response) ? response[0] : response) : null;
}

/** Cancels a booked appointment on athenahealth. */
async function cancelAthenaAppointment(appointmentId: string, reason?: string): Promise<void> {
  await athenaRequest(`/appointments/${appointmentId}/cancel`, "PUT", undefined, {
    departmentid: ATHENA_DEPARTMENT_ID,
    cancellationreason: reason ?? "Canceled by caregiver app",
  });
}

function formatDateLabel(date: string, locale: AppLocale): string {
  const parsed = new Date(`${normalizeAppointmentDate(date)}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(locale, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
}

function formatSlotLabel(slot: OpenSlot, locale: AppLocale): string {
  return `${formatDateLabel(slot.date, locale)} · ${formatTimeForDisplay(slot.starttime, locale)}`;
}

/* ---------------------------------------------------------------------- */

const appointmentTypes = [
  "Primary care",
];

function formatAppointmentTypeLabel(type: string, t: TranslateFn): string {
  return type === "Primary care" ? t("schedule.appointmentType.primaryCare") : type;
}

function formatAppointmentDisplayType(appt: Appointment, t: TranslateFn): string {
  return appt.patientappointmenttypename?.trim() || formatAppointmentTypeLabel(appt.type, t);
}

const reminderOptions = [
  "15 min before",
  "1 hour before",
  "1 day before",
  "1 week before",
];

function formatReminderOptionLabel(option: string, t: TranslateFn): string {
  switch (option) {
    case "15 min before":
      return t("schedule.reminder.15min");
    case "1 hour before":
      return t("schedule.reminder.1hour");
    case "1 day before":
      return t("schedule.reminder.1day");
    case "1 week before":
      return t("schedule.reminder.1week");
    default:
      return option;
  }
}

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
  const theme = useTheme();
  const { locale, t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const isDark = theme.appBackground === "#000000";
  const actionAccent = isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand;
  const dangerAccent = isDark ? AppTheme.colors.dangerLight : AppTheme.colors.danger;
  const profile = getOnboardingProfile();
  const { patientId } = usePatientRecord();
  // let athenaPatientId = '-1';
  const { patient, loading, error, lastSynced } = useAppSelector(state => state.patient);
  const [athenaPatientId, setAthenaPatientId] = useState<string>('-1');
  const latestReloadPatientIdRef = useRef<string>('-1');
  const [form, setForm] = useState(() => emptyForm(profile));
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [appointmentLoadError, setAppointmentLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastOpacity] = useState(new Animated.Value(0));
  const [booking, setBooking] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [isCreateAppointmentVisible, setIsCreateAppointmentVisible] = useState(false);
  const [isAppointmentDetailsOpen, setIsAppointmentDetailsOpen] = useState(false);
  const [isReminderOpen, setIsReminderOpen] = useState(false);

  // Slot search state
  const [rangeStart, setRangeStart] = useState(() => todayIsoDate());
  const [rangeEnd, setRangeEnd] = useState(() => addDaysIso(todayIsoDate(), 13));
  const [slots, setSlots] = useState<OpenSlot[]>([]);
  const [searchingSlots, setSearchingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<OpenSlot | null>(null);

  const [editing, setEditing] = useState<Appointment | null>(null);
  const [editForm, setEditForm] = useState(emptyForm(profile));
  const [todayIso] = useState(() => todayIsoDate());
  const sortedUpcoming = [...upcoming].sort(compareAppointmentsByDateTime);
  const todayStartMs = new Date(`${todayIso}T00:00:00`).getTime();
  const nextAppointment =
    sortedUpcoming.find((appt) => {
      const appointmentMs = appointmentDateTimeMs(appt);
      return Number.isFinite(appointmentMs) && appointmentMs >= todayStartMs;
    }) ?? sortedUpcoming[0];

  const reload = useCallback(async () => {
    setUpcoming([]); // clear while loading
    setAppointmentLoadError(null);

    const patientRecord = patient?.entry?.filter((entry: any) => entry && entry.resource && entry.resource.resourceType === "Patient");
    const nextAthenaPatientId = patientRecord?.[0]?.resource?.id ?? '-1';
    setAthenaPatientId(nextAthenaPatientId);
    latestReloadPatientIdRef.current = nextAthenaPatientId;
    if (nextAthenaPatientId === '-1') {
      return;
    }

    try {
      const nextUpcoming = await searchUpcomingAppointments(nextAthenaPatientId, todayIsoDate(), addDaysIso(todayIsoDate(), 90));
      if (latestReloadPatientIdRef.current !== nextAthenaPatientId) return;
      setUpcoming(nextUpcoming);
    } catch (err) {
      if (latestReloadPatientIdRef.current !== nextAthenaPatientId) return;
      console.error("Failed to load Athena appointments", err);
      setUpcoming([]);
      setAppointmentLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [patient]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

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
        Alert.alert(t("schedule.alert.noOpenTimes.title"), t("schedule.alert.noOpenTimes.body"));
      }
    } catch (err) {
      Alert.alert(t("schedule.alert.loadTimesFailed"), err instanceof Error ? err.message : String(err));
      setSlots([]);
    } finally {
      setSearchingSlots(false);
    }
  };

  const handleSchedule = async () => {
    if (!patientId || !selectedSlot) return;
    setBooking(true);

    try {
      await dispatchImmediate({
          patientId: patientId,
          scope: 'anomaly',
          title: t("schedule.notification.requested.title"),
          body: t("schedule.notification.requested.body"),
          severity: 1,
        });
      const response = await bookSlot(selectedSlot.appointmentid, athenaPatientId);
      if (response) {
        await dispatchImmediate({
          patientId: patientId,
          scope: 'anomaly',
          title: t("schedule.notification.booked.title"),
          body: t("schedule.notification.booked.body"),
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
        appointmentid: selectedSlot.date + " " + selectedSlot.starttime + Math.floor(Math.random() * 100),
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
      setForm(emptyForm(profile));
      setSlots([]);
      setSelectedSlot(null);
    } catch (err) {
      Alert.alert(t("schedule.alert.bookFailed"), err instanceof Error ? err.message : String(err));
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
    const appointmentId = appt.appointmentid ?? appt.appointmentId;
    const appointmentType = formatAppointmentDisplayType(appt, t);
    Alert.alert(
      t("schedule.deleteDialog.title"),
      t("schedule.deleteDialog.body", {
        type: appointmentType,
        date: formatDateLabel(appt.date, locale),
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            setCancelingId(appointmentId);
            try {
              await cancelAthenaAppointment(appointmentId);
            } catch (err) {
              Alert.alert(
                t("schedule.alert.cancelAthenaFailed.title"),
                t("schedule.alert.cancelAthenaFailed.body", {
                  error: err instanceof Error ? err.message : String(err),
                }),
              );
            }
            deleteAppointment(appointmentId);
            audit({
              actor: "caregiver",
              action: "delete_appointment",
              resourceType: "appointment",
              resourceId: appointmentId,
              patientId,
            });
            setCancelingId(null);
            reload();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, themedStyles.screen]} edges={["top"]}>
      <View style={[styles.root, themedStyles.screen]}>
        <ScrollView
          style={themedStyles.screen}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, themedStyles.screen]}
          keyboardShouldPersistTaps="handled"
        >
          <MainTabHeader
            title={t("schedule.header.title")}
            eyebrow={t("schedule.header.eyebrow")}
            subtitle={t("schedule.header.subtitle")}
            icon="schedule"
          />

          <View style={[styles.nextAppointmentCard, themedStyles.nextAppointmentCard]}>
            <View style={[styles.nextAppointmentMarker, themedStyles.heroSoftSurface]}>
              <Text style={[styles.nextAppointmentMarkerText, themedStyles.heroStrongText]}>01</Text>
            </View>

            <View style={styles.nextAppointmentTextBlock}>
              <Text style={[styles.nextAppointmentLabel, themedStyles.heroLabelText]}>
                {t("schedule.next.label")}
              </Text>
              <Text style={[styles.nextAppointmentTitle, themedStyles.heroStrongText]}>
                {nextAppointment
                  ? formatAppointmentTypeLabel(nextAppointment.type, t)
                  : t("schedule.appointmentType.primaryCare")}
              </Text>
              <Text style={[styles.nextAppointmentTime, themedStyles.heroSupportingText]}>
                {nextAppointment
                  ? formatAppointmentDateTime(
                      nextAppointment.date,
                      getAppointmentTime(nextAppointment),
                      locale,
                      t,
                    )
                  : t("schedule.next.empty")}
              </Text>
            </View>

            <View style={[styles.nextAppointmentBadge, themedStyles.heroSoftSurface]}>
              <Text style={[styles.nextAppointmentBadgeText, themedStyles.heroStrongText]}>
                {t("schedule.status.scheduledNext")}
              </Text>
            </View>
          </View>

          <View style={[styles.card, themedStyles.card]}>
            <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>
              {t("schedule.section.scheduledAppointments")}
            </Text>

            {appointmentLoadError ? (
              <Text style={[styles.emptyText, themedStyles.secondaryText]}>
                {t("schedule.error.appointmentsUnavailable")}
              </Text>
            ) : sortedUpcoming.length === 0 ? (
              <Text style={[styles.emptyText, themedStyles.secondaryText]}>
                {t("schedule.empty.noUpcoming")}
              </Text>
            ) : (
              sortedUpcoming.map((appt) => {
                const isToday = appt.date === todayIso;
                const statusLabel = isToday
                  ? t("schedule.status.today")
                  : t("schedule.status.scheduled");
                const appointmentType = formatAppointmentTypeLabel(appt.type, t);
                const appointmentDisplayType = formatAppointmentDisplayType(appt, t);
                const appointmentDateLabel = formatDateLabel(appt.date, locale);
                const dateTimeLabel = formatAppointmentDateTime(
                  appt.date,
                  getAppointmentTime(appt),
                  locale,
                  t,
                );
                const isCanceling = cancelingId === appt.appointmentid;

                return (
                  <View key={appt.appointmentid} style={[styles.appointmentCard, themedStyles.card]}>
                    <View style={styles.appointmentAccent} />

                    <Pressable
                      style={styles.appointmentMain}
                      onPress={() => openEdit(appt)}
                      accessibilityRole="button"
                      accessibilityLabel={t("schedule.action.editA11y", {
                        type: appointmentDisplayType,
                        date: appointmentDateLabel,
                      })}
                    >
                      <View style={styles.appointmentTextBlock}>
                        <View style={styles.appointmentTitleRow}>
                          <Text style={[styles.appointmentType, themedStyles.primaryText]} numberOfLines={1}>
                            {appointmentType}
                          </Text>
                          <View
                            style={[
                              styles.statusBadge,
                              themedStyles.statusBadge,
                              isToday && styles.statusBadgeToday,
                              isToday && themedStyles.statusBadgeToday,
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusBadgeText,
                                themedStyles.statusBadgeText,
                                isToday && styles.statusBadgeTextToday,
                                isToday && themedStyles.statusBadgeTextToday,
                              ]}
                            >
                              {statusLabel}
                            </Text>
                          </View>
                          <View>
                            <Text style={[styles.appointmentType, themedStyles.primaryText]}>
                              {appt.patientappointmenttypename ? ` ${appt.patientappointmenttypename}` : ""}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.appointmentProvider, themedStyles.secondaryText]} numberOfLines={1}>
                          {appt.provider}
                        </Text>
                        <View style={styles.appointmentMetaRow}>
                          <Text
                            style={styles.appointmentClockIcon}
                            accessible={false}
                            importantForAccessibility="no"
                          >
                            🕒
                          </Text>
                          <Text style={[styles.appointmentDateTime, themedStyles.mutedText]} numberOfLines={1}>
                            {dateTimeLabel}
                          </Text>
                        </View>
                        <View style={styles.appointmentActions}>
                          <Pressable
                            style={[styles.appointmentActionButton, themedStyles.controlSurface]}
                            onPress={() => openEdit(appt)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={t("schedule.action.editA11y", {
                              type: appointmentDisplayType,
                              date: appointmentDateLabel,
                            })}
                          >
                            <AppIcon name="edit" size={13} color={actionAccent} />
                            <Text style={[styles.editLink, themedStyles.actionText]}>
                              {t("schedule.action.edit")}
                            </Text>
                          </Pressable>
                          <Pressable
                            style={[
                              styles.appointmentActionButton,
                              themedStyles.controlSurface,
                              isCanceling && styles.appointmentActionButtonDisabled,
                            ]}
                            onPress={() => handleDelete(appt)}
                            hitSlop={8}
                            disabled={isCanceling}
                            accessibilityRole="button"
                            accessibilityLabel={t("schedule.action.deleteA11y", {
                              type: appointmentDisplayType,
                              date: appointmentDateLabel,
                            })}
                          >
                            <AppIcon name="delete" size={13} color={dangerAccent} />
                            <Text style={[styles.deleteLink, themedStyles.dangerText]}>
                              {isCanceling
                                ? t("schedule.action.canceling")
                                : t("schedule.action.delete")}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    </Pressable>
                  </View>
                );
              })
            )}
          </View>

          <Pressable
            style={[styles.createAppointmentButton, themedStyles.card]}
            onPress={() => setIsCreateAppointmentVisible((visible) => !visible)}
            accessibilityRole="button"
            accessibilityState={{ expanded: isCreateAppointmentVisible }}
            accessibilityLabel={t("schedule.action.createAppointmentA11y")}
          >
            <Text style={[styles.createAppointmentButtonText, themedStyles.actionText]}>
              {t("schedule.action.createAppointment")}
            </Text>
          </Pressable>

          {isCreateAppointmentVisible ? (
            <View style={[styles.card, themedStyles.card]}>
              <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>
                {t("schedule.section.createAppointment")}
              </Text>

              <Pressable
                style={[styles.collapseRow, themedStyles.controlSurface]}
                onPress={() => setIsAppointmentDetailsOpen((open) => !open)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isAppointmentDetailsOpen }}
                accessibilityLabel={t("schedule.section.appointmentDetails")}
              >
                <Text style={[styles.collapseRowText, themedStyles.actionText]}>
                  {t("schedule.section.appointmentDetails")}
                </Text>
                <AppIcon
                  name="chevronRight"
                  size={22}
                  color={actionAccent}
                />
              </Pressable>

              {isAppointmentDetailsOpen ? (
                <View style={[styles.collapsibleContent, themedStyles.collapsibleContent]}>
                  <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>
                    {t("schedule.section.appointmentType")}
                  </Text>

                  <View style={styles.chipRow}>
                    {appointmentTypes.map((type) => {
                      const selected = form.appointmentType === type;
                      return (
                        <Pressable
                          key={type}
                          style={[styles.chip, themedStyles.chip, selected && styles.chipSelected]}
                          onPress={() => setForm({ ...form, appointmentType: type })}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                        >
                          <Text style={[styles.chipText, themedStyles.secondaryText, selected && styles.chipTextSelected]}>
                            {formatAppointmentTypeLabel(type, t)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Field
                    label={t("schedule.field.provider")}
                    value={form.providerName}
                    onChangeText={(v) => setForm({ ...form, providerName: v })}
                    placeholder={t("schedule.placeholder.provider")}
                  />

                  <Field
                    label={t("schedule.field.location")}
                    value={form.location}
                    onChangeText={(v) => setForm({ ...form, location: v })}
                    placeholder={t("schedule.placeholder.location")}
                  />

                  <LargeField
                    label={t("schedule.field.reasonForVisit")}
                    value={form.reason}
                    onChangeText={(v) => setForm({ ...form, reason: v })}
                    placeholder={t("schedule.placeholder.reasonForVisit")}
                  />

                  <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>
                    {t("schedule.section.findTime")}
                  </Text>
                  <Text style={[styles.helperText, themedStyles.secondaryText]}>
                    {t("schedule.helper.findTime")}
                  </Text>

                  <View style={styles.twoColumnFields}>
                    <Field
                      containerStyle={styles.twoColumnField}
                      label={t("schedule.field.from")}
                      value={rangeStart}
                      onChangeText={setRangeStart}
                      placeholder={t("schedule.placeholder.date")}
                    />
                    <Field
                      containerStyle={styles.twoColumnField}
                      label={t("schedule.field.to")}
                      value={rangeEnd}
                      onChangeText={setRangeEnd}
                      placeholder={t("schedule.placeholder.date")}
                    />
                  </View>

                  <Pressable
                    style={[styles.scheduleButton, searchingSlots && styles.scheduleButtonDisabled]}
                    onPress={handleFindTimes}
                    disabled={searchingSlots}
                    accessibilityRole="button"
                    accessibilityLabel={t("schedule.action.findAvailableTimesA11y")}
                  >
                    <Text style={styles.scheduleButtonText}>
                      {searchingSlots
                        ? t("schedule.action.searching")
                        : t("schedule.action.findAvailableTimes")}
                    </Text>
                  </Pressable>

                  {slots.length > 0 ? (
                    <View style={styles.slotList}>
                      {slots.map((slot) => {
                        const selected = selectedSlot?.appointmentid === slot.appointmentid;
                        return (
                          <Pressable
                            key={slot.appointmentid}
                            style={[styles.slotRow, themedStyles.controlSurface, selected && styles.slotRowSelected]}
                            onPress={() => setSelectedSlot(slot)}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            accessibilityLabel={t("schedule.slots.selectA11y", {
                              slot: formatSlotLabel(slot, locale),
                            })}
                          >
                            <Text style={[styles.slotRowText, themedStyles.primaryText, selected && styles.slotRowTextSelected]}>
                              {formatSlotLabel(slot, locale)}
                            </Text>
                            {selected ? <AppIcon name="edit" size={14} color={AppTheme.colors.white} /> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              ) : null}

              <Pressable
                style={[styles.collapseRow, themedStyles.controlSurface]}
                onPress={() => setIsReminderOpen((open) => !open)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isReminderOpen }}
                accessibilityLabel={t("schedule.section.reminder")}
              >
                <Text style={[styles.collapseRowText, themedStyles.actionText]}>
                  {t("schedule.section.reminder")}
                </Text>
                <AppIcon
                  name="chevronRight"
                  size={22}
                  color={actionAccent}
                />
              </Pressable>

              {isReminderOpen ? (
                <View style={[styles.collapsibleContent, themedStyles.collapsibleContent]}>
                  <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>
                    {t("schedule.section.reminder")}
                  </Text>

                  <View style={styles.chipRow}>
                    {reminderOptions.map((option) => {
                      const selected = form.reminder === option;
                      const optionLabel = formatReminderOptionLabel(option, t);
                      return (
                        <Pressable
                          key={option}
                          style={[styles.chip, themedStyles.chip, selected && styles.chipSelected]}
                          onPress={() => setForm({ ...form, reminder: option })}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          accessibilityLabel={optionLabel}
                        >
                          <Text style={[styles.chipText, themedStyles.secondaryText, selected && styles.chipTextSelected]}>
                            {optionLabel}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <Pressable
                style={[
                  styles.scheduleButton,
                  (!selectedSlot || booking) && styles.scheduleButtonDisabled,
                ]}
                onPress={handleSchedule}
                disabled={!selectedSlot || booking}
                accessibilityRole="button"
                accessibilityLabel={t("schedule.action.bookAppointmentA11y")}
              >
                <Text style={styles.scheduleButtonText}>
                  {booking
                    ? t("schedule.action.booking")
                    : selectedSlot
                      ? t("schedule.action.bookSlot", {
                          slot: formatSlotLabel(selectedSlot, locale),
                        })
                      : t("schedule.action.pickTime")}
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.scheduleButton
                ]}
                onPress={reload}
                accessibilityRole="button"
                accessibilityLabel={t("schedule.action.reloadAppointmentsA11y")}
              >
                <Text style={styles.scheduleButtonText}>
                  {t("schedule.action.reloadAppointments")}
                </Text>
              </Pressable>
            </View>
          ) : null}
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
          <View style={[styles.modalOverlay, themedStyles.modalOverlay]}>
            <View style={[styles.modalSheet, themedStyles.modalSheet]}>
              <Text style={[styles.modalTitle, themedStyles.primaryText]}>
                {t("schedule.modal.editTitle")}
              </Text>

              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={[styles.modalLabel, themedStyles.sectionTitle]}>
                  {t("schedule.modal.type")}
                </Text>
                <View style={styles.modalChipRow}>
                  {appointmentTypes.map((type) => {
                    const selected = editForm.appointmentType === type;
                    return (
                      <Pressable
                        key={type}
                        style={[styles.chip, themedStyles.chip, selected && styles.chipSelected]}
                        onPress={() => setEditForm({ ...editForm, appointmentType: type })}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, themedStyles.secondaryText, selected && styles.chipTextSelected]}>
                          {formatAppointmentTypeLabel(type, t)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Field
                  label={t("schedule.field.provider")}
                  value={editForm.providerName}
                  onChangeText={(v) => setEditForm({ ...editForm, providerName: v })}
                  placeholder={t("schedule.placeholder.providerShort")}
                />
                <Field
                  label={t("schedule.field.location")}
                  value={editForm.location}
                  onChangeText={(v) => setEditForm({ ...editForm, location: v })}
                  placeholder={t("schedule.placeholder.location")}
                />
                <LargeField
                  label={t("schedule.field.reason")}
                  value={editForm.reason}
                  onChangeText={(v) => setEditForm({ ...editForm, reason: v })}
                  placeholder={t("schedule.placeholder.reason")}
                />
                <Text style={[styles.helperText, themedStyles.secondaryText]}>
                  {t("schedule.modal.helper")}
                </Text>
              </ScrollView>

              <View style={[styles.modalActions, themedStyles.modalActions]}>
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
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  return (
    <View style={[styles.fieldBlock, containerStyle]}>
      <Text style={[styles.fieldLabel, themedStyles.primaryText]}>{label}</Text>
      <TextInput
        style={[styles.input, themedStyles.input]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.appTextMuted}
        accessibilityLabel={label}
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
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  return (
    <View style={[styles.fieldBlock, containerStyle]}>
      <Text style={[styles.fieldLabel, themedStyles.primaryText]}>{label}</Text>
      <TextInput
        style={[styles.input, styles.largeInput, themedStyles.input]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.appTextMuted}
        accessibilityLabel={label}
        multiline
        textAlignVertical="top"
      />
    </View>
  );
}

function formatAppointmentDateTime(
  date: string,
  time: string | undefined,
  locale: AppLocale,
  t: TranslateFn,
): string {
  const dateLabel = formatDateLabel(date, locale);
  return time
    ? t("schedule.dateTimeAt", {
        date: dateLabel,
        time: formatTimeForDisplay(time, locale),
      })
    : dateLabel;
}

function getAppointmentTime(appt: Appointment): string | undefined {
  return appt.starttime ?? appt.time;
}

function normalizeAppointmentDate(date: string): string {
  if (!date.includes("/")) return date;
  return date.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (_match, month, day, year) => {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  });
}

function normalizeAppointmentTime(time?: string): string {
  const match = time?.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "00:00:00";
  return `${match[1].padStart(2, "0")}:${match[2]}:00`;
}

function appointmentDateTimeMs(appt: Appointment): number {
  const parsed = new Date(
    `${normalizeAppointmentDate(appt.date)}T${normalizeAppointmentTime(getAppointmentTime(appt))}`,
  );
  return parsed.getTime();
}

function compareAppointmentsByDateTime(a: Appointment, b: Appointment): number {
  const aMs = appointmentDateTimeMs(a);
  const bMs = appointmentDateTimeMs(b);
  if (Number.isNaN(aMs) && Number.isNaN(bMs)) {
    return (a.appointmentid ?? a.appointmentId).localeCompare(b.appointmentid ?? b.appointmentId);
  }
  if (Number.isNaN(aMs)) return 1;
  if (Number.isNaN(bMs)) return -1;
  return aMs - bMs;
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
    controlSurface: {
      backgroundColor: theme.appControlSurface,
      borderColor: theme.appBorder,
    },
    nextAppointmentCard: {
      backgroundColor: isDark ? theme.appSurface : AppTheme.colors.brand,
      ...(isDark
        ? {
            borderColor: theme.appBorder,
            borderWidth: 1,
          }
        : null),
    },
    heroSoftSurface: {
      backgroundColor: isDark ? theme.appControlSurface : "rgba(255,255,255,0.2)",
    },
    heroStrongText: {
      color: isDark ? theme.appText : AppTheme.colors.white,
    },
    heroLabelText: {
      color: isDark ? theme.appSectionText : AppTheme.colors.white,
    },
    heroSupportingText: {
      color: isDark ? theme.appTextSupporting : AppTheme.colors.white,
    },
    sectionTitle: {
      color: theme.appSectionText,
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
    actionText: {
      color: isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand,
    },
    dangerText: {
      color: isDark ? AppTheme.colors.dangerLight : AppTheme.colors.danger,
    },
    statusBadge: {
      backgroundColor: theme.appBrandSoftSurface,
    },
    statusBadgeToday: {
      backgroundColor: isDark ? "rgba(249, 115, 22, 0.12)" : AppTheme.colors.warningSoft,
    },
    statusBadgeText: {
      color: isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand,
    },
    statusBadgeTextToday: {
      color: AppTheme.colors.warning,
    },
    chip: {
      backgroundColor: theme.appControlSurface,
      borderColor: theme.appBorder,
    },
    collapsibleContent: {
      borderBottomColor: theme.appBorder,
    },
    input: {
      backgroundColor: theme.appInputBackground,
      borderColor: theme.appBorder,
      color: theme.appText,
    },
    modalOverlay: {
      backgroundColor: isDark ? "rgba(0,0,0,0.72)" : "rgba(0,0,0,0.5)",
    },
    modalSheet: {
      backgroundColor: theme.appSurface,
    },
    modalActions: {
      borderTopColor: theme.appBorder,
    },
    modalCancel: {
      backgroundColor: theme.appControlSurface,
    },
  });
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AppTheme.colors.screen },
  root: { flex: 1, backgroundColor: AppTheme.colors.screen },
  content: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 124 },
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
  nextAppointmentCard: {
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 22,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  nextAppointmentMarker: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  nextAppointmentMarkerText: {
    color: AppTheme.colors.white,
    fontSize: 16,
    fontWeight: "900",
  },
  nextAppointmentTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  nextAppointmentLabel: {
    color: AppTheme.colors.white,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    opacity: 0.9,
    marginBottom: 4,
  },
  nextAppointmentTitle: {
    color: AppTheme.colors.white,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
  },
  nextAppointmentTime: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 5,
  },
  nextAppointmentBadge: {
    flexShrink: 0,
    borderRadius: AppTheme.radius.pill,
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 12,
  },
  nextAppointmentBadgeText: {
    color: AppTheme.colors.white,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
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
  createAppointmentButton: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    ...AppTheme.shadow,
  },
  createAppointmentButtonText: {
    color: AppTheme.colors.brand,
    fontSize: 15,
    fontWeight: "900",
  },
  collapseRow: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  collapseRowText: {
    color: AppTheme.colors.brand,
    fontSize: 15,
    fontWeight: "900",
  },
  collapsibleContent: {
    borderBottomWidth: 1,
    borderBottomColor: AppTheme.colors.border,
    marginBottom: 12,
    paddingBottom: 16,
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
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    paddingVertical: 14,
    paddingLeft: 12,
    paddingRight: 14,
    marginBottom: 10,
    ...AppTheme.shadow,
  },
  appointmentAccent: {
    width: 4,
    borderRadius: 4,
    backgroundColor: AppTheme.colors.brand,
    marginRight: 12,
    alignSelf: "stretch",
  },
  appointmentMain: {
    flex: 1,
    minWidth: 0,
  },
  appointmentTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  appointmentType: {
    flexShrink: 1,
    color: AppTheme.colors.text,
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 21,
    marginRight: 8,
  },
  appointmentTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
    flexShrink: 0,
    alignSelf: "flex-start",
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
    gap: 8,
    marginTop: 10,
  },
  appointmentActionButton: {
    flex: 1,
    minHeight: 34,
    borderRadius: 12,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  appointmentActionButtonDisabled: {
    opacity: 0.5,
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
