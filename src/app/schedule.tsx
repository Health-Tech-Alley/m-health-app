import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
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

export default function ScheduleScreen() {
  const router = useRouter();
  const profile = getOnboardingProfile();

  const [appointmentType, setAppointmentType] = useState("Primary care");
  const [providerName, setProviderName] = useState(
    profile.primaryCareProvider.name,
  );
  const [date, setDate] = useState("2026-06-20");
  const [time, setTime] = useState("10:30 AM");
  const [location, setLocation] = useState("Main clinic");
  const [reason, setReason] = useState("Follow up on breathing episodes");
  const [reminder, setReminder] = useState("1 day before");
  const [scheduled, setScheduled] = useState(false);

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
              <AppIcon
                name="calendarPlus"
                size={30}
                color={AppTheme.colors.brand}
              />
            </View>
          </View>

          {scheduled ? (
            <View style={styles.successCard}>
              <View style={styles.successIconCircle}>
                <AppIcon name="check" size={22} color={AppTheme.colors.white} />
              </View>

              <View style={styles.successTextBlock}>
                <Text style={styles.successTitle}>Appointment scheduled</Text>
                <Text style={styles.successText}>
                  Reminder set for {reminder}. For this demo, the reminder is
                  shown inside the app.
                </Text>
              </View>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Appointment type</Text>

            <View style={styles.chipRow}>
              {appointmentTypes.map((type) => {
                const selected = appointmentType === type;

                return (
                  <Pressable
                    key={type}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setAppointmentType(type)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected && styles.chipTextSelected,
                      ]}
                    >
                      {type}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Field
              label="Provider"
              value={providerName}
              onChangeText={setProviderName}
              placeholder="Dr. Smith"
            />

            <View style={styles.twoColumnFields}>
              <Field
                label="Date"
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
              />

              <Field
                label="Time"
                value={time}
                onChangeText={setTime}
                placeholder="10:30 AM"
              />
            </View>

            <Field
              label="Location"
              value={location}
              onChangeText={setLocation}
              placeholder="Clinic name or address"
            />

            <LargeField
              label="Reason for visit"
              value={reason}
              onChangeText={setReason}
              placeholder="What should the provider review?"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Reminder</Text>
            <Text style={styles.helperText}>
              Choose when the caregiver should be reminded before the
              appointment.
            </Text>

            <View style={styles.chipRow}>
              {reminderOptions.map((option) => {
                const selected = reminder === option;

                return (
                  <Pressable
                    key={option}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setReminder(option)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected && styles.chipTextSelected,
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={styles.scheduleButton}
              onPress={() => setScheduled(true)}
            >
              <Text style={styles.scheduleButtonText}>
                Schedule appointment
              </Text>
            </Pressable>

            <Text style={styles.reminderNote}>
              Phone notification delivery can connect to native notifications
              later. This screen prepares the appointment and reminder flow now.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Upcoming</Text>

            <AppointmentRow
              type="Medication review"
              provider={profile.primaryCareProvider.name}
              date="Tomorrow"
              time="8:00 PM"
            />

            <AppointmentRow
              type={appointmentType}
              provider={providerName}
              date={scheduled ? date : "Not scheduled yet"}
              time={scheduled ? time : "Choose appointment details above"}
            />
          </View>
        </ScrollView>

        <View style={styles.bottomNav}>
          <BottomNavItem
            label="Home"
            icon="home"
            onPress={() => router.push("/dashboard")}
          />

          <BottomNavItem
            label="Care"
            icon="care"
            alert
            onPress={() => router.push("/care")}
          />

          <BottomNavItem
            label="Meds"
            icon="pill"
            onPress={() => router.push("/medications")}
          />

          <BottomNavItem
            label="Schedule"
            icon="schedule"
            active
            onPress={() => {}}
          />

          <BottomNavItem
            label="Assistant"
            icon="assistant"
            onPress={() => router.push("/slm")}
          />

          <BottomNavItem
            label="More"
            icon="more"
            onPress={() => router.push("/more")}
          />
        </View>
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

function AppointmentRow({
  type,
  provider,
  date,
  time,
}: {
  type: string;
  provider: string;
  date: string;
  time: string;
}) {
  return (
    <View style={styles.appointmentRow}>
      <View style={styles.appointmentIconCircle}>
        <AppIcon name="doctor" size={22} color={AppTheme.colors.brand} />
      </View>

      <View style={styles.appointmentTextBlock}>
        <Text style={styles.appointmentType}>{type}</Text>
        <Text style={styles.appointmentProvider}>{provider}</Text>
      </View>

      <View style={styles.appointmentTimeBlock}>
        <Text style={styles.appointmentDate}>{date}</Text>
        <Text style={styles.appointmentTime}>{time}</Text>
      </View>
    </View>
  );
}

function BottomNavItem({
  label,
  icon,
  active,
  alert,
  onPress,
}: {
  label: string;
  icon: AppIconName;
  active?: boolean;
  alert?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.navItem} onPress={onPress}>
      <View style={[styles.navIconCircle, active && styles.navIconCircleActive]}>
        <AppIcon
          name={icon}
          size={active ? 30 : 26}
          color={active ? AppTheme.colors.white : AppTheme.colors.navMuted}
        />

        {alert ? <View style={styles.navAlertDot} /> : null}
      </View>

      <Text style={[styles.navLabel, active && styles.navLabelActive]}>
        {label}
      </Text>
    </Pressable>
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
    paddingTop: 24,
    paddingBottom: 124,
  },
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
  successCard: {
    backgroundColor: AppTheme.colors.brand,
    borderRadius: AppTheme.radius.card,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  successIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },
  successTextBlock: {
    flex: 1,
  },
  successTitle: {
    color: AppTheme.colors.white,
    fontSize: 17,
    fontWeight: "900",
  },
  successText: {
    color: AppTheme.colors.white,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: 4,
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
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
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
  chipText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "900",
  },
  chipTextSelected: {
    color: AppTheme.colors.white,
  },
  fieldBlock: {
    flex: 1,
    marginBottom: 14,
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
  largeInput: {
    minHeight: 102,
    textAlignVertical: "top",
  },
  twoColumnFields: {
    flexDirection: "row",
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
  scheduleButtonText: {
    color: AppTheme.colors.white,
    fontSize: 16,
    fontWeight: "900",
  },
  reminderNote: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: 14,
  },
  appointmentRow: {
    minHeight: 76,
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
  appointmentTextBlock: {
    flex: 1,
  },
  appointmentType: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  appointmentProvider: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 3,
  },
  appointmentTimeBlock: {
    alignItems: "flex-end",
  },
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

  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 92,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.white,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  navItem: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 50,
  },
  navIconCircle: {
    width: 48,
    height: 38,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  navIconCircleActive: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: AppTheme.colors.brand,
  },
  navAlertDot: {
    position: "absolute",
    right: 3,
    top: -3,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: AppTheme.colors.danger,
  },
  navLabel: {
    color: AppTheme.colors.navMuted,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 5,
  },
  navLabelActive: {
    color: AppTheme.colors.brand,
  },
});