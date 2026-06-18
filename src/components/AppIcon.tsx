import { StyleSheet, Text } from "react-native";

import { AppTheme } from "@/constants/theme";

export type AppIconName =
  | "home"
  | "care"
  | "pill"
  | "schedule"
  | "assistant"
  | "profile"
  | "more"
  | "settings"
  | "appearance"
  | "developer"
  | "performance"
  | "messages"
  | "device"
  | "doctor"
  | "calendarPlus"
  | "alert"
  | "heart"
  | "resp"
  | "spo2"
  | "mobility"
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
  return (
    <Text style={[styles.emojiIcon, { fontSize: size, color }]}>
      {getIconLabel(name)}
    </Text>
  );
}

function getIconLabel(name: AppIconName): string {
  switch (name) {
    case "home":
      return "🏠";
    case "care":
      return "❤️";
    case "pill":
      return "💊";
    case "schedule":
      return "📅";
    case "assistant":
      return "🤖";
    case "profile":
      return "👤";
    case "more":
    case "settings":
      return "⚙️";
    case "appearance":
      return "🎨";
    case "developer":
      return "🧪";
    case "performance":
      return "📊";
    case "messages":
      return "💬";
    case "device":
      return "⌚";
    case "doctor":
      return "🧑‍⚕️";
    case "calendarPlus":
      return "🗓️";
    case "alert":
      return "🚨";
    case "heart":
      return "❤️";
    case "resp":
      return "🌬️";
    case "spo2":
      return "🫁";
    case "mobility":
      return "🚶";
    case "note":
      return "📝";
    case "provider":
      return "🧑‍⚕️";
    case "bell":
      return "🔔";
    case "check":
      return "✅";
    case "plus":
      return "➕";
    case "chevronRight":
      return "›";
    default:
      return "•";
  }
}

const styles = StyleSheet.create({
  emojiIcon: {
    fontWeight: "900",
    textAlign: "center",
    includeFontPadding: false,
  },
});
