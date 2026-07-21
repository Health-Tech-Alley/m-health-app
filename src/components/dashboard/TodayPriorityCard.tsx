import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import type { LatestUc4CardSummary } from "@/data/repositories/patientRecordRepository";

interface TodayPriorityCardProps {
  uc4Cards?: LatestUc4CardSummary[];
}

export function TodayPriorityCard({ uc4Cards }: TodayPriorityCardProps) {
  const router = useRouter();

  if (uc4Cards && uc4Cards.length > 0) {
    const topCard = uc4Cards[0];
    return (
      <Pressable style={styles.card} onPress={() => router.push("/care")}>
        <View style={styles.iconCircle}>
          <AppIcon name="heart" size={30} color={AppTheme.colors.warning} />
        </View>

        <View style={styles.content}>
          <Text style={styles.eyebrow}>Care Focus</Text>
          <Text style={styles.title} numberOfLines={2}>{topCard.title}</Text>
          <Text style={styles.time}>
            {topCard.score > 0 ? `Priority: ${(topCard.score * 100).toFixed(0)}%` : 'Check-in needed'}
          </Text>
        </View>

        <View style={styles.rightBlock}>
          <View style={styles.pendingPill}>
            <Text style={styles.pendingText}>
              {uc4Cards.length > 1 ? `${uc4Cards.length} items` : 'Review'}
            </Text>
          </View>

          <AppIcon name="chevronRight" size={30} color="#C8D1E3" />
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable style={styles.card} onPress={() => router.push("/medications")}>
      <View style={styles.iconCircle}>
        <AppIcon name="pill" size={30} color={AppTheme.colors.warning} />
      </View>

      <View style={styles.content}>
        <Text style={styles.eyebrow}>Medication Due</Text>
        <Text style={styles.title}>Albuterol · 2 puffs</Text>
        <Text style={styles.time}>Tonight at 8:00 PM</Text>
      </View>

      <View style={styles.rightBlock}>
        <View style={styles.pendingPill}>
          <Text style={styles.pendingText}>Pending</Text>
        </View>

        <AppIcon name="chevronRight" size={30} color="#C8D1E3" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 22,
    marginBottom: 24,
    flexDirection: "row",
    alignItems: "center",
    ...AppTheme.shadow,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 22,
    backgroundColor: AppTheme.colors.warningSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 20,
  },
  content: {
    flex: 1,
  },
  eyebrow: {
    color: "#E36B00",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 21,
    lineHeight: 28,
    fontWeight: "900",
  },
  time: {
    color: AppTheme.colors.textSoft,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: "800",
    marginTop: 4,
  },
  rightBlock: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  pendingPill: {
    backgroundColor: "#FFF3C4",
    borderRadius: AppTheme.radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pendingText: {
    color: "#C55300",
    fontSize: 12,
    fontWeight: "900",
  },
});
