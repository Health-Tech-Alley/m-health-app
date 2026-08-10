import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/hooks/use-translation";
import type { SecureConversation, SecureMessage } from "@/components/messaging/types";
import type { AppLocale, TranslateFn } from "@/localization/i18n";

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
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createStyles(theme), [theme]);

  if (!conversation) {
    return (
      <View style={[styles.emptyState, themedStyles.emptyState]}>
        <Text style={[styles.emptyTitle, themedStyles.emptyTitle]}>{t("messaging.thread.emptyNoSelectionTitle")}</Text>
        <Text style={[styles.emptyText, themedStyles.emptyText]}>{t("messaging.thread.emptyNoSelectionBody")}</Text>
      </View>
    );
  }

  if (messages.length === 0) {
    return (
      <View style={[styles.emptyState, themedStyles.emptyState]}>
        <Text style={[styles.emptyTitle, themedStyles.emptyTitle]}>{t("messaging.thread.emptyNoMessagesTitle")}</Text>
        <Text style={[styles.emptyText, themedStyles.emptyText]}>{t("messaging.thread.emptyNoMessagesBody")}</Text>
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
  const { t, locale } = useTranslation();
  const themedStyles = useMemo(() => createStyles(theme), [theme]);
  const outgoing = message.direction === "outgoing";
  const senderLabel = outgoing ? t("messaging.thread.sender.you") : participantName;
  return (
    <View style={[styles.bubbleWrap, outgoing ? styles.outgoingWrap : styles.incomingWrap]}>
      <Pressable
        style={[
          styles.bubble,
          outgoing ? styles.outgoingBubble : styles.incomingBubble,
          !outgoing && themedStyles.incomingBubble,
        ]}
        accessibilityRole="button"
        accessibilityLabel={t("messaging.thread.messageFromA11y", { sender: senderLabel })}
        onPress={() => onMessageActionPressed(message.messageId)}
      >
        <Text style={[styles.sender, outgoing ? styles.outgoingText : styles.incomingSender, !outgoing && themedStyles.incomingSender]}>
          {senderLabel}
        </Text>
        <Text style={[styles.body, outgoing ? styles.outgoingText : styles.incomingText, !outgoing && themedStyles.incomingText]}>
          {message.body}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.meta, outgoing ? styles.outgoingMeta : styles.incomingMeta, !outgoing && themedStyles.incomingMeta]}>
            {t("messaging.thread.deliveryMeta", {
              time: formatMessageTime(message.createdAt, locale),
              status: formatDeliveryState(message.deliveryState, t),
            })}
          </Text>
          {message.deliveryState === "failed" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("messaging.thread.retryFailedA11y")}
              onPress={() => onRetryFailedMessagePressed(message.messageId)}
            >
              <Text style={styles.retryText}>{t("common.retry")}</Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

function formatMessageTime(value: string, locale: AppLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

function formatDeliveryState(
  value: SecureMessage["deliveryState"],
  t: TranslateFn,
) {
  if (value === "sending") return t("messaging.delivery.sending");
  if (value === "sent") return t("messaging.delivery.sent");
  if (value === "delivered") return t("messaging.delivery.delivered");
  if (value === "read") return t("messaging.delivery.read");
  if (value === "failed") return t("messaging.delivery.failed");
  return value;
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
