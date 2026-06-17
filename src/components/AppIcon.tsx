import { StyleSheet, Text, View } from "react-native";

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
  if (name === "pill") {
    return <PillIcon size={size} color={color} />;
  }

  if (name === "schedule" || name === "calendarPlus") {
    return <ScheduleIcon size={size} color={color} plus={name === "calendarPlus"} />;
  }

  if (name === "assistant") {
    return <AssistantIcon size={size} color={color} />;
  }

  if (name === "profile") {
    return <ProfileIcon size={size} color={color} />;
  }

  if (name === "more") {
    return <MoreIcon size={size} color={color} />;
  }

  if (name === "settings") {
    return <SettingsIcon size={size} color={color} />;
  }

  if (name === "device") {
    return <DeviceIcon size={size} color={color} />;
  }

  if (name === "doctor") {
    return <DoctorIcon size={size} color={color} />;
  }

  if (name === "mobility") {
    return <MobilityIcon size={size} color={color} />;
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

function ScheduleIcon({
  size,
  color,
  plus,
}: {
  size: number;
  color: string;
  plus?: boolean;
}) {
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
        {plus ? (
          <Text
            style={[
              styles.calendarPlus,
              {
                color,
                fontSize: size * 0.48,
              },
            ]}
          >
            +
          </Text>
        ) : (
          <>
            <View style={[styles.calendarDot, { backgroundColor: color }]} />
            <View style={[styles.calendarDot, { backgroundColor: color }]} />
            <View style={[styles.calendarDot, { backgroundColor: color }]} />
            <View style={[styles.calendarDot, { backgroundColor: color }]} />
          </>
        )}
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
    <View style={[styles.profileOuter, { width: size, height: size }]}>
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

function MoreIcon({ size, color }: { size: number; color: string }) {
  const dotSize = size * 0.16;

  return (
    <View style={[styles.moreOuter, { width: size, height: size }]}>
      <View style={[styles.moreDot, { width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: color }]} />
      <View style={[styles.moreDot, { width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: color }]} />
      <View style={[styles.moreDot, { width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: color }]} />
    </View>
  );
}

function SettingsIcon({ size, color }: { size: number; color: string }) {
  return (
    <View
      style={[
        styles.settingsOuter,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: color,
        },
      ]}
    >
      <View
        style={[
          styles.settingsInner,
          {
            width: size * 0.36,
            height: size * 0.36,
            borderRadius: size * 0.18,
            borderColor: color,
          },
        ]}
      />
    </View>
  );
}

function DeviceIcon({ size, color }: { size: number; color: string }) {
  return (
    <View
      style={[
        styles.deviceOuter,
        {
          width: size * 0.72,
          height: size,
          borderRadius: size * 0.18,
          borderColor: color,
        },
      ]}
    >
      <View
        style={[
          styles.deviceButton,
          {
            width: size * 0.22,
            height: size * 0.22,
            borderRadius: size * 0.11,
            backgroundColor: color,
          },
        ]}
      />
    </View>
  );
}

function DoctorIcon({ size, color }: { size: number; color: string }) {
  return (
    <View style={[styles.doctorOuter, { width: size, height: size }]}>
      <View
        style={[
          styles.doctorHead,
          {
            width: size * 0.36,
            height: size * 0.36,
            borderRadius: size * 0.18,
            borderColor: color,
          },
        ]}
      />

      <View
        style={[
          styles.doctorBody,
          {
            width: size * 0.74,
            height: size * 0.36,
            borderRadius: size * 0.16,
            borderColor: color,
          },
        ]}
      />

      <Text
        style={[
          styles.doctorCross,
          {
            color,
            fontSize: size * 0.34,
          },
        ]}
      >
        +
      </Text>
    </View>
  );
}

function MobilityIcon({ size, color }: { size: number; color: string }) {
  return (
    <View style={[styles.mobilityOuter, { width: size, height: size }]}>
      <View
        style={[
          styles.mobilityHead,
          {
            width: size * 0.24,
            height: size * 0.24,
            borderRadius: size * 0.12,
            backgroundColor: color,
          },
        ]}
      />
      <View
        style={[
          styles.mobilityBody,
          {
            width: size * 0.14,
            height: size * 0.42,
            backgroundColor: color,
          },
        ]}
      />
      <View
        style={[
          styles.mobilityLeg,
          {
            width: size * 0.12,
            height: size * 0.32,
            backgroundColor: color,
            transform: [{ rotate: "24deg" }],
          },
        ]}
      />
      <View
        style={[
          styles.mobilityLeg,
          {
            width: size * 0.12,
            height: size * 0.32,
            backgroundColor: color,
            transform: [{ rotate: "-24deg" }],
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
    alignItems: "center",
  },
  calendarDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  calendarPlus: {
    fontWeight: "900",
    includeFontPadding: false,
    lineHeight: 18,
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

  moreOuter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  moreDot: {},

  settingsOuter: {
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsInner: {
    borderWidth: 2,
  },

  deviceOuter: {
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 4,
  },
  deviceButton: {},

  doctorOuter: {
    alignItems: "center",
    justifyContent: "center",
  },
  doctorHead: {
    borderWidth: 2,
    marginBottom: 2,
  },
  doctorBody: {
    borderWidth: 2,
  },
  doctorCross: {
    position: "absolute",
    right: -1,
    bottom: -2,
    fontWeight: "900",
    includeFontPadding: false,
  },

  mobilityOuter: {
    alignItems: "center",
    justifyContent: "center",
  },
  mobilityHead: {
    marginBottom: 1,
  },
  mobilityBody: {
    borderRadius: 999,
    marginBottom: -1,
  },
  mobilityLeg: {
    borderRadius: 999,
    marginHorizontal: 2,
  },
});