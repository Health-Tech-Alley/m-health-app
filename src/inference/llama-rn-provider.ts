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
        'This screen requires a dev build (expo-dev-client) \u2014 llama.rn is not available in Expo Go.',
      );
    }

    if (this.context) {
      await this.release();
    }

    this.context = await llamaRn.initLlama({
      model: path,
      n_ctx: options?.nCtx ?? 2048,
      n_gpu_layers: 0,
    });
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

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const llamaRn = require('llama.rn');
    const chatSession = await llamaRn.initChat({
      context: this.context,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    return new Promise<ChatResult>((resolve, reject) => {
      const abortHandler = () => {
        chatSession.stop();
        reject(new DOMException('Aborted', 'AbortError'));
      };

      signal.addEventListener('abort', abortHandler);

      chatSession
        .completion({
          n_predict: options?.maxTokens ?? 512,
          temperature: options?.temperature ?? 0.7,
          top_p: options?.topP ?? 0.9,
          on_token: (token: string) => {
            text += token;
            tokensGenerated++;
            onToken(token);
          },
        })
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
