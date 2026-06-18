import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import { getOnboardingProfile } from "@/services/onboarding/onboardingService";

type MedicationStatus = "pending" | "confirmed" | "missed";

type Medication = {
  id: string;
  name: string;
  dose: string;
  instructions: string;
  timeLabel: string;
  status: MedicationStatus;
  accent: string;
};

const initialMedications: Medication[] = [
  {
    id: "albuterol",
    name: "Albuterol",
    dose: "2 puffs",
    instructions: "As needed / PRN",
    timeLabel: "Tonight · 8:00 PM",
    status: "pending",
    accent: "#F5B800",
  },
  {
    id: "tiotropium",
    name: "Tiotropium",
    dose: "1 capsule inhaled",
    instructions: "Once daily",
    timeLabel: "Tomorrow · 9:00 AM",
    status: "confirmed",
    accent: AppTheme.colors.brand,
  },
  {
    id: "prednisone",
    name: "Prednisone",
    dose: "10 mg",
    instructions: "Once daily",
    timeLabel: "Missed · 8:00 AM",
    status: "missed",
    accent: AppTheme.colors.danger,
  },
];

export default function MedicationsScreen() {
  const router = useRouter();
  const profile = getOnboardingProfile();

  const patientFirstName =
    profile.patient.name.trim().split(/\s+/)[0] || "Patient";

  const [medications, setMedications] = useState(initialMedications);

  const nextDueMedication =
    medications.find((medication) => medication.status === "pending") ??
    medications[0];

  function markMedicationGiven(id: string) {
    setMedications((current) =>
      current.map((medication) =>
        medication.id === id
          ? {
              ...medication,
              status: "confirmed",
            }
          : medication,
      ),
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.root}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={styles.headerRow}>
            <Pressable style={styles.backButton} onPress={() => router.back()}>
              <Text style={styles.backIcon}>‹</Text>
            </Pressable>

            <View style={styles.headerIconCircle}>
              <AppIcon name="pill" size={25} color={AppTheme.colors.white} />
            </View>

            <View style={styles.headerTextBlock}>
              <Text style={styles.kicker}>Caregiver Concierge ACCESS-DP</Text>
              <Text style={styles.title}>Medication Management</Text>
            </View>

            <Text style={styles.patientName}>{patientFirstName}</Text>
          </View>

          <View style={styles.nextDueCard}>
            <View style={styles.clockCircle}>
              <Text style={styles.clockText}>⏰</Text>
            </View>

            <View style={styles.nextDueTextBlock}>
              <Text style={styles.nextDueLabel}>Next Due</Text>
              <Text style={styles.nextDueTitle}>
                {nextDueMedication.name} · {nextDueMedication.dose}
              </Text>
              <Text style={styles.nextDueTime}>
                {nextDueMedication.timeLabel}
              </Text>
            </View>

            <StatusPill status={nextDueMedication.status} compact />
          </View>

          <Text style={styles.sectionLabel}>Current Medications</Text>

          {medications.map((medication) => (
            <MedicationCard
              key={medication.id}
              medication={medication}
              onMarkGiven={() => markMedicationGiven(medication.id)}
            />
          ))}

          <Pressable style={styles.addMedicationButton}>
            <Text style={styles.addMedicationText}>➕ Add Medication</Text>
          </Pressable>
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

          <BottomNavItem label="Meds" icon="pill" active onPress={() => {}} />

          <BottomNavItem
            label="Schedule"
            icon="schedule"
            onPress={() => router.push("/schedule")}
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

function MedicationCard({
  medication,
  onMarkGiven,
}: {
  medication: Medication;
  onMarkGiven: () => void;
}) {
  const isConfirmed = medication.status === "confirmed";
  const isMissed = medication.status === "missed";

  return (
    <View style={styles.medicationCard}>
      <View style={styles.medicationHeader}>
        <View style={[styles.medDot, { backgroundColor: medication.accent }]} />

        <View style={styles.medicationTitleBlock}>
          <Text style={styles.medicationName}>{medication.name}</Text>
          <Text style={styles.medicationDose}>
            {medication.dose} · {medication.instructions}
          </Text>
        </View>

        <StatusPill status={medication.status} />
      </View>

      <View
        style={[
          styles.timeBox,
          isMissed && styles.timeBoxMissed,
          isConfirmed && styles.timeBoxConfirmed,
        ]}
      >
        <Text
          style={[
            styles.timeText,
            isMissed && styles.timeTextMissed,
            isConfirmed && styles.timeTextConfirmed,
          ]}
        >
          ⏰ {medication.timeLabel}
        </Text>
      </View>

      <View style={styles.actionRow}>
        <Pressable
          style={[
            styles.primaryAction,
            isConfirmed && styles.primaryActionConfirmed,
            isMissed && styles.primaryActionMissed,
          ]}
          onPress={onMarkGiven}
        >
          <Text
            style={[
              styles.primaryActionText,
              isConfirmed && styles.primaryActionTextConfirmed,
              isMissed && styles.primaryActionTextMissed,
            ]}
          >
            {isConfirmed
              ? "✅ Confirmed"
              : isMissed
                ? "Mark Given Now"
                : "✅ Confirm Given"}
          </Text>
        </Pressable>

        <Pressable style={styles.noteButton}>
          <AppIcon name="note" size={21} color={AppTheme.colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

function StatusPill({
  status,
  compact,
}: {
  status: MedicationStatus;
  compact?: boolean;
}) {
  const label =
    status === "confirmed"
      ? "Confirmed"
      : status === "missed"
        ? "Missed"
        : "Pending";

  return (
    <View
      style={[
        styles.statusPill,
        status === "pending" && styles.statusPending,
        status === "confirmed" && styles.statusConfirmed,
        status === "missed" && styles.statusMissed,
        compact && styles.statusPillCompact,
      ]}
    >
      <Text
        style={[
          styles.statusText,
          status === "pending" && styles.statusTextPending,
          status === "confirmed" && styles.statusTextConfirmed,
          status === "missed" && styles.statusTextMissed,
        ]}
      >
        {label}
      </Text>
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
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 124,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 28,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: AppTheme.colors.softSurface,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  backIcon: {
    color: AppTheme.colors.textSoft,
    fontSize: 26,
    fontWeight: "800",
    lineHeight: 28,
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
  headerTextBlock: {
    flex: 1,
  },
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
  nextDueTextBlock: {
    flex: 1,
  },
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
  medicationTitleBlock: {
    flex: 1,
    paddingRight: 10,
  },
  medicationName: {
    color: AppTheme.colors.text,
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
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
  statusPillCompact: {
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusPending: {
    backgroundColor: AppTheme.colors.warningSoft,
  },
  statusConfirmed: {
    backgroundColor: AppTheme.colors.brandSoft,
  },
  statusMissed: {
    backgroundColor: AppTheme.colors.dangerLight,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  statusTextPending: {
    color: "#B77900",
  },
  statusTextConfirmed: {
    color: AppTheme.colors.brand,
  },
  statusTextMissed: {
    color: AppTheme.colors.danger,
  },

  timeBox: {
    minHeight: 38,
    borderRadius: 18,
    backgroundColor: AppTheme.colors.softSurface,
    justifyContent: "center",
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  timeBoxMissed: {
    backgroundColor: AppTheme.colors.dangerLight,
  },
  timeBoxConfirmed: {
    backgroundColor: AppTheme.colors.softSurface,
  },
  timeText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "800",
  },
  timeTextMissed: {
    color: AppTheme.colors.danger,
  },
  timeTextConfirmed: {
    color: AppTheme.colors.textSoft,
  },

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
  primaryActionMissed: {
    backgroundColor: AppTheme.colors.dangerLight,
    borderWidth: 1,
    borderColor: "#FFC4CB",
  },
  primaryActionText: {
    color: AppTheme.colors.white,
    fontSize: 14,
    fontWeight: "900",
  },
  primaryActionTextConfirmed: {
    color: AppTheme.colors.brand,
  },
  primaryActionTextMissed: {
    color: AppTheme.colors.danger,
  },
  noteButton: {
    width: 54,
    height: 46,
    borderRadius: 16,
    backgroundColor: AppTheme.colors.surface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

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
