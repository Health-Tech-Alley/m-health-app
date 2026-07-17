/**
 * Embedder interface and implementations.
 *
 * Track A uses a deterministic hash-based mock embedder so RAG can be tested
 * end-to-end in Expo Go with zero native dependencies. Track B uses the
 * mdbr-leaf-ir TFLite model (768-d, weight-only INT8) via react-native-fast-tflite.
 *
 * planning/35 §4.
 */

import type { Embedder } from './types';

/** Query prefix required by leaf-ir for user/query strings only. */
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

/** Max sequence length for the leaf-ir model. */
const MAX_SEQ_LENGTH = 512;

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Deterministic hash-based mock embedder (Track A).
 *
 * Not semantically meaningful, but stable and fast. It tokenizes on whitespace,
 * hashes each token into the vector dimensions, and averages. This lets the
 * fused retriever return deterministic results for testing and UI development.
 */
export class HashMockEmbedder implements Embedder {
  readonly dimensions = 128;

  async embed(text: string, _opts?: { isQuery?: boolean }): Promise<number[]> {
    // Hash mock ignores isQuery; signature matches Embedder / leaf-ir path.
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
    const vec = new Array(this.dimensions).fill(0);
    if (tokens.length === 0) return vec;

    for (const token of tokens) {
      for (let i = 0; i < this.dimensions; i++) {
        const h = djb2(`${token}:${i}`);
        vec[i] += ((h % 2000) - 1000) / 1000;
      }
    }

    for (let i = 0; i < this.dimensions; i++) {
      vec[i] /= tokens.length;
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return vec;
    return vec.map((v) => v / norm);
  }
}

function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * BertTokenizer — lightweight WordPiece tokenizer for leaf-ir.
 *
 * Loads the HF tokenizer.json from assets/models/nlu/tokenizer/ and
 * implements encode() → input_ids + attention_mask.
 */
class BertTokenizer {
  private vocab: Map<string, number> = new Map();
  private invVocab: Map<number, string> = new Map();
  private doLowerCase = true;
  private maxLen = MAX_SEQ_LENGTH;

  // Special tokens
  readonly PAD_ID = 0;
  readonly UNK_ID = 100;
  readonly CLS_ID = 101;
  readonly SEP_ID = 102;

  async load(vocabPath: string): Promise<void> {
    try {
      const response = await fetch(vocabPath);
      const text = await response.text();
      const lines = text.split('\n').filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const token = lines[i].trim();
        this.vocab.set(token, i);
        this.invVocab.set(i, token);
      }
    } catch {
      // Fallback: try require()
      try {
        const vocabText = require('@/assets/models/nlu/tokenizer/vocab.txt');
        if (typeof vocabText === 'string') {
          const lines = vocabText.split('\n').filter(Boolean);
          for (let i = 0; i < lines.length; i++) {
            const token = lines[i].trim();
            this.vocab.set(token, i);
            this.invVocab.set(i, token);
          }
        }
      } catch {
        throw new Error('Failed to load vocabulary for BertTokenizer');
      }
    }
  }

