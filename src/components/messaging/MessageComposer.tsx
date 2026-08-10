import { useMemo } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { AppTheme } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/hooks/use-translation";

export function MessageComposer({
  value,
  disabled,
  onComposeTextChanged,
  onSendPressed,
}: {
  value: string;
  disabled?: boolean;
  onComposeTextChanged: (text: string) => void;
  onSendPressed: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createStyles(theme), [theme]);
  const sendDisabled = disabled || value.trim().length === 0;

  return (
    <View style={[styles.composer, themedStyles.composer]}>
      <TextInput
        style={[styles.input, themedStyles.input]}
        value={value}
        onChangeText={onComposeTextChanged}
        placeholder={t("messaging.compose.placeholder")}
        placeholderTextColor={theme.appTextMuted}
        multiline
        accessibilityLabel={t("messaging.compose.inputA11y")}
        editable={!disabled}
      />
      <Pressable
        style={[styles.sendButton, sendDisabled && styles.sendButtonDisabled, sendDisabled && themedStyles.sendButtonDisabled]}
        disabled={sendDisabled}
        accessibilityRole="button"
        accessibilityLabel={t("messaging.compose.sendA11y")}
        accessibilityState={{ disabled: sendDisabled }}
        onPress={onSendPressed}
      >
        <Text style={styles.sendButtonText}>{t("messaging.compose.send")}</Text>
      </Pressable>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    composer: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    input: {
      color: theme.appText,
    },
    sendButtonDisabled: {
      backgroundColor: theme.appBorder,
    },
  });
}

const styles = StyleSheet.create({
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: 16,
    backgroundColor: AppTheme.colors.white,
    padding: 10,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 112,
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sendButton: {
    minHeight: 42,
    borderRadius: 13,
    backgroundColor: AppTheme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  sendButtonDisabled: {
    backgroundColor: AppTheme.colors.border,
  },
  sendButtonText: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: "900",
  },
});
