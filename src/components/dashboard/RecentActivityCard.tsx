import { StyleSheet, Text, View } from "react-native";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";

type ActivityTone = "danger" | "brand" | "warning" | "muted";

const activities: {
  icon: AppIconName;
  tone: ActivityTone;
  title: string;
  time: string;
}[] = [
  {
    icon: "alert",
    tone: "danger",
    title: "Red Breath Alert created",
    time: "2m",
  },
  {
    icon: "check",
    tone: "brand",
    title: 'Luis tapped "Check on Elena"',
    time: "1m",
  },
  {
    icon: "pill",
    tone: "warning",
    title: "Albuterol reminder sent",
    time: "6h",
  },
  {
    icon: "schedule",
    tone: "muted",
    title: "Pulmonology appt. tomorrow 10am",
    time: "1d",
  },
];

export function RecentActivityCard() {
  return (
    <View style={styles.card}>
      {activities.map((activity, index) => {
        const tone = getToneStyle(activity.tone);

        return (
          <View
            key={activity.title}
            style={[
              styles.activityRow,
              index !== activities.length - 1 && styles.activityRowBorder,
            ]}
          >
            <View style={[styles.iconCircle, tone.circle]}>
              <AppIcon name={activity.icon} size={20} color={tone.iconColor} />
            </View>

            <Text style={styles.activityTitle}>{activity.title}</Text>
            <Text style={styles.activityTime}>{activity.time}</Text>
          </View>
        );
      })}
    </View>
  );
}

function getToneStyle(tone: ActivityTone) {
  if (tone === "danger") {
    return {
      circle: { backgroundColor: AppTheme.colors.dangerLight },
      iconColor: AppTheme.colors.danger,
    };
  }

  if (tone === "brand") {
    return {
      circle: { backgroundColor: AppTheme.colors.brandSoft },
      iconColor: AppTheme.colors.brand,
    };
  }

  if (tone === "warning") {
    return {
      circle: { backgroundColor: AppTheme.colors.warningSoft },
      iconColor: AppTheme.colors.warning,
    };
  }

  return {
    circle: { backgroundColor: AppTheme.colors.softSurface },
    iconColor: AppTheme.colors.navMuted,
  };
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    marginBottom: 24,
    overflow: "hidden",
    ...AppTheme.shadow,
  },
  activityRow: {
    minHeight: 72,
    paddingHorizontal: 22,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  activityRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: AppTheme.colors.border,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 18,
  },
  activityTitle: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 17,
    lineHeight: 23,
  },
  activityTime: {
    color: AppTheme.colors.textMuted,
    fontSize: 15,
    fontWeight: "800",
    marginLeft: 14,
  },
});