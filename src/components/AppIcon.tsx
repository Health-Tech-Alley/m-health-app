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
  | "edit"
  | "delete"
  | "walking"
  | "mobilityAid"
  | "wheelchair"
  | "walk-independent"
  | "walk-limited"
  | "walker"
  | "crutches"
  | "cane"
  | "wheelchair-manual"
  | "wheelchair-powered"
  | "assisted-walking"
  | "transport-wheelchair"
  | "all-surfaces"
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
    <Text
      style={[styles.emojiIcon, { fontSize: size, color }]}
      accessible={false}
      importantForAccessibility="no"
    >
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
      return "🤝";
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
    case "provider":
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
    case "walking":
    case "walk-independent":
      return "🚶";
    case "walk-limited":
      return "🚶‍➡️";
    case "mobilityAid":
    case "walker":
    case "cane":
      return "🦯";
    case "crutches":
      return "🩼";
    case "wheelchair":
    case "wheelchair-manual":
    case "transport-wheelchair":
      return "🦽";
    case "wheelchair-powered":
      return "🦼";
    case "assisted-walking":
      return "🧑‍🤝‍🧑";
    case "all-surfaces":
      return "🥾";
    case "note":
      return "📝";
    case "bell":
      return "🔔";
    case "check":
      return "✅";
    case "plus":
      return "➕";
    case "edit":
      return "✏️";
    case "delete":
      return "🗑️";
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