  /**
   * Tokenize text into WordPiece token IDs.
   */
  encode(text: string, maxLength?: number): { inputIds: number[]; attentionMask: number[] } {
    const max = maxLength ?? this.maxLen;
    const normalized = this.doLowerCase ? text.toLowerCase() : text;

    // Basic whitespace + punctuation tokenization
    const tokens = normalized
      .replace(/([.,!?;:(){}[\]"'`~@#$%^&*+=|\\/<>_-])/g, ' $1 ')
      .split(/\s+/)
      .filter(Boolean);

    // WordPiece subword tokenization
    const subTokens: string[] = [];
    for (const token of tokens) {
      if (token.length > 200) {
        subTokens.push(token.slice(0, 200));
        continue;
      }
      const wordPieces = this.wordPieceTokenize(token);
      subTokens.push(...wordPieces);
    }

    // Build final sequence: [CLS] + tokens + [SEP], truncated to maxLen - 2
    const maxTokens = max - 2;
    const truncated = subTokens.slice(0, maxTokens);
    const inputIds = [this.CLS_ID];
    for (const t of truncated) {
      inputIds.push(this.vocab.get(t) ?? this.UNK_ID);
    }
    inputIds.push(this.SEP_ID);

    // Pad to maxLength
    const attentionMask = new Array(inputIds.length).fill(1);
    while (inputIds.length < max) {
      inputIds.push(this.PAD_ID);
      attentionMask.push(0);
    }

    return { inputIds, attentionMask };
  }

  private wordPieceTokenize(token: string): string[] {
    if (this.vocab.has(token)) return [token];
    if (token.length === 0) return [];

    const pieces: string[] = [];
    let start = 0;

    while (start < token.length) {
      let end = token.length;
      let found = false;

      while (start < end) {
        let substr = token.slice(start, end);
        if (start > 0) substr = '##' + substr;
        if (this.vocab.has(substr)) {
          pieces.push(substr);
          found = true;
          start = end;
          break;
        }
        end--;
      }

      if (!found) {
        pieces.push(token[start] ?? '[UNK]');
        start++;
      }
    }

    return pieces;
  }
}

/**
 * TfliteEmbedder — real embedding model via react-native-fast-tflite.
 *
 * Loads the mdbr-leaf-ir INT8 TFLite model (768-d) and runs inference
 * with the BertTokenizer. Applies query prefix on query strings only.
 *
 * planning/35 §4.
 */
export class TfliteEmbedder implements Embedder {
  readonly dimensions = 768;

  private interpreter: unknown = null;
  private tokenizer: BertTokenizer | null = null;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  /**
   * Load the TFLite model and tokenizer.
   */
  async load(modelPath?: string, tokenizerDir?: string): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this._load(modelPath, tokenizerDir);
    return this.loadPromise;
  }

  private async _load(modelPath?: string, tokenizerDir?: string): Promise<void> {
    try {
      // Load tokenizer
      this.tokenizer = new BertTokenizer();
      const vocabPath = tokenizerDir
        ? `${tokenizerDir}/vocab.txt`
        : 'assets/models/nlu/tokenizer/vocab.txt';
      await this.tokenizer.load(vocabPath);

      // Load TFLite model via react-native-fast-tflite
      try {
        const { loadTensorflowModel } = require('react-native-fast-tflite');
        const modelFilePath = modelPath ?? 'mdbr-leaf-ir-int8.tflite';
        this.interpreter = await loadTensorflowModel(modelFilePath);
        this.loaded = true;
        console.log('[TfliteEmbedder] Loaded TFLite model (768-d)');
      } catch (tfliteErr) {
        console.warn('[TfliteEmbedder] TFLite load failed, trying FP32 fallback:', tfliteErr);
        try {
          const { loadTensorflowModel } = require('react-native-fast-tflite');
          this.interpreter = await loadTensorflowModel('mdbr-leaf-ir.tflite');
          this.loaded = true;
          console.log('[TfliteEmbedder] Loaded FP32 TFLite fallback (768-d)');
        } catch (fallbackErr) {
          console.warn('[TfliteEmbedder] All TFLite loads failed:', fallbackErr);
          this.loaded = false;
        }
      }
    } catch (err) {
      console.error('[TfliteEmbedder] Initialization failed:', err);
      this.loaded = false;
    }
  }

  /**
   * Embed text into a 768-d vector.
   * If isQuery is true, prepends the IR query prefix.
   */
  async embed(text: string, opts?: { isQuery?: boolean }): Promise<number[]> {
    if (!this.loaded || !this.tokenizer || !this.interpreter) {
      throw new Error('TfliteEmbedder not loaded');
    }

    const input = opts?.isQuery ? QUERY_PREFIX + text : text;
    const { inputIds, attentionMask } = this.tokenizer.encode(input);

    // Run inference
    const model = this.interpreter as {
      run: (inputs: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    const outputs = await model.run({
      input_ids: new Int32Array(inputIds),
      attention_mask: new Int32Array(attentionMask),
    });

    // The model outputs a pooled sentence embedding (768-d).
    // Output key may vary by model; try common names.
    const outputKey = Object.keys(outputs)[0];
    const rawOutput = outputs[outputKey] as Float32Array | number[];

    // L2-normalize
    const vector = Array.from(rawOutput);
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return vector;
    return vector.map((v) => v / norm);
  }

  /**
   * Check if the TFLite model is loaded and ready.
   */
  isReady(): boolean {
    return this.loaded;
  }
}

// Singleton instance for the NLU embedder
let sharedTfliteEmbedder: TfliteEmbedder | null = null;

/**
 * Get the shared TfliteEmbedder instance (lazy singleton).
 */
export function getSharedTfliteEmbedder(): TfliteEmbedder {
  if (!sharedTfliteEmbedder) {
    sharedTfliteEmbedder = new TfliteEmbedder();
  }
  return sharedTfliteEmbedder;
}

/**
 * Check if TFLite NLU is available (native module present).
 */
export function isTfliteNluAvailable(): boolean {
  try {
    require('react-native-fast-tflite');
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the default embedder based on platform availability.
 * Prefers TFLite (Track B); falls back to HashMock (Track A).
 *
 * Note: TFLite load is async — callers that need a ready embedder should use
 * `createReadyEmbedder()` (with timeout and explicit dev fallback policy).
 */
export function createDefaultEmbedder(options?: {
  allowDevelopmentFallback?: boolean;
}): Embedder {
  if (isTfliteNluAvailable()) {
    const embedder = getSharedTfliteEmbedder();
    // Trigger async load but return immediately (lazy init)
    embedder.load().catch(() => {
      console.warn('[createDefaultEmbedder] TFLite preload failed');
    });
    return embedder;
  }
  if (__DEV__ && options?.allowDevelopmentFallback) {
    return new HashMockEmbedder();
  }
  throw new Error('TFLite NLU embedder unavailable');
}

/**
 * Resolve an embedder that is safe for the chat NLU hot path.
 * Waits briefly for TFLite; on timeout/failure returns HashMock immediately.
 */
export async function createReadyEmbedder(
  timeoutMs = 400,
  options?: { allowDevelopmentFallback?: boolean },
): Promise<Embedder> {
  const allowDevFallback = __DEV__ && options?.allowDevelopmentFallback === true;
  if (!isTfliteNluAvailable()) {
    if (allowDevFallback) return new HashMockEmbedder();
    throw new Error('TFLite NLU module unavailable');
  }
  const embedder = getSharedTfliteEmbedder();
  if (embedder.isReady()) return embedder;
  try {
    await Promise.race([
      embedder.load(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TFLite embedder load timeout')), timeoutMs),
      ),
    ]);
    if (embedder.isReady()) return embedder;
  } catch (err) {
    if (!allowDevFallback) {
      throw err instanceof Error ? err : new Error('TFLite embedder load failed');
    }
    console.warn('[createReadyEmbedder] using development HashMock fallback:', err);
  }
  if (allowDevFallback) return new HashMockEmbedder();
  throw new Error('TFLite embedder did not become ready');
}
