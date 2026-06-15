/**
 * Reusable card for the dashboard's main app functions.
 *
 * This component represents one menu area of the caregiver app:
 * medication, care, scheduling, assistant support, or performance.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";

type FeatureTone = "teal" | "red" | "green" | "gray";

type MainFeatureCardProps = {
  title: string;
  subtitle: string;
  status: string;
  buttonLabel: string;
  tone?: FeatureTone;
  iconLabel?: string;
  onPress?: () => void;
};

export function MainFeatureCard({
  title,
  subtitle,
  status,
  buttonLabel,
  tone = "teal",
  iconLabel,
  onPress,
}: MainFeatureCardProps) {
  const toneStyles = getToneStyles(tone);

  return (
    <View style={[styles.card, toneStyles.card]}>
      <View style={styles.topRow}>
        <View style={[styles.iconBox, toneStyles.iconBox]}>
          <Text style={[styles.iconText, toneStyles.iconText]}>
            {iconLabel ?? getDefaultIconLabel(tone)}
          </Text>
        </View>

        <View style={styles.textArea}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>

      <View style={[styles.statusPill, toneStyles.statusPill]}>
        <Text style={[styles.statusText, toneStyles.statusText]}>
          {status}
        </Text>
      </View>

      <Pressable style={[styles.button, toneStyles.button]} onPress={onPress}>
        <Text style={styles.buttonText}>{buttonLabel}</Text>
      </Pressable>
    </View>
  );
}

function getDefaultIconLabel(tone: FeatureTone) {
  if (tone === "red") return "!";
  if (tone === "green") return "✓";
  if (tone === "gray") return "AI";
  return "CC";
}

function getToneStyles(tone: FeatureTone) {
  if (tone === "red") {
    return {
      card: {
        borderColor: "#FCA5A5",
        backgroundColor: "#FFF7F7",
      },
      iconBox: {
        backgroundColor: "#FEE2E2",
      },
      iconText: {
        color: "#DC2626",
      },
      statusPill: {
        backgroundColor: "#FEE2E2",
      },
      statusText: {
        color: "#B91C1C",
      },
      button: {
        backgroundColor: "#DC2626",
      },
    };
  }

  if (tone === "green") {
    return {
      card: {
        borderColor: "#BBF7D0",
        backgroundColor: "#F7FEF9",
      },
      iconBox: {
        backgroundColor: "#DCFCE7",
      },
      iconText: {
        color: "#15803D",
      },
      statusPill: {
        backgroundColor: "#DCFCE7",
      },
      statusText: {
        color: "#166534",
      },
      button: {
        backgroundColor: "#16A34A",
      },
    };
  }

  if (tone === "gray") {
    return {
      card: {
        borderColor: "#E4E7EC",
        backgroundColor: "#FFFFFF",
      },
      iconBox: {
        backgroundColor: "#F2F4F7",
      },
      iconText: {
        color: "#475467",
      },
      statusPill: {
        backgroundColor: "#F2F4F7",
      },
      statusText: {
        color: "#475467",
      },
      button: {
        backgroundColor: "#102033",
      },
    };
  }

  return {
    card: {
      borderColor: "#BDEFE7",
      backgroundColor: "#F7FFFC",
    },
    iconBox: {
      backgroundColor: "#EAFBF7",
    },
    iconText: {
      color: "#008573",
    },
    statusPill: {
      backgroundColor: "#EAFBF7",
    },
    statusText: {
      color: "#006B5D",
    },
    button: {
      backgroundColor: "#008573",
    },
  };
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  topRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 14,
  },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    fontSize: 15,
    fontWeight: "900",
  },
  textArea: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#102033",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: "#667085",
  },
  statusPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "800",
  },
  button: {
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
});