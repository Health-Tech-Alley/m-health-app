import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "@/constants/theme";
import type { SecureConversation } from "@/features/messaging/types";

export function ConversationList({
  conversations,
  selectedConversationId,
  onConversationSelected,
  onNewMessagePressed,
}: {
  conversations: SecureConversation[];
  selectedConversationId?: string;
  onConversationSelected: (conversationId: string) => void;
  onNewMessagePressed: () => void;
}) {
  if (conversations.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No conversations available</Text>
        <Text style={styles.emptyText}>
          Connect conversation retrieval to show care-team threads here.
        </Text>
        <Pressable
          style={styles.newMessageButton}
          accessibilityRole="button"
          accessibilityLabel="Start a new message"
          onPress={onNewMessagePressed}
        >
          <Text style={styles.newMessageButtonText}>New message</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {conversations.map((conversation) => {
        const selected = conversation.conversationId === selectedConversationId;
        return (
          <Pressable
            key={conversation.conversationId}
            style={[styles.row, selected && styles.rowSelected]}
            accessibilityRole="button"
            accessibilityLabel={`Open conversation with ${conversation.participant.displayName}`}
            onPress={() => onConversationSelected(conversation.conversationId)}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(conversation.participant.displayName)}</Text>
            </View>

            <View style={styles.content}>
              <View style={styles.titleRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {conversation.participant.displayName}
                </Text>
                {conversation.latestMessageAt ? (
                  <Text style={styles.timestamp}>{formatShortTime(conversation.latestMessageAt)}</Text>
                ) : null}
              </View>
              <Text style={styles.role}>{conversation.participant.role}</Text>
              {conversation.latestMessagePreview ? (
                <Text style={styles.preview} numberOfLines={2}>
                  {conversation.latestMessagePreview}
                </Text>
              ) : null}
              {conversation.deliveryState ? (
                <Text style={[styles.delivery, conversation.deliveryState === "failed" && styles.deliveryFailed]}>
                  {formatDeliveryState(conversation.deliveryState)}
                </Text>
              ) : null}
            </View>

            {(conversation.unreadCount ?? 0) > 0 ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{conversation.unreadCount}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatShortTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDeliveryState(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  list: {
    gap: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: 12,
    backgroundColor: AppTheme.colors.white,
    padding: 12,
  },
  rowSelected: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: AppTheme.colors.softSurface,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
  },
  content: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  timestamp: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
  },
  role: {
    color: AppTheme.colors.brand,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 2,
  },
  preview: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 4,
  },
  delivery: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 5,
  },
  deliveryFailed: {
    color: AppTheme.colors.danger,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: AppTheme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  unreadText: {
    color: AppTheme.colors.white,
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
  newMessageButton: {
    alignSelf: "flex-start",
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12,
  },
  newMessageButtonText: {
    color: AppTheme.colors.white,
    fontSize: 13,
    fontWeight: "900",
  },
});
