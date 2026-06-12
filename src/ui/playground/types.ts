export type Role = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  finalText: string | null;
  thinking: string | null;
  status: 'streaming' | 'done' | 'stopped' | 'error';
  startedAt: number;
  finishedAt: number | null;
}

export type RunStatus = 'idle' | 'streaming' | 'stopped' | 'done' | 'error';

export interface PlaygroundState {
  runStatus: RunStatus;
  messages: ChatMessage[];
}

export type PlaygroundAction =
  | { type: 'noop' }
  | {
      type: 'send-start';
      payload: {
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
        run: (onToken: (token: string) => void) => Promise<PlaygroundAction>;
      };
    }
  | {
      type: 'send-success';
      payload: { assistantId: string; finalText: string; reasoningContent?: string };
    }
  | {
      type: 'send-stopped';
      payload: { assistantId: string };
    }
  | {
      type: 'send-error';
      payload: { assistantId: string; error: string };
    }
  | {
      type: 'append-token';
      payload: { assistantId: string; token: string };
    }
  | { type: 'new-conversation' };
