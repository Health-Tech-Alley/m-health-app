import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { SecureConversation, SecureMessage } from "@/components/messaging/types";

export function MessageThread({
  conversation,
  messages,
  onRetryFailedMessagePressed,
  onMessageActionPressed,
}: {
  conversation?: SecureConversation;
  messages: SecureMessage[];
  onRetryFailedMessagePressed: (messageId: string) => void;
  onMessageActionPressed: (messageId: string) => void;
}) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createStyles(theme), [theme]);

  if (!conversation) {
    return (
      <View style={[styles.emptyState, themedStyles.emptyState]}>
        <Text style={[styles.emptyTitle, themedStyles.emptyTitle]}>No conversation selected</Text>
        <Text style={[styles.emptyText, themedStyles.emptyText]}>Choose a conversation or start a new message when messaging is connected.</Text>
      </View>
    );
  }

  if (messages.length === 0) {
    return (
      <View style={[styles.emptyState, themedStyles.emptyState]}>
        <Text style={[styles.emptyTitle, themedStyles.emptyTitle]}>No messages yet</Text>
        <Text style={[styles.emptyText, themedStyles.emptyText]}>Messages will appear here after retrieval is connected.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.thread, themedStyles.thread]} contentContainerStyle={styles.threadContent}>
      {messages.map((message) => (
        <MessageBubble
          key={message.messageId}
          message={message}
          participantName={conversation.participant.displayName}
          onRetryFailedMessagePressed={onRetryFailedMessagePressed}
          onMessageActionPressed={onMessageActionPressed}
        />
      ))}
    </ScrollView>
  );
}

function MessageBubble({
  message,
  participantName,
  onRetryFailedMessagePressed,
  onMessageActionPressed,
}: {
  message: SecureMessage;
  participantName: string;
  onRetryFailedMessagePressed: (messageId: string) => void;
  onMessageActionPressed: (messageId: string) => void;
}) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createStyles(theme), [theme]);
  const outgoing = message.direction === "outgoing";
  return (
    <View style={[styles.bubbleWrap, outgoing ? styles.outgoingWrap : styles.incomingWrap]}>
      <Pressable
        style={[
          styles.bubble,
          outgoing ? styles.outgoingBubble : styles.incomingBubble,
          !outgoing && themedStyles.incomingBubble,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Message from ${outgoing ? "you" : participantName}`}
        onPress={() => onMessageActionPressed(message.messageId)}
      >
        <Text style={[styles.sender, outgoing ? styles.outgoingText : styles.incomingSender, !outgoing && themedStyles.incomingSender]}>
          {outgoing ? "You" : participantName}
        </Text>
        <Text style={[styles.body, outgoing ? styles.outgoingText : styles.incomingText, !outgoing && themedStyles.incomingText]}>
          {message.body}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.meta, outgoing ? styles.outgoingMeta : styles.incomingMeta, !outgoing && themedStyles.incomingMeta]}>
            {formatMessageTime(message.createdAt)} - {formatDeliveryState(message.deliveryState)}
          </Text>
          {message.deliveryState === "failed" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry failed message"
              onPress={() => onRetryFailedMessagePressed(message.messageId)}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDeliveryState(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function createStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    thread: {
      backgroundColor: theme.appSurface,
    },
    incomingBubble: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    incomingSender: {
      color: theme.appTextSupporting,
    },
    incomingText: {
      color: theme.appText,
    },
    incomingMeta: {
      color: theme.appTextMuted,
    },
    emptyState: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    emptyTitle: { color: theme.appText },
    emptyText: { color: theme.appTextSupporting },
  });
}

const styles = StyleSheet.create({
  thread: {
    maxHeight: 360,
  },
  threadContent: {
    paddingVertical: 4,
    gap: 10,
  },
  bubbleWrap: {
    width: "100%",
  },
  incomingWrap: {
    alignItems: "flex-start",
  },
  outgoingWrap: {
    alignItems: "flex-end",
  },
  bubble: {
    maxWidth: "86%",
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  incomingBubble: {
    backgroundColor: AppTheme.colors.white,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  outgoingBubble: {
    backgroundColor: AppTheme.colors.brand,
  },
  sender: {
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 4,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  incomingSender: {
    color: AppTheme.colors.brand,
  },
  incomingText: {
    color: AppTheme.colors.text,
  },
  outgoingText: {
    color: AppTheme.colors.white,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 7,
  },
  meta: {
    fontSize: 11,
    fontWeight: "800",
  },
  incomingMeta: {
    color: AppTheme.colors.textMuted,
  },
  outgoingMeta: {
    color: "#E0F2FE",
  },
  retryText: {
    color: AppTheme.colors.danger,
    fontSize: 11,
    fontWeight: "900",
  },
  emptyState: {
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: 12,
    backgroundColor: AppTheme.colors.white,
    padding: 16,
  },
  emptyTitle: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  emptyText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    marginTop: 5,
  },
});
