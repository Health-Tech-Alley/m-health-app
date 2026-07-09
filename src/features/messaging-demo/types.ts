import type { SecureMessage } from '@/features/messaging/types';

export type DemoStatus = 'idle' | 'encrypting' | 'stored' | 'decrypting' | 'displayed' | 'error';

export interface MessageDemoEntry {
  id: string;
  plaintext: string;
  ciphertextPreview: string;
  iv: string;
  authTag: string;
  status: DemoStatus;
  createdAt: number;
}

export interface MessagingDemoState {
  composeText: string;
  entries: MessageDemoEntry[];
  dbRowCount: number;
  decryptedMessages: SecureMessage[];
  statusMessage: string | null;
  error: string | null;
}

export type MessagingDemoAction =
  | { type: 'set-compose'; payload: { text: string } }
  | { type: 'encrypt-start'; payload: { plaintext: string } }
  | { type: 'encrypt-success'; payload: { entry: MessageDemoEntry } }
  | { type: 'store-success'; payload: { rowCount: number } }
  | { type: 'decrypt-start' }
  | { type: 'decrypt-success'; payload: { messages: SecureMessage[]; rowCount: number } }
  | { type: 'seed-success'; payload: { rowCount: number; count: number } }
  | { type: 'reset-success' }
  | { type: 'error'; payload: { error: string } }
  | { type: 'clear-status' }
  | { type: 'reset' };

export function reducer(state: MessagingDemoState, action: MessagingDemoAction): MessagingDemoState {
  switch (action.type) {
    case 'set-compose':
      return { ...state, composeText: action.payload.text };
    case 'encrypt-start':
      return { ...state, statusMessage: 'Encrypting…' };
    case 'encrypt-success':
      return {
        ...state,
        entries: [action.payload.entry, ...state.entries],
        statusMessage: 'Encrypted and stored',
      };
    case 'store-success':
      return { ...state, dbRowCount: action.payload.rowCount };
    case 'decrypt-start':
      return { ...state, statusMessage: 'Decrypting…' };
    case 'decrypt-success':
      return {
        ...state,
        decryptedMessages: action.payload.messages,
        dbRowCount: action.payload.rowCount,
        statusMessage: `Decrypted ${action.payload.messages.length} message(s)`,
      };
    case 'seed-success':
      return {
        ...state,
        dbRowCount: action.payload.rowCount,
        statusMessage: `Seeded ${action.payload.count} demo messages`,
      };
    case 'reset-success':
      return {
        ...state,
        entries: [],
        decryptedMessages: [],
        dbRowCount: 0,
        statusMessage: 'Demo data cleared',
      };
    case 'error':
      return { ...state, error: action.payload.error, statusMessage: null };
    case 'clear-status':
      return { ...state, statusMessage: null, error: null };
    case 'reset':
      return initialState;
    default:
      return state;
  }
}

export const initialState: MessagingDemoState = {
  composeText: '',
  entries: [],
  dbRowCount: 0,
  decryptedMessages: [],
  statusMessage: null,
  error: null,
};
