/**
 * messagesSlice — Redux state for local encrypted secure messaging.
 *
 * Local-only: encrypt → persist to SQLite → decrypt for display.
 * No transport layer, no flush queue, no socket client.
 */
import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { SecureMessagingRepository } from './repositories/SecureMessagingRepository';
import { SecureMessagingService } from './SecureMessagingService';

export type MessageDirection = 'incoming' | 'outgoing';

export type ChatFeedEntry = {
  id: string;
  text: string;
  direction: MessageDirection;
  status: 'encrypting' | 'stored' | 'decrypting' | 'displayed' | 'failed';
  createdAt: number;
};

interface MessagesState {
  chatFeed: ChatFeedEntry[];
  loading: boolean;
  error: string | null;
}

const initialState: MessagesState = {
  chatFeed: [],
  loading: false,
  error: null,
};

export const sendEncryptedMessage = createAsyncThunk(
  'messages/sendEncrypted',
  async (
    params: {
      text: string;
      patientId: string;
      recipientProviderId: string;
      consentAuditToken: string;
      messageType?: 'CLINICAL_ESCALATION' | 'STANDARD_CHAT';
    },
    { dispatch },
  ) => {
    const messageId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const sequence = Date.now();

    dispatch(
      appendMessageToFeed({
        id: messageId,
        text: params.text,
        direction: 'outgoing',
        status: 'encrypting',
        createdAt: Date.now(),
      }),
    );

    try {
      const encrypted = await SecureMessagingService.encryptMessage(
        params.text,
        sequence,
      );

      SecureMessagingRepository.insertMessage({
        message_id: messageId,
        patient_id: params.patientId,
        recipient_provider_id: params.recipientProviderId,
        encrypted_payload: encrypted.ciphertext,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        ephemeral_public_key: '',
        message_type: params.messageType ?? 'STANDARD_CHAT',
        consent_audit_token: params.consentAuditToken,
      });

      dispatch(
        updateMessageStatus({ id: messageId, status: 'stored' }),
      );
    } catch (error) {
      dispatch(
        updateMessageStatus({ id: messageId, status: 'failed' }),
      );
      throw error;
    }
  },
);

export const loadDecryptedMessages = createAsyncThunk(
  'messages/loadDecrypted',
  async (
    params: { patientId: string; recipientProviderId?: string },
    { dispatch },
  ) => {
    dispatch(setLoading(true));
    try {
      const rows = SecureMessagingRepository.getMessagesForPatient(
        params.patientId,
        params.recipientProviderId,
      );

      for (const row of rows) {
        const decrypted = await SecureMessagingService.decryptMessage({
          ciphertext: row.encrypted_payload,
          authTag: row.auth_tag,
          iv: row.iv,
          sequenceNumber: row.created_at,
        });

        dispatch(
          appendMessageToFeed({
            id: row.message_id,
            text: decrypted,
            direction: 'outgoing',
            status: 'displayed',
            createdAt: row.created_at,
          }),
        );
      }
    } catch (error) {
      dispatch(setError(error instanceof Error ? error.message : 'Failed to load messages'));
    } finally {
      dispatch(setLoading(false));
    }
  },
);

const messagesSlice = createSlice({
  name: 'messages',
  initialState,
  reducers: {
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    appendMessageToFeed: (state, action: PayloadAction<ChatFeedEntry>) => {
      state.chatFeed.push(action.payload);
    },
    updateMessageStatus: (
      state,
      action: PayloadAction<{ id: string; status: ChatFeedEntry['status'] }>,
    ) => {
      const target = state.chatFeed.find((m) => m.id === action.payload.id);
      if (target) target.status = action.payload.status;
    },
    clearFeed: (state) => {
      state.chatFeed = [];
      state.error = null;
    },
  },
});

export const {
  setLoading,
  setError,
  appendMessageToFeed,
  updateMessageStatus,
  clearFeed,
} = messagesSlice.actions;
export default messagesSlice.reducer;
