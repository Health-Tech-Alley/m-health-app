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
  reasoningContent?: string;
}

export interface ModelInfo {
  sizeBytes: number;
  description: string;
}

export interface InferenceProvider {
  loadModel(path: string, options?: LoadOptions): Promise<void>;
  release(): Promise<void>;
  getModelInfo(): ModelInfo | null;
  chat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    signal: AbortSignal,
    options?: GenerateOptions,
  ): Promise<ChatResult>;
}
