import type { ChatMessage as ProviderChatMessage, InferenceProvider } from '@/inference/inference-provider';
import type { ChatMessage, PlaygroundAction, PlaygroundState } from './types';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function createController(provider: InferenceProvider) {
  let abortController: AbortController | null = null;

  return {
    async send(state: PlaygroundState, text: string): Promise<PlaygroundAction> {
      if (state.runStatus === 'streaming') {
        return { type: 'noop' };
      }

      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        text,
        finalText: null,
        thinking: null,
        status: 'done',
        startedAt: Date.now(),
        finishedAt: Date.now(),
      };

      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        text: '',
        finalText: null,
        thinking: null,
        status: 'streaming',
        startedAt: Date.now(),
        finishedAt: null,
      };

      abortController = new AbortController();

      return {
        type: 'send-start',
        payload: {
          userMessage,
          assistantMessage,
          run: async (onToken: (token: string) => void) => {
            const messages: ProviderChatMessage[] = [
              ...state.messages.map((m) => ({
                role: m.role,
                content: m.text,
              })),
              { role: 'user', content: text },
            ];

            try {
              const result = await provider.chat(
                messages,
                onToken,
                abortController!.signal,
              );
              return {
                type: 'send-success',
                payload: { 
                  assistantId: assistantMessage.id, 
                  finalText: result.text,
                  reasoningContent: result.reasoningContent,
                },
              };
            } catch (err: any) {
              if (err.name === 'AbortError') {
                return {
                  type: 'send-stopped',
                  payload: { assistantId: assistantMessage.id },
                };
              }
              return {
                type: 'send-error',
                payload: { assistantId: assistantMessage.id, error: err.message },
              };
            }
          },
        },
      };
    },

    stop(): PlaygroundAction {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      return { type: 'noop' };
    },

    newConversation(): PlaygroundAction {
      return { type: 'new-conversation' };
    },

    appendToken(assistantId: string, token: string): PlaygroundAction {
      return { type: 'append-token', payload: { assistantId, token } };
    },
  };
}
