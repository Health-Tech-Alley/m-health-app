import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
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
import { useCriticalAlert } from "@/contexts/critical-alert-context";
import { usePatientRecord } from "@/contexts/patient-record-context";
import {
  getDailyCareEntry,
  upsertDailyCareEntry,
  type DailyCareEntry,
} from "@/data";
import { getOnboardingProfile } from "@/services/onboarding/onboardingService";

// Seed defaults used the first time the Care screen is opened for today.
const DEFAULT_DAILY_ENTRY: Partial<DailyCareEntry> = {
  therapyDay: 21,
  carePlanId: "careplan_abc123",
  therapyCompleted: true,
  setsCompleted: 3,
  recommendedSets: 3,
  painBefore: 3,
  painAfter: 4,
  fatigue: 5,
  assistanceRequired: "some",
  caregiverConcern: false,
  functionalTaskScore: 2.6,
  guidedMovementScore: 55,
  notes: "Completed all exercises but shoulder movement looked about the same as last week.",
};

const providerCarePlan = {
  condition: "post_stroke_rehabilitation",
  therapy_focus: "upper_extremity_shoulder_rom",
  therapy_start_date: "2026-05-26",
  current_therapy_week: 3,
  affected_side: "left",
  assigned_therapist: {
    name: "Dr. Patel",
    role: "physical_therapist",
  },
  recommended_daily_sets: 3,
  milestones: {
    week_3: {
      functional_task_score_target: 3.8,
      guided_movement_score_target: 85,
    },
  },
  consent: {
    share_record: true,
    consent_valid_until: "2026-12-31T23:59:59-05:00",
  },
};

