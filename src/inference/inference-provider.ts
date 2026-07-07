export interface LoadOptions {
  nCtx?: number;
}

export interface GenerateOptions {
  /**
   * Token budget for the **answer** channel. This is NOT the raw llama.rn
   * `n_predict` — the provider adds `maxReasoningTokens` on top so the model
   * can finish thinking AND still have room to emit the full answer.
   * `-1` means unlimited (generate until EOS or context window full).
   */
  maxTokens?: number;
  /**
   * Extra token headroom reserved for the reasoning/`<think>` channel when
   * `reasoningFormat === 'auto'`. The provider computes the effective
   * `n_predict` as `maxTokens + maxReasoningTokens` so thinking never eats
   * into the answer budget (the root cause of answers being cut off
   * mid-thought). Ignored when `maxTokens` is `-1` (unlimited). Defaults to 0.
   */
  maxReasoningTokens?: number;
  temperature?: number;
  topP?: number;
  /** Control reasoning channel: 'none' skips reasoning (fastest), 'auto' lets model decide. */
  reasoningFormat?: 'none' | 'auto';
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

/**
 * Token callback shape. The optional `onReasoningToken` lets UIs track
 * generation phases (prefill / reasoning channel / answer channel) without
 * rendering the reasoning stream itself.
 */
export type TokenCallback = (token: string) => void;
export type ReasoningTokenCallback = (token: string) => void;

export interface InferenceProvider {
  loadModel(path: string, options?: LoadOptions): Promise<void>;
  release(): Promise<void>;
  getModelInfo(): ModelInfo | null;
  chat(
    messages: ChatMessage[],
    onToken: TokenCallback,
    signal: AbortSignal,
    options?: GenerateOptions,
    onReasoningToken?: ReasoningTokenCallback,
  ): Promise<ChatResult>;
}
