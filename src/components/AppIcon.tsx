import { StyleSheet, Text, View } from "react-native";

import { AppTheme } from "@/constants/theme";

export type AppIconName =
  | "home"
  | "care"
  | "pill"
  | "schedule"
  | "assistant"
  | "profile"
  | "alert"
  | "heart"
  | "resp"
  | "spo2"
  | "note"
  | "provider"
  | "bell"
  | "check"
  | "plus"
  | "chevronRight";

type AppIconProps = {
  name: AppIconName;
  size?: number;
  color?: string;
};

export function AppIcon({
  name,
  size = 24,
  color = AppTheme.colors.brand,
}: AppIconProps) {
  if (name === "pill") {
    return <PillIcon size={size} color={color} />;
  }

  if (name === "schedule") {
    return <ScheduleIcon size={size} color={color} />;
  }

  if (name === "assistant") {
    return <AssistantIcon size={size} color={color} />;
  }

  if (name === "profile") {
    return <ProfileIcon size={size} color={color} />;
  }

  return (
    <Text style={[styles.textIcon, { fontSize: size, color }]}>
      {getIconLabel(name)}
    </Text>
  );
}

function PillIcon({ size, color }: { size: number; color: string }) {
  const width = size * 1.4;
  const height = size * 0.65;

  return (
    <View
      style={[
        styles.pillOuter,
        {
          width,
          height,
          borderRadius: height / 2,
          borderColor: color,
          transform: [{ rotate: "-35deg" }],
        },
      ]}
    >
      <View style={[styles.pillDivider, { backgroundColor: color }]} />
    </View>
  );
}

function ScheduleIcon({ size, color }: { size: number; color: string }) {
  return (
    <View
      style={[
        styles.calendarOuter,
        {
          width: size,
          height: size * 0.92,
          borderColor: color,
          borderRadius: size * 0.16,
        },
      ]}
    >
      <View
        style={[
          styles.calendarTopBar,
          {
            height: size * 0.24,
            backgroundColor: color,
          },
        ]}
      />

      <View style={styles.calendarGrid}>
        <View style={[styles.calendarDot, { backgroundColor: color }]} />
        <View style={[styles.calendarDot, { backgroundColor: color }]} />
        <View style={[styles.calendarDot, { backgroundColor: color }]} />
        <View style={[styles.calendarDot, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

function AssistantIcon({ size, color }: { size: number; color: string }) {
  return (
    <View
      style={[
        styles.assistantBubble,
        {
          width: size * 1.1,
          height: size * 0.86,
          borderRadius: size * 0.22,
          borderColor: color,
        },
      ]}
    >
      <Text
        style={[
          styles.assistantText,
          {
            color,
            fontSize: size * 0.32,
          },
        ]}
      >
        AI
      </Text>

      <View
        style={[
          styles.assistantTail,
          {
            width: size * 0.24,
            height: size * 0.24,
            borderRightColor: color,
            borderBottomColor: color,
            bottom: -size * 0.08,
            right: size * 0.18,
          },
        ]}
      />
    </View>
  );
}

function ProfileIcon({ size, color }: { size: number; color: string }) {
  return (
    <View
      style={[
        styles.profileOuter,
        {
          width: size,
          height: size,
        },
      ]}
    >
      <View
        style={[
          styles.profileHead,
          {
            width: size * 0.34,
            height: size * 0.34,
            borderRadius: size * 0.17,
            borderColor: color,
          },
        ]}
      />

      <View
        style={[
          styles.profileShoulders,
          {
            width: size * 0.72,
            height: size * 0.34,
            borderRadius: size * 0.2,
            borderColor: color,
          },
        ]}
      />
    </View>
  );
}

function getIconLabel(name: AppIconName): string {
  switch (name) {
    case "home":
      return "⌂";
    case "care":
      return "♡";
    case "alert":
      return "△";
    case "heart":
      return "♥";
    case "resp":
      return "↟";
    case "spo2":
      return "O₂";
    case "note":
      return "✎";
    case "provider":
      return "☎";
    case "bell":
      return "⌁";
    case "check":
      return "✓";
    case "plus":
      return "+";
    case "chevronRight":
      return "›";
    default:
      return "•";
  }
}

const styles = StyleSheet.create({
  textIcon: {
    fontWeight: "900",
    textAlign: "center",
    includeFontPadding: false,
  },

  pillOuter: {
    borderWidth: 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  pillDivider: {
    width: 2,
    height: "100%",
  },

  calendarOuter: {
    borderWidth: 2,
    overflow: "hidden",
  },
  calendarTopBar: {
    width: "100%",
  },
  calendarGrid: {
    flex: 1,
    padding: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-around",
    alignContent: "space-around",
  },
  calendarDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },

  assistantBubble: {
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  assistantText: {
    fontWeight: "900",
    includeFontPadding: false,
  },
  assistantTail: {
    position: "absolute",
    borderRightWidth: 2,
    borderBottomWidth: 2,
    backgroundColor: "transparent",
    transform: [{ rotate: "35deg" }],
  },

  profileOuter: {
    alignItems: "center",
    justifyContent: "center",
  },
  profileHead: {
    borderWidth: 2,
    marginBottom: 2,
  },
  profileShoulders: {
    borderWidth: 2,
  },
});