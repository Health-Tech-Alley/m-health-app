export interface LoadOptions {
  nCtx?: number;
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResult {
  text: string;
  tokensGenerated: number;
  latencyMs: number;
}

export interface InferenceProvider {
  loadModel(path: string, options?: LoadOptions): Promise<void>;
  release(): Promise<void>;
  chat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    signal: AbortSignal,
    options?: GenerateOptions,
  ): Promise<ChatResult>;
}
