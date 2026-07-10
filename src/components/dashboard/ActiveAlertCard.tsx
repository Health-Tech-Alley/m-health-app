import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import { useOrchestratorPatientId } from "@/contexts/orchestrator-context";
import { getMlEventForAlert, insertCaregiverAction } from "@/data";
import type { MlEvent } from "@/data";
import { audit } from "@/services/audit/auditService";
import {
  acknowledgeCareAlert,
  resolveCareAlert,
} from "@/services/care/careService";
import { useActiveAlert } from "@/hooks/useActiveAlert";
import { getOnboardingProfile } from "@/services/onboarding/onboardingService";

/**
 * Dashboard / Care active-alert card.
 *
 * Reads the highest-severity open alert from the reactive `useActiveAlert`
 * hook (live-refreshes on alert-affecting bus events). Renders a calm teal
 * "check-in" card for severity 1-2 and a red takeover-style card for
 * severity 3. Surfaces real vitals + the UC2 contextual anomaly type from
 * the associated ml_event when available.
 *
 * No hardcoded demo fallback — if there is no active alert, the card is not
 * rendered (the parent decides whether to reserve space).
 */
export function ActiveAlertCard() {
  const router = useRouter();
  const profile = getOnboardingProfile();
  const patientId = useOrchestratorPatientId();
  const activeAlert = useActiveAlert(patientId);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");

  const patientFirstName =
    profile.patient.name.trim().split(/\s+/)[0] || "patient";

  // Pull the structured ML event for this alert so we can surface the
  // contextual anomaly type + raw vitals. Re-reads when the alert changes.
  const mlEvent = useMemo<MlEvent | null>(() => {
    if (!activeAlert) return null;
    try {
      return getMlEventForAlert(activeAlert.alertId);
    } catch {
      return null;
    }
  }, [activeAlert?.alertId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a local mirror so optimistic "mark handled" hides the card before
  // the bus event refreshes the hook.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    // Defer so setState happens outside the effect body.
    const t = setTimeout(() => setHidden(false), 0);
    return () => clearTimeout(t);
  }, [activeAlert?.alertId]);

  if (!activeAlert || hidden) {
    return null;
  }

  const isEmergency = activeAlert.severity === 3;
  const accent = isEmergency ? AppTheme.colors.danger : AppTheme.colors.brand;
  const title = activeAlert.title;
  const subtitle = `Severity ${activeAlert.severity} · ${capitalize(activeAlert.status)} · ${formatRelativeTime(activeAlert.createdAt)}`;
  const pillLabel = getSeverityLabel(activeAlert.severity);
  const body = activeAlert.body
    ? `${activeAlert.body} `
    : `${profile.patient.name}'s recent vitals show an unusual pattern. `;

  const contextualType = mlEvent?.initialAnomalyType;
  const vitals = parseRawVitals(mlEvent);
  const metrics = pickMetrics(vitals, isEmergency);

  function handleCall911() {
    audit({
      actor: "caregiver",
      action: "initiated_911",
      resourceType: "alert",
      resourceId: activeAlert!.alertId,
      patientId,
    });
    Linking.openURL("tel:911").catch((err) =>
      console.error("[ActiveAlertCard] Could not open dialer:", err),
    );
  }

  function handleContactProvider() {
    const phone = profile.primaryCareProvider.phone;
    if (phone) {
      audit({
        actor: "caregiver",
        action: "contact_provider",
        resourceType: "alert",
        resourceId: activeAlert!.alertId,
        patientId,
      });
      Linking.openURL(`tel:${phone}`).catch((err) =>
        console.error("[ActiveAlertCard] Could not open dialer:", err),
      );
    } else {
      Alert.alert("No provider phone", "A primary care provider phone number was not provided during onboarding.");
    }
  }

  function handleAcknowledge() {
    acknowledgeCareAlert(activeAlert!.alertId);
    audit({
      actor: "caregiver",
      action: "acknowledged",
      resourceType: "alert",
      resourceId: activeAlert!.alertId,
      patientId,
      payload: { severity: activeAlert!.severity },
    });
    Alert.alert(
      "Alert acknowledged",
      "The alert has been acknowledged and logged. Check on the patient immediately and call 911 if symptoms are severe.",
      [{ text: "OK" }],
    );
  }

  function handleMarkHandled() {
    resolveCareAlert(activeAlert!.alertId);
    audit({
      actor: "caregiver",
      action: "resolved",
      resourceType: "alert",
      resourceId: activeAlert!.alertId,
      patientId,
    });
    setHidden(true);
  }

  function handleSaveNote() {
    const trimmed = noteText.trim();
    if (!trimmed) {
      setNoteOpen(false);
      return;
    }
    audit({
      actor: "caregiver",
      action: "add_note",
      resourceType: "alert",
      resourceId: activeAlert!.alertId,
      patientId,
      payload: { note: trimmed },
    });
    insertCaregiverAction({
      actionId: `act-${Date.now()}`,
      alertId: activeAlert!.alertId,
      patientId,
      caregiverId: "caregiver-1",
      type: "log_observation",
      payloadJson: JSON.stringify({ note: trimmed }),
      createdAt: new Date().toISOString(),
    });
    setNoteText("");
    setNoteOpen(false);
  }

  function openDetail() {
    router.push({ pathname: "/alert-detail", params: { alertId: activeAlert!.alertId } });
  }

  return (
    <View style={[styles.card, { backgroundColor: accent }]}>
      <View style={styles.headerRow}>
        <View style={styles.alertIconCircle}>
          <AppIcon name="alert" size={28} color={AppTheme.colors.white} />
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.eyebrow}>
            {isEmergency ? "Active Alert" : "Check-in"}
          </Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <View style={styles.urgentPill}>
          <Text style={styles.urgentText}>{pillLabel}</Text>
        </View>
      </View>

      {metrics.length > 0 && (
        <View style={styles.metricRow}>
          {metrics.map((m) => (
            <MetricBox key={m.label} label={m.label} value={m.value} />
          ))}
        </View>
      )}

      {contextualType && (
        <Text style={styles.contextLine}>
          Pattern: {contextualType.replace(/_/g, " ").toLowerCase()}
        </Text>
      )}

      <Text style={styles.bodyText}>
        {body}
        <Text style={styles.boldText}>You decide — the app never acts for you.</Text>
      </Text>

      <View style={styles.primaryActions}>
        {isEmergency ? (
          <Pressable style={styles.callButton} onPress={handleCall911}>
            <Text style={styles.callButtonText}>Call 911</Text>
          </Pressable>
        ) : null}

        <Pressable
          style={[styles.checkButton, !isEmergency && { flex: 1 }]}
          onPress={openDetail}
        >
          <Text style={styles.checkButtonText}>
            {isEmergency ? `Check on ${patientFirstName}` : "Review alert"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.secondaryActions}>
        <Pressable style={styles.secondaryButton} onPress={handleContactProvider}>
          <Text style={styles.secondaryButtonText}>Contact Provider</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={isEmergency ? handleAcknowledge : handleMarkHandled}
        >
          <Text style={styles.secondaryButtonText}>
            {isEmergency ? "Acknowledge" : "Mark handled"}
          </Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => setNoteOpen((v) => !v)}
        >
          <Text style={styles.secondaryButtonText}>Add Note</Text>
        </Pressable>
      </View>

      {noteOpen ? (
        <View style={styles.noteBlock}>
          <TextInput
            style={styles.noteInput}
            value={noteText}
            onChangeText={setNoteText}
            placeholder="Add a caregiver note (logged to the audit trail)."
            placeholderTextColor="rgba(255,255,255,0.6)"
            multiline
            textAlignVertical="top"
            autoFocus
          />
          <View style={styles.noteActions}>
            <Pressable
              style={[styles.noteButton, styles.noteCancelButton]}
              onPress={() => {
                setNoteOpen(false);
                setNoteText("");
              }}
            >
              <Text style={styles.noteCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.noteButton, styles.noteSaveButton]}
              onPress={handleSaveNote}
            >
              <Text style={styles.noteSaveText}>Save note</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Pressable onPress={openDetail}>
        <Text style={styles.footerLink}>View full alert →</Text>
      </Pressable>
    </View>
  );
}

