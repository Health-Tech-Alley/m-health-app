import type {
  ChatResult,
  ChatMessage,
  GenerateOptions,
  InferenceProvider,
  LoadOptions,
  ModelInfo,
} from './inference-provider';
import { MissingNativeModuleError } from './missing-native-module-error';
import { File } from 'expo-file-system';

export class LlamaRnProvider implements InferenceProvider {
  private context: any = null;
  private modelInfo: ModelInfo | null = null;

  async loadModel(path: string, options?: LoadOptions): Promise<void> {
    let llamaRn: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      llamaRn = require('llama.rn');
    } catch {
      throw new MissingNativeModuleError(
        'This screen requires a dev build (expo-dev-client) — llama.rn is not available in Expo Go.',
      );
    }

    if (this.context) {
      await this.release();
    }

    console.log('[LlamaRnProvider] Loading model from:', path);

    const file = new File(path);
    if (!file.exists) {
      throw new Error(`Model file not found at: ${path}`);
    }

    const fileSize = file.size;
    console.log('[LlamaRnProvider] Model file size:', (fileSize / 1_073_741_824).toFixed(2), 'GB');

    if (fileSize < 100_000_000) {
      throw new Error(
        `Model file appears corrupted (${(fileSize / 1_048_576).toFixed(1)} MB). ` +
        'Expected at least 100 MB. Try re-downloading the model.',
      );
    }

    const cleanPath = path.replace(/^file:\/\//, '');

    try {
      this.context = await llamaRn.initLlama({
        model: cleanPath,
        n_ctx: options?.nCtx ?? 4096,
        n_gpu_layers: -1,
      });
      this.modelInfo = {
        sizeBytes: this.context.model?.size ?? 0,
        description: this.context.model?.desc ?? 'Unknown model',
      };
      console.log('[LlamaRnProvider] Model loaded successfully');
    } catch (err: any) {
      console.error('[LlamaRnProvider] Failed to load model:', err);
      const hint = fileSize > 2_000_000_000
        ? ' The model is large (~2.6 GB). Your device may not have enough free RAM.'
        : '';
      throw new Error(`Failed to load model: ${err.message || 'Unknown error'}.${hint}`);
    }
  }

  async release(): Promise<void> {
    if (this.context) {
      await this.context.release();
      this.context = null;
      this.modelInfo = null;
    }
  }

  getModelInfo(): ModelInfo | null {
    return this.modelInfo;
  }

  async chat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    signal: AbortSignal,
    options?: GenerateOptions,
  ): Promise<ChatResult> {
    if (!this.context) {
      throw new Error('Model not loaded');
    }

    const t0 = Date.now();
    let tokensGenerated = 0;

    return new Promise<ChatResult>((resolve, reject) => {
      const abortHandler = () => {
        this.context.stopCompletion();
        reject(new DOMException('Aborted', 'AbortError'));
      };

      signal.addEventListener('abort', abortHandler);

      this.context
        .completion(
          {
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            n_predict: options?.maxTokens ?? 2048,
            temperature: options?.temperature ?? 0.7,
            top_p: options?.topP ?? 0.9,
            jinja: true,
            reasoning_format: 'auto',
          },
          (data: any) => {
            // Stream the raw token so the user sees live progress.
            tokensGenerated++;
            onToken(data.token);
          },
        )
        .then((result: any) => {
          signal.removeEventListener('abort', abortHandler);
          // llama.rn parses the model's structured output (e.g. Gemma/gpt-oss
          // harmony channels) into `content` (the answer) and
          // `reasoning_content` (the thinking). Fall back to raw text if the
          // model doesn't use a structured format.
          const answer: string =
            (result?.content && result.content.trim()) ||
            result?.text ||
            '';
          const reasoning: string = result?.reasoning_content ?? '';
          resolve({
            text: answer,
            tokensGenerated,
            latencyMs: Date.now() - t0,
            reasoningContent: reasoning || undefined,
          });
        })
        .catch((err: any) => {
          signal.removeEventListener('abort', abortHandler);
          if (err.name === 'AbortError' || signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
          } else {
            reject(err);
          }
        });
    });
  }
}
