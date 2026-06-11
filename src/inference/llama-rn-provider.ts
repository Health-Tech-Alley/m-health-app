import type {
  ChatResult,
  ChatMessage,
  GenerateOptions,
  InferenceProvider,
  LoadOptions,
} from './inference-provider';
import { MissingNativeModuleError } from './missing-native-module-error';

export class LlamaRnProvider implements InferenceProvider {
  private context: any = null;

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

    try {
      this.context = await llamaRn.initLlama({
        model: path,
        n_ctx: options?.nCtx ?? 2048,
        n_gpu_layers: 0,
      });
      console.log('[LlamaRnProvider] Model loaded successfully');
    } catch (err: any) {
      console.error('[LlamaRnProvider] Failed to load model:', err);
      throw new Error(`Failed to load model: ${err.message || 'Unknown error'}`);
    }
  }

  async release(): Promise<void> {
    if (this.context) {
      await this.context.release();
      this.context = null;
    }
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
    let text = '';
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
            n_predict: options?.maxTokens ?? 512,
            temperature: options?.temperature ?? 0.7,
            top_p: options?.topP ?? 0.9,
          },
          (data: any) => {
            const token = data.token;
            text += token;
            tokensGenerated++;
            onToken(token);
          },
        )
        .then(() => {
          signal.removeEventListener('abort', abortHandler);
          resolve({
            text,
            tokensGenerated,
            latencyMs: Date.now() - t0,
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
