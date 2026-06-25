export type MessageDeliveryState =
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export type SecureMessageParticipant = {
  participantId: string;
  displayName: string;
  role: string;
};

export type SecureMessage = {
  messageId: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  direction: "incoming" | "outgoing";
  deliveryState: MessageDeliveryState;
};

export type SecureConversation = {
  conversationId: string;
  participant: SecureMessageParticipant;
  latestMessagePreview?: string;
  latestMessageAt?: string;
  unreadCount?: number;
  deliveryState?: MessageDeliveryState;
};

export type MessagingEventHandlers = {
  onConversationSelected: (conversationId: string) => void;
  onNewMessagePressed: () => void;
  onComposeTextChanged: (text: string) => void;
  onSendPressed: (conversationId: string, body: string) => void;
  onRetryFailedMessagePressed: (messageId: string) => void;
  onMessageActionPressed: (messageId: string) => void;
};

export type MessagingIntegrationBoundary = {
  loadConversations: () => Promise<SecureConversation[]>;
  loadMessages: (conversationId: string) => Promise<SecureMessage[]>;
  encryptMessage: (plainText: string, conversationId: string) => Promise<string>;
  decryptMessage: (cipherText: string, conversationId: string) => Promise<string>;
  sendMessage: (conversationId: string, encryptedBody: string) => Promise<void>;
  persistMessage: (message: SecureMessage) => Promise<void>;
  handleDeliveryAcknowledgement: (
    messageId: string,
    deliveryState: MessageDeliveryState,
  ) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
};
