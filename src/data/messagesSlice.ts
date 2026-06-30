import { socketClient } from '@/data/SocketClient';
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { SecureMessagingRepository } from './repositories/SecureMessagingRepository';
import { SecureMessagingService } from './SecureMessagingService';

interface MessagesState {
    chatFeed: Array<{ id: string; text: string; status: string }>;
    isNetworkOnline: boolean;
    syncInProgress: boolean;
}

const initialState: MessagesState = {
    chatFeed: [],
    isNetworkOnline: true,
    syncInProgress: false,
};

export const dispatchProductionMessage = createAsyncThunk(
    'messages/dispatchProduction',
    async ({ text, recipientId }: { text: string; recipientId: string }, { dispatch, getState }) => {
        const messageId = Math.random().toString(36).substring(7);

        const nextSequence = SecureMessagingRepository.getNextSequenceNumber(recipientId);

        const signalBundle = await SecureMessagingService.encryptProductionBundle(text, recipientId, nextSequence);

        SecureMessagingRepository.queueSecureMessage({
            message_id: messageId,
            recipient_id: recipientId,
            ephemeral_public_key: signalBundle.ephemeralPublicKey,
            sequence_number: signalBundle.sequenceNumber,
            ciphertext: signalBundle.ciphertext,
            auth_tag: signalBundle.authTag,
        });

        dispatch(appendMessageToFeed({ id: messageId, text, status: 'QUEUED' }));

        const state = getState() as { messages: MessagesState };
        if (state.messages.isNetworkOnline) {
            dispatch(processFlushQueue());
        }
    }
);

export const processFlushQueue = createAsyncThunk(
    'messages/flushQueue',
    async (_, { dispatch, getState }) => {
        const state = getState() as { messages: MessagesState };
        if (state.messages.syncInProgress || !state.messages.isNetworkOnline) return;

        dispatch(setSyncProgress(true));

        try {
            const pendingQueue = SecureMessagingRepository.getPendingQueue();

            for (const msg of pendingQueue) {
                const outboundSignalFrame = {
                    messageId: msg.message_id,
                    recipientId: msg.recipient_id,
                    ephemeralPublicKey: msg.ephemeral_public_key,
                    sequenceNumber: msg.sequence_number,
                    ciphertext: msg.ciphertext,
                    authTag: msg.auth_tag
                };

                const deliveryAck = await socketClient.emitPayload('signal_transmission_channel', outboundSignalFrame);

                if (deliveryAck.success) {
                    SecureMessagingRepository.markAsSynced(msg.message_id);
                    dispatch(updateMessageStatus({ id: msg.message_id, status: 'DELIVERED' }));
                } else {
                    break;
                }
            }
        } catch (error) {
            console.error("Critical signaling transmission collapse: ", error);
        } finally {
            dispatch(setSyncProgress(false));
        }
    }
);

export const changeNetworkState = createAsyncThunk(
    'messages/changeNetworkState',
    async (isOnline: boolean, { dispatch }) => {
        dispatch(setNetworkState(isOnline));
        if (isOnline) {
            dispatch(processFlushQueue());
        }
    }
);

const messagesSlice = createSlice({
    name: 'messages',
    initialState,
    reducers: {
        setNetworkState: (state, action: PayloadAction<boolean>) => { state.isNetworkOnline = action.payload; },
        setSyncProgress: (state, action: PayloadAction<boolean>) => { state.syncInProgress = action.payload; },
        appendMessageToFeed: (state, action: PayloadAction<{ id: string; text: string; status: string }>) => { state.chatFeed.push(action.payload); },
        updateMessageStatus: (state, action: PayloadAction<{ id: string; status: string }>) => {
            const target = state.chatFeed.find(m => m.id === action.payload.id);
            if (target) target.status = action.payload.status;
        }
    }
});

export const { setNetworkState, setSyncProgress, appendMessageToFeed, updateMessageStatus } = messagesSlice.actions;
export default messagesSlice.reducer;