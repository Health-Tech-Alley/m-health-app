import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { AppTheme } from "@/constants/theme";

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
  const sendDisabled = disabled || value.trim().length === 0;

  return (
    <View style={styles.composer}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onComposeTextChanged}
        placeholder="Type a message"
        placeholderTextColor={AppTheme.colors.textMuted}
        multiline
        accessibilityLabel="Message text"
        editable={!disabled}
      />
      <Pressable
        style={[styles.sendButton, sendDisabled && styles.sendButtonDisabled]}
        disabled={sendDisabled}
        accessibilityRole="button"
        accessibilityLabel="Send message"
        onPress={onSendPressed}
      >
        <Text style={styles.sendButtonText}>Send</Text>
      </Pressable>
    </View>
  );
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
