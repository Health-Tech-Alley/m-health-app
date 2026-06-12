import type {
  ChatMessage,
  ChatResult,
  GenerateOptions,
  InferenceProvider,
  LoadOptions,
  ModelInfo,
} from '@/inference/inference-provider';
import { createController } from './playground-controller';
import type { PlaygroundState } from './types';

class FakeProvider implements InferenceProvider {
  loadCalls: string[] = [];
  releaseCalls = 0;
  chatCalls = 0;
  shouldFailLoad = false;
  shouldFailChat = false;
  tokensToEmit: string[] = [];
  resolveDelay = 0;

  async loadModel(path: string, _options?: LoadOptions): Promise<void> {
    this.loadCalls.push(path);
    if (this.shouldFailLoad) {
      throw new Error('Simulated load failure');
    }
  }

  async release(): Promise<void> {
    this.releaseCalls++;
  }

  getModelInfo(): ModelInfo | null {
    return { sizeBytes: 2.5 * 1024 * 1024 * 1024, description: 'FakeModel' };
  }

  async chat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    signal: AbortSignal,
    _options?: GenerateOptions,
  ): Promise<ChatResult> {
    this.chatCalls++;

    if (this.resolveDelay > 0) {
      await new Promise((r) => setTimeout(r, this.resolveDelay));
    }

    if (this.shouldFailChat) {
      throw new Error('Simulated chat failure');
    }

    const t0 = Date.now();
    let text = '';
    let tokensGenerated = 0;

    for (const token of this.tokensToEmit) {
      if (signal.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      text += token;
      tokensGenerated++;
      onToken(token);
    }

    return {
      text,
      tokensGenerated,
      latencyMs: Date.now() - t0,
    };
  }
}

const idleState: PlaygroundState = {
  runStatus: 'idle',
  messages: [],
};

const readyState: PlaygroundState = {
  runStatus: 'idle',
  messages: [],
};

describe('PlaygroundController', () => {
  let provider: FakeProvider;

  beforeEach(() => {
    provider = new FakeProvider();
  });

  describe('initial state', () => {
    it('starts with idle run status and empty messages', () => {
      expect(idleState.runStatus).toBe('idle');
      expect(idleState.messages).toEqual([]);
    });
  });

  describe('send', () => {
    it('no-op while streaming', async () => {
      const streamingState: PlaygroundState = {
        ...readyState,
        runStatus: 'streaming',
      };
      const controller = createController(provider);
      const action = await controller.send(streamingState, 'hello');
      expect(action.type).toBe('noop');
    });

    it('happy path: user message added, tokens streamed, final text set', async () => {
      provider.tokensToEmit = ['Hello', ' ', 'world'];
      const controller = createController(provider);

      const action = await controller.send(readyState, 'hi there');
      expect(action.type).toBe('send-start');

      if (action.type !== 'send-start') return;

      const { userMessage, assistantMessage, run } = action.payload;
      expect(userMessage.role).toBe('user');
      expect(userMessage.text).toBe('hi there');
      expect(assistantMessage.role).toBe('assistant');
      expect(assistantMessage.status).toBe('streaming');

      const tokens: string[] = [];
      const finalAction = await run((token) => tokens.push(token));

      expect(tokens).toEqual(['Hello', ' ', 'world']);
      expect(finalAction.type).toBe('send-success');
      if (finalAction.type === 'send-success') {
        expect(finalAction.payload.finalText).toBe('Hello world');
        expect(finalAction.payload.assistantId).toBe(assistantMessage.id);
      }
    });

    it('chat error surfaces send-error', async () => {
      provider.shouldFailChat = true;
      const controller = createController(provider);

      const action = await controller.send(readyState, 'hi');
      if (action.type !== 'send-start') return;

      const finalAction = await action.payload.run(() => {});
      expect(finalAction.type).toBe('send-error');
      if (finalAction.type === 'send-error') {
        expect(finalAction.payload.error).toBe('Simulated chat failure');
      }
    });
  });

  describe('stop', () => {
    it('aborts in-flight generation', async () => {
      provider.tokensToEmit = ['a', 'b', 'c', 'd', 'e'];
      provider.resolveDelay = 50;
      const controller = createController(provider);

      const action = await controller.send(readyState, 'hi');
      if (action.type !== 'send-start') return;

      const tokens: string[] = [];
      const runPromise = action.payload.run((token) => tokens.push(token));

      setTimeout(() => controller.stop(), 10);

      const finalAction = await runPromise;
      expect(finalAction.type).toBe('send-stopped');
    });
  });

  describe('newConversation', () => {
    it('returns new-conversation action', () => {
      const controller = createController(provider);
      const action = controller.newConversation();
      expect(action.type).toBe('new-conversation');
    });

    it('does not release the model', () => {
      const controller = createController(provider);
      controller.newConversation();
      expect(provider.releaseCalls).toBe(0);
    });
  });

  describe('appendToken', () => {
    it('returns append-token action with correct payload', () => {
      const controller = createController(provider);
      const action = controller.appendToken('msg-1', 'hello');
      expect(action.type).toBe('append-token');
      if (action.type === 'append-token') {
        expect(action.payload.assistantId).toBe('msg-1');
        expect(action.payload.token).toBe('hello');
      }
    });
  });
});
