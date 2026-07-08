import { useCallback, useReducer } from 'react';

import {
  encryptAndStore,
  loadAndDecryptAll,
  resetDemoData,
  seedDemoMessages,
} from './messaging-demo-controller';
import { MessagingDemoView } from './messaging-demo-view';
import { initialState, reducer } from './types';

export function MessagingDemoScreen() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const handleSend = useCallback(async () => {
    if (!state.composeText.trim()) return;
    dispatch({ type: 'encrypt-start', payload: { plaintext: state.composeText } });
    try {
      const { ciphertext, iv, authTag, rowCount } = await encryptAndStore(state.composeText);
      dispatch({
        type: 'encrypt-success',
        payload: {
          entry: {
            id: `entry-${Date.now()}`,
            plaintext: state.composeText,
            ciphertextPreview: ciphertext,
            iv,
            authTag,
            status: 'stored',
            createdAt: Date.now(),
          },
        },
      });
      dispatch({ type: 'store-success', payload: { rowCount } });
      dispatch({ type: 'set-compose', payload: { text: '' } });
    } catch (err) {
      dispatch({ type: 'error', payload: { error: err instanceof Error ? err.message : 'Encrypt failed' } });
    }
  }, [state.composeText]);

  const handleReload = useCallback(async () => {
    dispatch({ type: 'decrypt-start' });
    try {
      const { messages, rowCount } = await loadAndDecryptAll();
      dispatch({ type: 'decrypt-success', payload: { messages, rowCount } });
    } catch (err) {
      dispatch({ type: 'error', payload: { error: err instanceof Error ? err.message : 'Decrypt failed' } });
    }
  }, []);

  const handleSeed = useCallback(async () => {
    try {
      const { rowCount, count } = await seedDemoMessages();
      dispatch({ type: 'seed-success', payload: { rowCount, count } });
    } catch (err) {
      dispatch({ type: 'error', payload: { error: err instanceof Error ? err.message : 'Seed failed' } });
    }
  }, []);

  const handleReset = useCallback(() => {
    resetDemoData();
    dispatch({ type: 'reset-success' });
  }, []);

  return (
    <MessagingDemoView
      state={state}
      dispatch={dispatch}
      onSend={handleSend}
      onReload={handleReload}
      onSeed={handleSeed}
      onReset={handleReset}
    />
  );
}