function getSeverityLabel(severity: 1 | 2 | 3): string {
  if (severity === 3) return "Urgent";
  if (severity === 2) return "Watch";
  return "Info";
}

function formatRelativeTime(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "Recent";

  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Parse the raw-vitals snapshot from the ml_event (best-effort). */
function parseRawVitals(event: MlEvent | null): Record<string, number | undefined> {
  if (!event?.rawVitalsJson) return {};
  try {
    return JSON.parse(event.rawVitalsJson) as Record<string, number | undefined>;
  } catch {
    return {};
  }
}

/** Pick up to three metric boxes from the raw vitals, preferring the
 *  emergency-relevant signals for severity 3. */
function pickMetrics(
  vitals: Record<string, number | undefined>,
  isEmergency: boolean,
): { label: string; value: string }[] {
  const fmt = (v: number | undefined, unit: string) =>
    v !== undefined && v !== null && Number.isFinite(v)
      ? `${Math.round(v * 100) / 100}${unit}`
      : "—";

  if (isEmergency) {
    return [
      { label: "SpO₂", value: fmt(vitals.blood_oxygen, "%") },
      { label: "HR", value: fmt(vitals.heart_rate, " BPM") },
      { label: "RR", value: fmt(vitals.respiratory_rate, "/min") },
    ];
  }
  return [
    { label: "HR", value: fmt(vitals.heart_rate, " BPM") },
    { label: "SpO₂", value: fmt(vitals.blood_oxygen, "%") },
    { label: "Stress", value: fmt(vitals.stress_level, "") },
  ];
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: AppTheme.radius.card,
    padding: 22,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  alertIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  titleBlock: {
    flex: 1,
  },
  eyebrow: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  title: {
    color: AppTheme.colors.white,
    fontSize: 21,
    fontWeight: "900",
  },
  subtitle: {
    color: AppTheme.colors.white,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 4,
  },
  urgentPill: {
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  urgentText: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  metricRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 26,
  },
  metricBox: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.16)",
    paddingVertical: 13,
    alignItems: "center",
  },
  metricLabel: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: "700",
  },
  metricValue: {
    color: AppTheme.colors.white,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 4,
  },
  contextLine: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 14,
    textTransform: "capitalize",
  },
  bodyText: {
    color: AppTheme.colors.white,
    fontSize: 16,
    lineHeight: 27,
    marginTop: 18,
  },
  boldText: {
    fontWeight: "900",
  },
  primaryActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  callButton: {
    flex: 1,
    backgroundColor: AppTheme.colors.white,
    borderRadius: 18,
    paddingVertical: 17,
    alignItems: "center",
  },
  callButtonText: {
    color: AppTheme.colors.danger,
    fontSize: 17,
    fontWeight: "900",
  },
  checkButton: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 18,
    paddingVertical: 17,
    alignItems: "center",
    paddingHorizontal: 16,
  },
  checkButtonText: {
    color: AppTheme.colors.white,
    fontSize: 17,
    fontWeight: "900",
  },
  secondaryActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 74,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.32)",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  secondaryButtonText: {
    color: AppTheme.colors.white,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  noteBlock: {
    marginTop: 12,
    gap: 10,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    borderRadius: 14,
    padding: 12,
    minHeight: 70,
    fontSize: 14,
    color: AppTheme.colors.white,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  noteActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  noteButton: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  noteCancelButton: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  noteCancelText: {
    color: AppTheme.colors.white,
    fontSize: 14,
    fontWeight: "800",
  },
  noteSaveButton: {
    backgroundColor: AppTheme.colors.white,
  },
  noteSaveText: {
    color: AppTheme.colors.danger,
    fontSize: 14,
    fontWeight: "900",
  },
  footerLink: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: "900",
    textDecorationLine: "underline",
    textAlign: "center",
    marginTop: 20,
  },
});
