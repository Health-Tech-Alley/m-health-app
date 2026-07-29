import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MainTabHeader } from "@/components/MainTabHeader";
import { AppTheme } from "@/constants/theme";
import { ConversationList } from "@/components/messaging/ConversationList";
import { MessageComposer } from "@/components/messaging/MessageComposer";
import { MessageThread } from "@/components/messaging/MessageThread";
import { useTheme } from "@/hooks/use-theme";
import type { SecureConversation, SecureMessage } from "@/components/messaging/types";

const CONVERSATIONS: SecureConversation[] = [];
const MESSAGES_BY_CONVERSATION_ID: Record<string, SecureMessage[]> = {};

export default function SecureMessagingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const themedStyles = useMemo(() => createStyles(theme), [theme]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [composeText, setComposeText] = useState("");

  const selectedConversation = useMemo(
    () => CONVERSATIONS.find((conversation) => conversation.conversationId === selectedConversationId),
    [selectedConversationId],
  );
  const selectedMessages = selectedConversation
    ? MESSAGES_BY_CONVERSATION_ID[selectedConversation.conversationId] ?? []
    : [];

  function handleConversationSelected(conversationId: string) {
    // TODO(Jay): load/decrypt/persist read state outside this UI component.
    setSelectedConversationId(conversationId);
  }

  function handleNewMessagePressed() {
    // TODO(Jay): connect recipient selection and conversation creation outside this UI component.
  }

  function handleComposeTextChanged(text: string) {
    // TODO(Jay): attach compose-text persistence outside this UI component after encrypted storage exists.
    setComposeText(text);
  }

  function handleSendPressed(conversationId: string, body: string) {
    const trimmed = body.trim();
    if (!trimmed) return;
    // TODO(Jay): hand this event to encryption, storage, transport, and delivery acknowledgement modules.
  }

  function handleRetryFailedMessagePressed(messageId: string) {
    // TODO(Jay): connect this callback to retry handling once transport exists.
  }

  function handleMessageActionPressed(messageId: string) {
    // TODO(Jay): connect message actions such as copy, delete, details, or audit metadata outside this UI component.
  }

  return (
    <SafeAreaView style={[styles.safeArea, themedStyles.safeArea]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={[styles.keyboardRoot, themedStyles.safeArea]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={themedStyles.safeArea}
          contentContainerStyle={[styles.content, themedStyles.content]}
        >
          <Pressable
            style={[styles.backButton, themedStyles.backButton]}
            accessibilityRole="button"
            accessibilityLabel="Back to More"
            onPress={() => router.back()}
          >
            <Text style={[styles.backText, themedStyles.backText]}>Back</Text>
          </Pressable>

          <MainTabHeader
            title="Secure Messaging"
            eyebrow="Ready-to-connect scaffold"
            icon="messages"
          />

          <Section title="Conversations">
            <ConversationList
              conversations={CONVERSATIONS}
              selectedConversationId={selectedConversationId}
              onConversationSelected={handleConversationSelected}
              onNewMessagePressed={handleNewMessagePressed}
            />
          </Section>

          <Section title={selectedConversation?.participant.displayName ?? "Message Thread"}>
            <MessageThread
              conversation={selectedConversation}
              messages={selectedMessages}
              onRetryFailedMessagePressed={handleRetryFailedMessagePressed}
              onMessageActionPressed={handleMessageActionPressed}
            />
          </Section>

          <Section title="Compose">
            <MessageComposer
              value={composeText}
              disabled={!selectedConversation}
              onComposeTextChanged={handleComposeTextChanged}
              onSendPressed={() => {
                if (selectedConversation) {
                  handleSendPressed(selectedConversation.conversationId, composeText);
                }
              }}
            />
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const themedStyles = createStyles(useTheme());

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>{title}</Text>
      <View style={[styles.sectionCard, themedStyles.sectionCard]}>{children}</View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { backgroundColor: theme.appBackground },
    content: { backgroundColor: theme.appBackground },
    backButton: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    backText: {
      color: theme.appBackground === "#000000" ? theme.appText : AppTheme.colors.brand,
    },
    sectionTitle: { color: theme.appSectionText },
    sectionCard: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
  });
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
  },
  keyboardRoot: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 40,
  },
  backButton: {
    alignSelf: "flex-start",
    borderRadius: AppTheme.radius.pill,
    backgroundColor: AppTheme.colors.white,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 12,
  },
  backText: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: "900",
  },
  notice: {
    borderWidth: 1,
    borderColor: "#FBBF24",
    backgroundColor: "#FFFBEB",
    borderRadius: 14,
    padding: 14,
    marginBottom: 22,
  },
  noticeTitle: {
    color: "#92400E",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  noticeText: {
    color: "#92400E",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    marginTop: 4,
  },
  section: {
    marginBottom: 22,
  },
  sectionTitle: {
    color: AppTheme.colors.sectionText,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  sectionCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 14,
    gap: 12,
    overflow: "hidden",
    ...AppTheme.shadow,
  },
});
