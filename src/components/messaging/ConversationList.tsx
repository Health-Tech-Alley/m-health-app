import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/hooks/use-translation";
import type { SecureConversation } from "@/components/messaging/types";
import type { AppLocale, TranslateFn } from "@/localization/i18n";

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
  const theme = useTheme();
  const { t, locale } = useTranslation();
  const themedStyles = useMemo(() => createStyles(theme), [theme]);

  if (conversations.length === 0) {
    return (
      <View style={[styles.emptyState, themedStyles.emptyState]}>
        <Text style={[styles.emptyTitle, themedStyles.emptyTitle]}>{t("messaging.conversations.emptyTitle")}</Text>
        <Text style={[styles.emptyText, themedStyles.emptyText]}>
          {t("messaging.conversations.emptyBody")}
        </Text>
        <Pressable
          style={styles.newMessageButton}
          accessibilityRole="button"
          accessibilityLabel={t("messaging.newMessageA11y")}
          onPress={onNewMessagePressed}
        >
          <Text style={styles.newMessageButtonText}>{t("messaging.newMessage")}</Text>
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
            style={[styles.row, themedStyles.row, selected && styles.rowSelected, selected && themedStyles.rowSelected]}
            accessibilityRole="button"
            accessibilityLabel={t("messaging.conversations.openA11y", {
              name: conversation.participant.displayName,
            })}
            onPress={() => onConversationSelected(conversation.conversationId)}
          >
            <View style={[styles.avatar, themedStyles.avatar]}>
              <Text style={[styles.avatarText, themedStyles.avatarText]}>{getInitials(conversation.participant.displayName)}</Text>
            </View>

            <View style={styles.content}>
              <View style={styles.titleRow}>
                <Text style={[styles.name, themedStyles.name]} numberOfLines={1}>
                  {conversation.participant.displayName}
                </Text>
                {conversation.latestMessageAt ? (
                  <Text style={[styles.timestamp, themedStyles.timestamp]}>{formatShortTime(conversation.latestMessageAt, locale)}</Text>
                ) : null}
              </View>
              <Text style={[styles.role, themedStyles.role, selected && themedStyles.roleSelected]}>{conversation.participant.role}</Text>
              {conversation.latestMessagePreview ? (
                <Text style={[styles.preview, themedStyles.preview]} numberOfLines={2}>
                  {conversation.latestMessagePreview}
                </Text>
              ) : null}
              {conversation.deliveryState ? (
                <Text
                  style={[
                    styles.delivery,
                    themedStyles.delivery,
                    conversation.deliveryState === "failed" && styles.deliveryFailed,
                  ]}
                >
                  {formatDeliveryState(conversation.deliveryState, t)}
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

function formatShortTime(value: string, locale: AppLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function formatDeliveryState(
  value: NonNullable<SecureConversation["deliveryState"]>,
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
  const isDark = theme.appBackground === "#000000";

  return StyleSheet.create({
    row: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    rowSelected: {
      backgroundColor: theme.appBrandSoftSurface,
      borderColor: AppTheme.colors.brand,
    },
    avatar: {
      backgroundColor: theme.appControlSurface,
    },
    avatarText: {
      color: isDark ? theme.appText : AppTheme.colors.brand,
    },
    name: { color: theme.appText },
    timestamp: { color: theme.appTextMuted },
    role: { color: isDark ? theme.appTextSupporting : AppTheme.colors.brand },
    roleSelected: { color: isDark ? theme.appText : AppTheme.colors.brand },
    preview: { color: theme.appTextSupporting },
    delivery: { color: theme.appTextMuted },
    emptyState: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    emptyTitle: { color: theme.appText },
    emptyText: { color: theme.appTextSupporting },
  });
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
