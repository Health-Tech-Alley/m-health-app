import { useCallback, useMemo, useReducer } from 'react';

import { useSLM } from '@/contexts/slm-context';
import { createController } from './playground-controller';
import type { PlaygroundAction, PlaygroundState } from './types';
import { PlaygroundView } from './playground-view';

// Safety net: strip any leftover structured-output control tokens (harmony
// channels, thinking tags) that may leak into the answer if native parsing
// didn't fully separate them. llama.rn normally handles this, so this only
// runs as a fallback.
function stripControlTokens(text: string): { thinking: string | null; answer: string } {
  // gpt-oss / Gemma "harmony" channel format:
  //   <|channel>thought ... <|channel>final ...
  const channelRegex = /<\|channel\|?>(\w+)\s*([\s\S]*?)(?=<\|channel\|?>|<\|end\|?>|<\|return\|?>|$)/gi;
  const matches = [...text.matchAll(channelRegex)];

  if (matches.length > 0) {
    let thinking = '';
    let answer = '';
    for (const m of matches) {
      const channel = m[1].toLowerCase();
      const body = m[2].replace(/<\|message\|?>/gi, '').trim();
      if (channel === 'final' || channel === 'answer') {
        answer += body;
      } else {
        thinking += (thinking ? '\n\n' : '') + body;
      }
    }
    // Clean any remaining control tokens.
    answer = answer.replace(/<\|[^>]*\|?>/g, '').trim();
    thinking = thinking.replace(/<\|[^>]*\|?>/g, '').trim();
    if (answer) {
      return { thinking: thinking || null, answer };
    }
  }

  // <thinking>...</thinking> tag format.
  const thinkingMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  if (thinkingMatch) {
    const thinking = thinkingMatch[1].trim();
    const answer = text.replace(/<thinking>[\s\S]*?<\/thinking>/i, '').trim();
    return { thinking, answer };
  }

  // No structured markers — return text with any stray control tokens removed.
  const cleaned = text.replace(/<\|[^>]*\|?>/g, '').trim();
  return { thinking: null, answer: cleaned };
}

const initialState: PlaygroundState = {
  runStatus: 'idle',
  messages: [],
};

function reducer(state: PlaygroundState, action: PlaygroundAction): PlaygroundState {
  switch (action.type) {
    case 'noop':
      return state;

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
      const { finalText, reasoningContent } = action.payload;

      // Always run the answer through the control-token stripper as a safety
      // net (handles cases where harmony channels leak past native parsing).
      const parsed = stripControlTokens(finalText);
      const thinking = reasoningContent || parsed.thinking;
      const answer = parsed.answer;

      const messages = state.messages.map((m) =>
        m.id === action.payload.assistantId
          ? {
              ...m,
              text: answer,
              finalText: answer,
              thinking,
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
              finalText: action.payload.error,
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
  const slm = useSLM();
  const [state, dispatch] = useReducer(reducer, initialState);
  const controller = useMemo(() => createController(slm.provider), [slm.provider]);

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

      dispatch(action);
    },
    [controller, dispatch],
  );

  return (
    <PlaygroundView
      state={state}
      dispatch={wrappedDispatch}
      controller={controller}
      slmLoadStatus={slm.loadStatus}
      slmLoadError={slm.loadError}
      slmCurrentModelId={slm.currentModelId}
      slmModelSizeGB={slm.modelSizeGB}
      onLoadModel={slm.loadModel}
      onUnloadModel={slm.unloadModel}
    />
  );
}