export default function CareScreen() {
  const router = useRouter();
  const profile = getOnboardingProfile();
  const { patientId } = usePatientRecord();
  const { reopenOnCareFocus } = useCriticalAlert();

  const patientFirstName =
    profile.patient.name.trim().split(/\s+/)[0] || "patient";

  const caregiverFirstName =
    profile.caregiver.name.trim().split(/\s+/)[0] || "caregiver";

  // Re-surface the severity-3 critical-alert popup whenever the Care tab is
  // (re)opened, until the alert is dismissed or resolved.
  useFocusEffect(
    useCallback(() => {
      reopenOnCareFocus();
    }, [reopenOnCareFocus]),
  );

  // Daily care entry — sourced from SQLite (or seeded defaults), editable,
  // persisted via upsertDailyCareEntry on each edit.
  const [entry, setEntry] = useState<DailyCareEntry>(() => {
    if (!patientId) {
      return {
        entryId: "temp",
        patientId: "temp",
        ...DEFAULT_DAILY_ENTRY,
        therapyCompleted: true,
        setsCompleted: 3,
        recommendedSets: 3,
        caregiverConcern: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as DailyCareEntry;
    }
    const existing = getDailyCareEntry(patientId);
    if (existing) return existing;
    return upsertDailyCareEntry({
      patientId: patientId ?? undefined,
      ...DEFAULT_DAILY_ENTRY,
    } as DailyCareEntry & { patientId: string });
  });

  const [editingField, setEditingField] = useState<null | "painBefore" | "painAfter" | "fatigue" | "notes">(null);
  const [editDraft, setEditDraft] = useState("");

  const openFieldEdit = (field: "painBefore" | "painAfter" | "fatigue" | "notes") => {
    setEditingField(field);
    setEditDraft(String(entry[field] ?? ""));
  };

  const saveFieldEdit = () => {
    if (!editingField || !patientId) {
      setEditingField(null);
      return;
    }
    const isNumeric = editingField !== "notes";
    const newValue = isNumeric ? Number(editDraft) : editDraft;
    const updated = upsertDailyCareEntry({
      ...entry,
      [editingField]: isNumeric ? Number(newValue) || 0 : newValue,
    });
    setEntry(updated);
    setEditingField(null);
    setEditDraft("");
  };

  // Safety considerations: split the safety-notes string into individual,
  // period-less, tappable lines. Clicking one opens a combined explanation.
  const safetyConsiderations = parseSafetyConsiderations(
    profile.safety?.safetyNotes ?? "No safety notes provided.",
  );
  const [openConsideration, setOpenConsideration] = useState<string | null>(null);
  const [slmOpen, setSlmOpen] = useState(false);
  const [slmPrompt, setSlmPrompt] = useState("");

  const functionalTarget =
    providerCarePlan.milestones.week_3.functional_task_score_target;

  const movementTarget =
    providerCarePlan.milestones.week_3.guided_movement_score_target;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerTextBlock}>
            <Text style={styles.kicker}>Caregiver Concierge ACCESS-DP</Text>
            <Text style={styles.title}>Care Management</Text>
          </View>

          <Text style={styles.patientName}>{patientFirstName}</Text>
        </View>

        <View style={styles.patientCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(profile.patient.name)}</Text>
          </View>

          <View style={styles.patientInfo}>
            <Text style={styles.patientCardName}>{profile.patient.name}</Text>
            <Text style={styles.patientDetail}>
              {profile.patient.age} yrs · {profile.patient.conditions}
            </Text>
            <Text style={styles.patientMuted}>No movement · 25 min</Text>
          </View>
        </View>

        <View style={styles.safetyCard}>
          <Text style={styles.safetyKicker}>Safety Considerations</Text>
          <Text style={styles.safetyHint}>
            Tap any consideration for details and an assistant explanation.
          </Text>
          {safetyConsiderations.map((consideration, idx) => (
            <Pressable
              key={idx}
              style={styles.safetyRow}
              onPress={() => setOpenConsideration(consideration)}
            >
              <Text style={styles.safetyBullet}>•</Text>
              <Text style={styles.safetyLine}>{consideration}</Text>
              <Text style={styles.safetyChevron}>›</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Care Plan</Text>

        <View style={styles.carePlanCard}>
          <View style={styles.carePlanHeader}>
            <View>
              <Text style={styles.carePlanKicker}>Therapy Progress</Text>
              <Text style={styles.carePlanTitle}>
                Week {providerCarePlan.current_therapy_week} · Day{" "}
                {entry.therapyDay}
              </Text>
              <Text style={styles.carePlanSubtitle}>
                {formatCarePlanText(providerCarePlan.therapy_focus)}
              </Text>
            </View>

            <View style={styles.completedPill}>
              <Text style={styles.completedPillText}>
                {entry.therapyCompleted ? "Completed" : "Pending"}
              </Text>
            </View>
          </View>

          <View style={styles.carePlanMetaGrid}>
            <CarePlanMeta
              label="Therapist"
              value={providerCarePlan.assigned_therapist.name}
            />
            <CarePlanMeta
              label="Affected side"
              value={capitalize(providerCarePlan.affected_side)}
            />
            <CarePlanMeta
              label="Logged by"
              value={`${caregiverFirstName} · ${profile.caregiver.relationship}`}
            />
            <CarePlanMeta
              label="Assistance"
              value={capitalize(entry.assistanceRequired ?? "some")}
            />
          </View>

          <View style={styles.setsRow}>
            <View>
              <Text style={styles.setsLabel}>Daily Sets</Text>
              <Text style={styles.setsValue}>
                {entry.setsCompleted}/
                {entry.recommendedSets}
              </Text>
            </View>

            <View style={styles.setsProgressTrack}>
              <View
                style={[
                  styles.setsProgressFill,
                  {
                    width: `${Math.min(
                      100,
                      (entry.setsCompleted /
                        Math.max(entry.recommendedSets, 1)) *
                        100,
                    )}%`,
                  },
                ]}
              />
            </View>
          </View>

          <View style={styles.symptomRow}>
            <EditableSymptomBox
              label="Pain Before"
              value={entry.painBefore}
              onPress={() => openFieldEdit("painBefore")}
            />
            <EditableSymptomBox
              label="Pain After"
              value={entry.painAfter}
              onPress={() => openFieldEdit("painAfter")}
            />
            <EditableSymptomBox
              label="Fatigue"
              value={entry.fatigue}
              onPress={() => openFieldEdit("fatigue")}
            />
          </View>

          <ProgressMetric
            label="Functional Task Score"
            value={entry.functionalTaskScore ?? 0}
            target={functionalTarget}
            max={5}
          />

          <ProgressMetric
            label="Guided Movement Score"
            value={entry.guidedMovementScore ?? 0}
            target={movementTarget}
            max={100}
          />

          <Pressable style={styles.notesCard} onPress={() => openFieldEdit("notes")}>
            <Text style={styles.notesLabel}>Caregiver Note · tap to edit</Text>
            <Text style={styles.notesText}>{entry.notes}</Text>
          </Pressable>

          <View style={styles.consentRow}>
            <View style={styles.consentDot} />
            <Text style={styles.consentText}>
              Sharing with provider{" "}
              {providerCarePlan.consent.share_record ? "enabled" : "disabled"}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Care Analysis</Text>

        <Pressable
          style={styles.mlButton}
          onPress={() => router.push("/care-management")}
        >
          <Text style={styles.mlButtonKicker}>ML Care Analysis</Text>
          <Text style={styles.mlButtonText}>
            Review anomaly detection, wearable scenario details, and generated
            care explanation.
          </Text>
          <Text style={styles.mlButtonLink}>Open care analysis →</Text>
        </Pressable>
      </ScrollView>

      {/* Combined safety explanation dialog (safety note + reason + recommendation) */}
      <Modal
        visible={openConsideration !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenConsideration(null)}
      >
        <Pressable style={styles.explainOverlay} onPress={() => setOpenConsideration(null)}>
          <Pressable style={styles.explainSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.explainHeader}>
              <Text style={styles.explainKicker}>Safety Consideration</Text>
              <Pressable onPress={() => setOpenConsideration(null)} hitSlop={12}>
                <Text style={styles.explainClose}>×</Text>
              </Pressable>
            </View>

            <Text style={styles.explainTitle}>{openConsideration}</Text>

            <View style={styles.explainBlock}>
              <Text style={styles.explainLabel}>Why this matters</Text>
              <Text style={styles.explainBody}>
                {profile.patient.name}&apos;s vitals are outside the configured
                safe range (oxygen below cutoff, elevated respiratory and heart
                rate). This consideration is part of the configured safety plan
                to catch deterioration early.
              </Text>
            </View>

            <View style={styles.explainBlock}>
              <Text style={styles.explainLabel}>Recommendation</Text>
              <Text style={styles.explainBody}>
                Check on {patientFirstName} immediately. Consider ER or 911 if
                symptoms are severe. The app will not act automatically.
              </Text>
            </View>

            <Pressable
              style={styles.explainSlmButton}
              onPress={() => {
                setSlmPrompt(`Explain this safety consideration for ${profile.patient.name} in plain, calm language a family caregiver can act on: "${openConsideration ?? ""}". Include why it matters, what to watch for, and what to do next.`);
                setSlmOpen(true);
                setOpenConsideration(null);
              }}
            >
              <AppIcon name="care" size={18} color={AppTheme.colors.white} />
              <Text style={styles.explainSlmText}>Explain with assistant</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <SlmInsightSheet
        visible={slmOpen}
        onClose={() => {
          setSlmOpen(false);
          setSlmPrompt("");
        }}
        title="Assistant explanation"
        reason="safety_note_explain"
        prompt={slmPrompt}
      />

      {/* Field edit modal (pain before/after, fatigue, notes) */}
      <Modal
        visible={editingField !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingField(null)}
      >
        <Pressable style={styles.editOverlay} onPress={() => setEditingField(null)}>
          <Pressable style={styles.editSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.editTitle}>
              Edit {editingField?.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
            </Text>
            {editingField === "notes" ? (
              <TextInput
                style={[styles.editInput, styles.editInputMultiline]}
                value={editDraft}
                onChangeText={setEditDraft}
                placeholder="Caregiver note…"
                multiline
                textAlignVertical="top"
                autoFocus
              />
            ) : (
              <TextInput
                style={styles.editInput}
                value={editDraft}
                onChangeText={setEditDraft}
                placeholder="0–10"
                keyboardType="numeric"
                autoFocus
              />
            )}
            <View style={styles.editActions}>
              <Pressable
                style={[styles.editButton, styles.editCancel]}
                onPress={() => setEditingField(null)}
              >
                <Text style={styles.editCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.editButton} onPress={saveFieldEdit}>
                <Text style={styles.editSaveText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

/**
 * Split the safety-notes string into individual, period-less considerations.
 * Splits on newlines and sentence-ending periods; strips trailing punctuation.
 */
function parseSafetyConsiderations(notes: string): string[] {
  const raw = notes
    .split(/\n|\.|\u2022|\u2023|\u25E6|\u2043/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
  const unique = Array.from(new Set(raw));
  return unique.length > 0 ? unique : ["No safety notes provided."];
}

function CarePlanMeta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.carePlanMetaItem}>
      <Text style={styles.carePlanMetaLabel}>{label}</Text>
      <Text style={styles.carePlanMetaValue}>{value}</Text>
    </View>
  );
}

function EditableSymptomBox({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: number;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.symptomBox} onPress={onPress}>
      <Text style={styles.symptomValue}>{value ?? "–"}/10</Text>
      <Text style={styles.symptomLabel}>{label} ›</Text>
    </Pressable>
  );
}

function ProgressMetric({
  label,
  value,
  target,
  max,
}: {
  label: string;
  value: number;
  target: number;
  max: number;
}) {
  const valuePercent = Math.min(100, (value / max) * 100);
  const targetPercent = Math.min(100, (target / max) * 100);

  return (
    <View style={styles.progressMetric}>
      <View style={styles.progressMetricHeader}>
        <Text style={styles.progressMetricLabel}>{label}</Text>
        <Text style={styles.progressMetricValue}>
          {value} / target {target}
        </Text>
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressTargetMarker,
            {
              left: `${targetPercent}%`,
            },
          ]}
        />

        <View
          style={[
            styles.progressFill,
            {
              width: `${valuePercent}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatCarePlanText(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map(capitalize)
    .join(" ");
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 40,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  headerTextBlock: {
    flex: 1,
  },
  kicker: {
    color: AppTheme.colors.sectionText,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 2,
  },
  patientName: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: "900",
  },
  patientCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 22,
    marginBottom: 18,
    flexDirection: "row",
    alignItems: "center",
    ...AppTheme.shadow,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: AppTheme.colors.brandSoft,
    borderWidth: 1,
    borderColor: "#B7FFF1",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  avatarText: {
    color: AppTheme.colors.brand,
    fontSize: 17,
    fontWeight: "900",
  },
  patientInfo: {
    flex: 1,
  },
  patientCardName: {
    color: AppTheme.colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  patientDetail: {
    color: AppTheme.colors.textSoft,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 5,
  },
  patientMuted: {
    color: AppTheme.colors.textMuted,
    fontSize: 15,
    marginTop: 8,
  },
  safetyCard: {
    backgroundColor: "#FFF9E8",
    borderWidth: 1,
    borderColor: "#FCD56B",
    borderRadius: AppTheme.radius.lg,
    padding: 18,
    marginBottom: 18,
  },
  safetyKicker: {
    color: "#B45309",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  safetyHint: {
    color: "#92400E",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 10,
  },
  safetyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(180,83,9,0.15)",
    gap: 8,
  },
  safetyBullet: {
    color: "#B45309",
    fontSize: 16,
    fontWeight: "900",
  },
  safetyLine: {
    flex: 1,
    color: "#92400E",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
  },
  safetyChevron: {
    color: "#B45309",
    fontSize: 20,
    fontWeight: "900",
  },
  safetyText: {
    color: "#92400E",
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "700",
  },
  explainOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  explainSheet: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    padding: 22,
  },
  explainHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  explainKicker: {
    color: AppTheme.colors.brand,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  explainClose: {
    color: AppTheme.colors.textSoft,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 26,
  },
  explainTitle: {
    color: AppTheme.colors.text,
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 23,
    marginBottom: 16,
  },
  explainBlock: {
    marginBottom: 14,
  },
  explainLabel: {
    color: AppTheme.colors.sectionText,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  explainBody: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    lineHeight: 21,
  },
  explainSlmButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 6,
  },
  explainSlmText: {
    color: AppTheme.colors.white,
    fontSize: 15,
    fontWeight: "900",
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
  editInputMultiline: {
    minHeight: 90,
    textAlignVertical: "top",
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
  editCancel: {
    backgroundColor: AppTheme.colors.softSurface,
  },
  editCancelText: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    fontWeight: "900",
  },
  editSaveText: {
    color: AppTheme.colors.white,
    fontSize: 14,
    fontWeight: "900",
  },
  infoCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 22,
    marginBottom: 18,
    ...AppTheme.shadow,
  },
  sectionLabel: {
    color: AppTheme.colors.sectionText,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  infoText: {
    color: AppTheme.colors.textSoft,
    fontSize: 17,
    lineHeight: 30,
  },
  recommendationCard: {
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FDBA74",
    borderRadius: AppTheme.radius.card,
    padding: 22,
    marginBottom: 22,
  },
  recommendationKicker: {
    color: "#F97316",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  recommendationText: {
    color: "#8A2C0D",
    fontSize: 17,
    lineHeight: 30,
    fontWeight: "800",
  },
  sectionTitle: {
    color: AppTheme.colors.sectionText,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 14,
  },
  carePlanCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 22,
    marginBottom: 24,
    ...AppTheme.shadow,
  },
  carePlanHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 20,
  },
  carePlanKicker: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  carePlanTitle: {
    color: AppTheme.colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
  },
  carePlanSubtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 4,
  },
  completedPill: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  completedPillText: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: "900",
  },
  carePlanMetaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 18,
  },
  carePlanMetaItem: {
    width: "47%",
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 16,
    padding: 14,
  },
  carePlanMetaLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 6,
  },
  carePlanMetaValue: {
    color: AppTheme.colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  setsRow: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  setsLabel: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  setsValue: {
    color: AppTheme.colors.text,
    fontSize: 28,
    fontWeight: "900",
    marginTop: 4,
  },
  setsProgressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: "#CFF5ED",
    overflow: "hidden",
    marginTop: 14,
  },
  setsProgressFill: {
    height: "100%",
    borderRadius: 5,
    backgroundColor: AppTheme.colors.brand,
  },
  symptomRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 18,
  },
  symptomBox: {
    flex: 1,
    backgroundColor: AppTheme.colors.softSurface,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
  },
  symptomValue: {
    color: AppTheme.colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  symptomLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 5,
    textAlign: "center",
  },
  progressMetric: {
    marginBottom: 18,
  },
  progressMetricHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  },
  progressMetricLabel: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  progressMetricValue: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "800",
  },
  progressTrack: {
    height: 12,
    borderRadius: 6,
    backgroundColor: AppTheme.colors.softSurface,
    overflow: "hidden",
    position: "relative",
  },
  progressFill: {
    height: "100%",
    borderRadius: 6,
    backgroundColor: AppTheme.colors.brand,
  },
  progressTargetMarker: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: AppTheme.colors.danger,
    zIndex: 2,
  },
  notesCard: {
    backgroundColor: "#FFF9E8",
    borderWidth: 1,
    borderColor: "#FCD56B",
    borderRadius: 18,
    padding: 16,
    marginTop: 2,
  },
  notesLabel: {
    color: "#92400E",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 7,
  },
  notesText: {
    color: "#92400E",
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "700",
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
  },
  consentDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: AppTheme.colors.brand,
    marginRight: 8,
  },
  consentText: {
    color: AppTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
  },
  mlButton: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderWidth: 1,
    borderColor: "#B7FFF1",
    borderRadius: AppTheme.radius.card,
    padding: 20,
  },
  mlButtonKicker: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  mlButtonText: {
    color: AppTheme.colors.textSoft,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 12,
  },
  mlButtonLink: {
    color: AppTheme.colors.brand,
    fontSize: 15,
    fontWeight: "900",
  },
});