import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import { getOnboardingProfile } from "@/services/onboarding/onboardingService";

const contextOptions = [
  "Exercising / increased activity",
  "Poor sleep",
  "Stress or emotional upset",
  "Eating/drinking less than usual",
  "Missed or changed medication",
  "Bathroom changes",
  "Vomiting or diarrhea",
  "More tired, weak, confused, or not acting normal",
  "Pain or discomfort",
  "Breathing seemed different",
  "Sensor/watch issue",
  "Nothing unusual noticed",
  "Not sure",
];

export function NonEmergencyInsightCard() {
  const profile = getOnboardingProfile();
  const patientFirstName =
    profile.patient.name.trim().split(/\s+/)[0] || "the patient";

  const [selectedContext, setSelectedContext] = useState<string | null>(null);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconCircle}>
          <AppIcon name="mobility" size={24} color={AppTheme.colors.brand} />
        </View>

        <View style={styles.headerTextBlock}>
          <Text style={styles.kicker}>Non-emergency pattern</Text>
          <Text style={styles.title}>Movement looked different today</Text>
        </View>

        <View style={styles.softBadge}>
          <Text style={styles.softBadgeText}>In-app</Text>
        </View>
      </View>

      <Text style={styles.bodyText}>
        {patientFirstName}&apos;s mobility score was lower than expected, but
        this does not look like an emergency. Add context so the assistant can
        avoid unnecessary alerts and learn the pattern.
      </Text>

      <Text style={styles.questionText}>Was anything unusual happening?</Text>

      <View style={styles.contextGrid}>
        {contextOptions.map((option) => {
          const selected = selectedContext === option;

          return (
            <Pressable
              key={option}
              style={[styles.contextChip, selected && styles.contextChipSelected]}
              onPress={() => setSelectedContext(option)}
            >
              <Text
                style={[
                  styles.contextChipText,
                  selected && styles.contextChipTextSelected,
                ]}
              >
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.recommendationBox}>
        <Text style={styles.recommendationLabel}>Assistant recommendation</Text>
        <Text style={styles.recommendationText}>
          {selectedContext
            ? `${selectedContext} has been added as context. If this repeats at the same time or without explanation, consider asking the provider about the pattern.`
            : "If there is a clear reason, add context. If this repeats without explanation, the app can suggest a provider check-in."}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    padding: 22,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    ...AppTheme.shadow,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  headerTextBlock: {
    flex: 1,
  },
  kicker: {
    color: AppTheme.colors.sectionText,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 19,
    fontWeight: "900",
    lineHeight: 25,
  },
  softBadge: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  softBadgeText: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: "900",
  },
  bodyText: {
    color: AppTheme.colors.textSoft,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "700",
    marginBottom: 18,
  },
  questionText: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 12,
  },
  contextGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 18,
  },
  contextChip: {
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  contextChipSelected: {
    backgroundColor: AppTheme.colors.brand,
    borderColor: AppTheme.colors.brand,
  },
  contextChipText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: "900",
  },
  contextChipTextSelected: {
    color: AppTheme.colors.white,
  },
  recommendationBox: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderRadius: 18,
    padding: 15,
  },
  recommendationLabel: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  recommendationText: {
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "800",
  },
});
