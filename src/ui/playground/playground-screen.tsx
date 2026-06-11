import { useCallback, useMemo, useReducer } from 'react';

import { LlamaRnProvider } from '@/inference/llama-rn-provider';
import { createController } from './playground-controller';
import type { PlaygroundAction, PlaygroundState } from './types';
import { PlaygroundView } from './playground-view';

const initialState: PlaygroundState = {
  loadStatus: 'idle',
  loadError: null,
  selectedModelId: null,
  runStatus: 'idle',
  messages: [],
};

function reducer(state: PlaygroundState, action: PlaygroundAction): PlaygroundState {
  switch (action.type) {
    case 'noop':
      return state;

    case 'select-model-start':
      return {
        ...state,
        loadStatus: 'loading',
        loadError: null,
        messages: [],
        runStatus: 'idle',
      };

    case 'select-model-success':
      return {
        ...state,
        loadStatus: 'ready',
        loadError: null,
        selectedModelId: action.payload.modelId,
        messages: [],
        runStatus: 'idle',
      };

    case 'select-model-error':
      return {
        ...state,
        loadStatus: 'error',
        loadError: action.payload.error,
        selectedModelId: null,
        messages: [],
        runStatus: 'idle',
      };

    case 'send-start':
      return {
        ...state,
        runStatus: 'streaming',
        messages: [
          ...state.messages,
          action.payload.userMessage,
          action.payload.assistantMessage,
        ],
      };

    case 'send-success': {
      const messages = state.messages.map((m) =>
        m.id === action.payload.assistantId
          ? {
              ...m,
              text: action.payload.finalText,
              finalText: action.payload.finalText,
              status: 'done' as const,
              finishedAt: Date.now(),
            }
          : m,
      );
      return {
        ...state,
        runStatus: 'done',
        messages,
      };
    }

    case 'send-stopped': {
      const messages = state.messages.map((m) =>
        m.id === action.payload.assistantId
          ? {
              ...m,
              status: 'stopped' as const,
              finishedAt: Date.now(),
            }
          : m,
      );
      return {
        ...state,
        runStatus: 'stopped',
        messages,
      };
    }

    case 'send-error': {
      const messages = state.messages.map((m) =>
        m.id === action.payload.assistantId
          ? {
              ...m,
              status: 'error' as const,
              finishedAt: Date.now(),
            }
          : m,
      );
      return {
        ...state,
        runStatus: 'error',
        messages,
      };
    }

    case 'append-token': {
      const messages = state.messages.map((m) =>
        m.id === action.payload.assistantId
          ? { ...m, text: m.text + action.payload.token }
          : m,
      );
      return { ...state, messages };
    }

    case 'new-conversation':
      return {
        ...state,
        runStatus: 'idle',
        messages: [],
      };

    default:
      return state;
  }
}

export function PlaygroundScreen() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const provider = useMemo(() => new LlamaRnProvider(), []);
  const controller = useMemo(() => createController(provider), [provider]);

  const wrappedDispatch = useCallback(
    (action: PlaygroundAction) => {
      if (action.type === 'send-start') {
        const { userMessage, assistantMessage, run } = action.payload;

        dispatch({
          type: 'send-start',
          payload: { userMessage, assistantMessage, run },
        });

        run((token) => {
          dispatch(controller.appendToken(assistantMessage.id, token));
        }).then((finalAction) => {
          dispatch(finalAction);
        });
        return;
      }

      if (action.type === 'select-model-start') {
        dispatch(action);

        action.payload().then((resultAction) => {
          dispatch(resultAction);
        });
        return;
      }

      dispatch(action);
    },
    [controller, dispatch],
  );

  return (
    <PlaygroundView state={state} dispatch={wrappedDispatch} controller={controller} />
  );
}
