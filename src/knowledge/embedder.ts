/**
 * Embedder interface and implementations.
 *
 * Track A uses a deterministic hash-based mock embedder so RAG can be tested
 * end-to-end in Expo Go with zero native dependencies. Track B uses the
 * mdbr-leaf-ir TFLite model (768-d, weight-only INT8) via react-native-fast-tflite.
 *
 * planning/35 §4.
 */

import { Platform } from 'react-native';
import type {
  TensorflowModelDelegate,
  TfliteModel,
} from 'react-native-fast-tflite';
import { loadAndroidLiteRtEmbedderModel } from './android-litert-embedder';
import type { Embedder } from './types';

/** Query prefix required by leaf-ir for user/query strings only. */
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

/** Max sequence length for the leaf-ir model. */
const MAX_SEQ_LENGTH = 512;

const LEAF_IR_INT8_BYTES = 59_145_520;
const LEAF_IR_INT8_MD5 = 'da805c15669635120757594e631dcda4';

/**
 * Default wait for first TFLite leaf-ir load (~59 MB INT8). 400ms was far too
 * short and caused every chat turn to hit "TFLite embedder load timeout".
 */
export const DEFAULT_TFLITE_EMBEDDER_LOAD_MS = 20_000;

/**
 * Lazy require so Jest does not parse binary .tflite at import time.
 * Paths match intent-head.json (src/nlu → ../../assets/...).
 * Metro needs a static string literal inside require().
 */
function leafIrInt8Asset(): number {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../assets/models/nlu/mdbr-leaf-ir-int8.tflite') as number;
}

function leafIrFp32Asset(): number {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../assets/models/nlu/mdbr-leaf-ir.tflite') as number;
}

type DelegateList = readonly TensorflowModelDelegate[];
type Candidate = { label: string; source: number | string };

/**
 * Leaf-ir is a full encoder-style graph. CoreML/Metal delegates often fail
 * createModel on device (unlike the tiny Alert autoencoder). Prefer CPU first.
 */
function leafIrDelegateAttempts(androidBundledOnly = false): DelegateList[] {
  const attempts: DelegateList[] = [[]]; // CPU always first
  if (Platform.OS === 'ios') {
    attempts.push(['core-ml']);
    attempts.push(['metal']);
  } else if (Platform.OS === 'android' && !androidBundledOnly) {
    attempts.push(['nnapi']);
    attempts.push(['android-gpu']);
  }
  return attempts;
}

function leafIrModelCandidates(modelPath?: string): Candidate[] {
  if (modelPath) return [{ label: 'custom', source: modelPath }];
  if (Platform.OS === 'android') {
    // Android bundled loading is intentionally INT8-only; loading each asset
    // copies full model bytes, so FP32/delegate probing can OOM before retry.
    return [{ label: 'int8', source: leafIrInt8Asset() }];
  }
  // Prefer FP32 first off Android: weight-only INT8 has failed invoke on some iOS builds.
  return [
    { label: 'fp32', source: leafIrFp32Asset() },
    { label: 'int8', source: leafIrInt8Asset() },
  ];
}

function devTfliteLog(message: string, details?: unknown): void {
  if (!__DEV__) return;
  if (details === undefined) {
    console.log(`[TfliteEmbedder] ${message}`);
  } else {
    console.log(`[TfliteEmbedder] ${message}`, details);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stripFileUri(uri: string): string {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

let androidInt8ModelFilePromise: Promise<string> | null = null;

async function materializeAndroidInt8ModelFile(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Asset } = require('expo-asset') as typeof import('expo-asset');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File } = require('expo-file-system') as typeof import('expo-file-system');

  const asset = Asset.fromModule(leafIrInt8Asset());
  const downloaded = await asset.downloadAsync();
  const localUri = downloaded.localUri ?? downloaded.uri;
  if (!localUri || !localUri.startsWith('file://')) {
    throw new Error('Android INT8 TFLite asset did not materialize to a local file');
  }

  const file = new File(localUri);
  if (!file.exists) {
    throw new Error('Android INT8 TFLite materialized file is missing');
  }
  if (file.size !== LEAF_IR_INT8_BYTES) {
    throw new Error(
      `Android INT8 TFLite materialized file has invalid size ${file.size}; expected ${LEAF_IR_INT8_BYTES}`,
    );
  }

  const md5 = file.md5?.toLowerCase();
  if (md5 !== LEAF_IR_INT8_MD5) {
    throw new Error('Android INT8 TFLite materialized file failed integrity check');
  }

  return stripFileUri(localUri);
}

function getAndroidInt8ModelFile(): Promise<string> {
  if (!androidInt8ModelFilePromise) {
    const work = materializeAndroidInt8ModelFile();
    androidInt8ModelFilePromise = work.catch((err) => {
      androidInt8ModelFilePromise = null;
      throw err;
    });
  }
  return androidInt8ModelFilePromise;
}

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
 * Load WordPiece vocab from bundled tokenizer.json (Metro resolves .json reliably;
 * bare .txt requires often fail outside Expo's default asset pipeline).
 */
function loadVocabFromTokenizerJson(): Map<string, number> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const raw = require('../../assets/models/nlu/tokenizer/tokenizer.json') as {
    model?: { vocab?: Record<string, number> };
  };
  const vocabObj = raw?.model?.vocab;
  if (!vocabObj || typeof vocabObj !== 'object') {
    throw new Error('tokenizer.json missing model.vocab');
  }
  const map = new Map<string, number>();
  for (const [token, id] of Object.entries(vocabObj)) {
    if (typeof id === 'number') map.set(token, id);
  }
  if (map.size < 100) {
    throw new Error(`tokenizer.json vocab too small (${map.size})`);
  }
  return map;
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

  async load(_vocabPath?: string): Promise<void> {
    const map = loadVocabFromTokenizerJson();
    this.vocab = map;
    this.invVocab = new Map<number, string>();
    for (const [token, id] of map) {
      this.invVocab.set(id, token);
    }
    console.log(`[BertTokenizer] Loaded vocab (${map.size} tokens) from tokenizer.json`);
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
type TensorInfo = { name: string; dataType: string; shape: number[] };
type TfliteModelHandle = {
  readonly inputs: readonly TensorInfo[];
  readonly outputs: readonly TensorInfo[];
  runSync?: (input: ArrayBuffer[]) => ArrayBuffer[];
  run(input: ArrayBuffer[]): Promise<ArrayBuffer[]>;
  dispose(): void;
};

type IntPackMode = 'i64_dataview' | 'i64_bigint' | 'i32';

/** Write signed ints as little-endian int64 without relying on BigInt64Array bridges. */
function packInt64LE(values: number[]): ArrayBuffer {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < values.length; i++) {
    const v = values[i] | 0;
    view.setUint32(i * 8, v >>> 0, true);
    view.setInt32(i * 8 + 4, v < 0 ? -1 : 0, true);
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function packInt64BigInt(values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(values.length * 8);
  const view = new BigInt64Array(buf);
  for (let i = 0; i < values.length; i++) view[i] = BigInt(values[i] | 0);
  return buf;
}

function packInt32(values: number[]): ArrayBuffer {
  const a = new Int32Array(values.length);
  for (let i = 0; i < values.length; i++) a[i] = values[i] | 0;
  return a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength);
}

function elementCount(shape: number[]): number {
  let n = 1;
  for (const d of shape) {
    if (typeof d === 'number' && d > 0) n *= d;
  }
  return Math.max(n, 1);
}

function padTo(arr: number[], len: number, pad: number): number[] {
  const out = arr.slice(0, len);
  while (out.length < len) out.push(pad);
  return out;
}

function valuesForTensor(
  tensor: TensorInfo,
  ids: number[],
  mask: number[],
): number[] {
  const n = elementCount(tensor.shape);
  const name = (tensor.name || '').toLowerCase();
  const src = name.includes('mask') ? mask : ids;
  return padTo(src, n, 0);
}

function packTensorValues(
  values: number[],
  dataType: string,
  mode: IntPackMode,
): ArrayBuffer {
  const dtype = (dataType || 'int64').toLowerCase();
  if (mode === 'i32' || (dtype.includes('32') && !dtype.includes('64'))) {
    return packInt32(values);
  }
  if (mode === 'i64_bigint') return packInt64BigInt(values);
  return packInt64LE(values);
}

function disposeFailedModelHandle(
  model: TfliteModelHandle,
  label: string,
): string | null {
  try {
    model.dispose();
    return null;
  } catch (err) {
    const msg = errorMessage(err);
    devTfliteLog('Failed-handle disposal failed', { label, error: msg });
    return msg;
  }
}

function parseOutputVector(buf: ArrayBuffer, dim: number): number[] {
  const raw = new Float32Array(buf);
  const vector =
    raw.length >= dim ? Array.from(raw.slice(0, dim)) : Array.from(raw);
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

export class TfliteEmbedder implements Embedder {
  readonly dimensions = 768;

  private interpreter: TfliteModelHandle | null = null;
  private tokenizer: BertTokenizer | null = null;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private lastLoadError: string | null = null;
  /** Packing mode proven by load-time probe. */
  private packMode: IntPackMode = 'i64_dataview';
  private modelLabel = 'unknown';

  /**
   * Load the TFLite model and tokenizer.
   * Only marks ready after a successful native run() probe.
   */
  async load(modelPath?: string, tokenizerDir?: string): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this._load(modelPath, tokenizerDir).finally(() => {
      // Allow retry after a failed load (do not stick on a dead promise).
      if (!this.loaded) {
        this.loadPromise = null;
      }
    });
    return this.loadPromise;
  }

  getLastLoadError(): string | null {
    return this.lastLoadError;
  }

  private async runModel(
    model: TfliteModelHandle,
    buffers: ArrayBuffer[],
  ): Promise<ArrayBuffer[]> {
    if (typeof model.runSync === 'function') {
      try {
        return model.runSync(buffers);
      } catch {
        /* fall through to async run */
      }
    }
    return model.run(buffers);
  }

  private async probeRun(
    model: TfliteModelHandle,
    tokenizer: BertTokenizer,
    label: string,
  ): Promise<IntPackMode> {
    const { inputIds, attentionMask } = tokenizer.encode('hello world');
    const modes: IntPackMode[] = ['i64_dataview', 'i64_bigint', 'i32'];
    const errors: string[] = [];

    for (const mode of modes) {
      // Skip i32 packing when tensors are int64-sized — wrong byte length.
      const anyI64 = model.inputs.some((t) =>
        (t.dataType || '').toLowerCase().includes('64'),
      );
      if (mode === 'i32' && anyI64) continue;

      let buffers: ArrayBuffer[];
      try {
        buffers = model.inputs.map((tensor) => {
          const values = valuesForTensor(tensor, inputIds, attentionMask);
          return packTensorValues(values, tensor.dataType, mode);
        });
      } catch (err) {
        const msg = errorMessage(err);
        errors.push(`${mode}/input_prep: ${msg}`);
        devTfliteLog('Probe input preparation failed', {
          model: label,
          packMode: mode,
          error: msg,
        });
        continue;
      }

      try {
        const outputs = await this.runModel(model, buffers);
        if (!outputs?.[0]) throw new Error('empty output');
        const vec = parseOutputVector(outputs[0], this.dimensions);
        if (vec.length < 8) throw new Error(`short output ${vec.length}`);
        return mode;
      } catch (err) {
        const msg = errorMessage(err);
        errors.push(`${mode}/invoke: ${msg}`);
        devTfliteLog(
          msg.includes('Failed to copy input tensor')
            ? 'Probe input copy failed'
            : 'Probe invocation failed',
          {
            model: label,
            packMode: mode,
            error: msg,
          },
        );
      }
    }
    throw new Error(`probe failed (${errors.join(' | ')})`);
  }

  private async _load(modelPath?: string, tokenizerDir?: string): Promise<void> {
    const t0 = Date.now();
    this.lastLoadError = null;
    try {
      this.tokenizer = new BertTokenizer();
      await this.tokenizer.load(tokenizerDir);

      const candidates = leafIrModelCandidates(modelPath);
      const androidBundledOnly = !modelPath && Platform.OS === 'android';
      let loadTensorflowModel:
        | ((
            source: number | string,
            delegates: TensorflowModelDelegate[],
          ) => Promise<TfliteModel>)
        | null = null;
      if (!androidBundledOnly) {
        ({ loadTensorflowModel } = require('react-native-fast-tflite') as {
          loadTensorflowModel: (
            source: number | string,
            delegates: TensorflowModelDelegate[],
          ) => Promise<TfliteModel>;
        });
      }

      const errors: string[] = [];
      for (const cand of candidates) {
        for (const delegates of leafIrDelegateAttempts(androidBundledOnly)) {
          const delLabel = delegates.length ? delegates.join('+') : 'cpu';
          const label = `${cand.label}/${delLabel}`;
          let model: TfliteModelHandle | null = null;
          let stage: 'create' | 'probe' = 'create';
          try {
            const fileBacked = androidBundledOnly && cand.label === 'int8';
            model = fileBacked
              ? await loadAndroidLiteRtEmbedderModel(
                  await getAndroidInt8ModelFile(),
                )
              : await loadTensorflowModel!(cand.source, [...delegates]);
            stage = 'probe';
            devTfliteLog('Model candidate loaded', {
              model: label,
              pathType: fileBacked ? 'android-litert-mapped-file' : 'legacy',
              inputs: model.inputs,
              outputs: model.outputs,
            });

            const mode = await this.probeRun(model, this.tokenizer, label);
            this.interpreter = model;
            this.packMode = mode;
            this.modelLabel = label;
            this.loaded = true;
            devTfliteLog('Ready leaf-ir', {
              model: this.modelLabel,
              packMode: mode,
              dimensions: this.dimensions,
              elapsedMs: Date.now() - t0,
            });
            return;
          } catch (err) {
            const msg = errorMessage(err);
            let detail = `${label} ${stage}: ${msg}`;
            if (stage === 'create') {
              devTfliteLog('Model creation failed', {
                model: label,
                pathType:
                  androidBundledOnly && cand.label === 'int8'
                    ? 'android-litert-mapped-file'
                    : 'legacy',
                error: msg,
              });
            }
            if (model) {
              const disposeError = disposeFailedModelHandle(model, label);
              detail += disposeError
                ? ` (failed-handle disposal failed: ${disposeError})`
                : ' (failed handle disposed)';
            }
            errors.push(detail);
            console.warn(`[TfliteEmbedder] ${label} failed:`, msg);
            this.interpreter = null;
            this.loaded = false;
          }
        }
      }

      throw new Error(
        `All leaf-ir TFLite load+probe attempts failed:\n${errors.join('\n')}`,
      );
    } catch (err) {
      this.loaded = false;
      this.interpreter = null;
      this.lastLoadError = err instanceof Error ? err.message : String(err);
      console.error('[TfliteEmbedder] Initialization failed:', err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  /** Serialize native run() — concurrent invokes corrupt shared interpreter state. */
  private runChain: Promise<unknown> = Promise.resolve();

  /**
   * Embed text into a 768-d vector.
   * If isQuery is true, prepends the IR query prefix.
   *
   * react-native-fast-tflite v3: `run(ArrayBuffer[])` in model.inputs order.
   */
  async embed(text: string, opts?: { isQuery?: boolean }): Promise<number[]> {
    if (!this.loaded || !this.tokenizer || !this.interpreter) {
      throw new Error('TfliteEmbedder not loaded');
    }

    const run = async (): Promise<number[]> => {
      const input = opts?.isQuery ? QUERY_PREFIX + text : text;
      const { inputIds, attentionMask } = this.tokenizer!.encode(input);
      const model = this.interpreter!;

      const buffers = model.inputs.map((tensor) => {
        const values = valuesForTensor(tensor, inputIds, attentionMask);
        return packTensorValues(values, tensor.dataType, this.packMode);
      });

      const outputs = await this.runModel(model, buffers);
      if (!outputs?.[0]) {
        throw new Error('TfliteEmbedder: empty model output');
      }
      return parseOutputVector(outputs[0], this.dimensions);
    };

    const next = this.runChain.then(run, run);
    this.runChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
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
 * Waits for TFLite first load (default 20s); on timeout/failure may return HashMock in dev.
 */
export async function createReadyEmbedder(
  timeoutMs = DEFAULT_TFLITE_EMBEDDER_LOAD_MS,
  options?: { allowDevelopmentFallback?: boolean },
): Promise<Embedder> {
  const allowDevFallback = __DEV__ && options?.allowDevelopmentFallback === true;
  if (!isTfliteNluAvailable()) {
    if (allowDevFallback) return new HashMockEmbedder();
    throw new Error('TFLite NLU module unavailable');
  }
  const embedder = getSharedTfliteEmbedder();
  if (embedder.isReady()) return embedder;
  const t0 = Date.now();
  // After a recorded failure (e.g. the 91 MB asset could not be fetched from
  // Metro), do not stall every chat turn on a full retry — bound the retry
  // budget to 3s so a transient outage can still recover but a broken asset
  // fails fast and the turn continues without NLU.
  const effectiveTimeout = embedder.getLastLoadError()
    ? Math.min(timeoutMs, 3_000)
    : timeoutMs;
  try {
    await Promise.race([
      embedder.load(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `TFLite embedder load timeout after ${effectiveTimeout}ms` +
                  (embedder.getLastLoadError()
                    ? ` (last error: ${embedder.getLastLoadError()})`
                    : ''),
              ),
            ),
          effectiveTimeout,
        ),
      ),
    ]);
    if (embedder.isReady()) {
      console.log(
        `[createReadyEmbedder] ready in ${Date.now() - t0}ms backend=tflite`,
      );
      return embedder;
    }
  } catch (err) {
    if (!allowDevFallback) {
      throw err instanceof Error ? err : new Error('TFLite embedder load failed');
    }
    console.warn('[createReadyEmbedder] using development HashMock fallback:', err);
  }
  if (allowDevFallback) return new HashMockEmbedder();
  throw new Error('TFLite embedder did not become ready');
}

/**
 * Kick off leaf-ir load at app start so the first chat turn does not race a cold load.
 */
export function preloadTfliteEmbedder(): void {
  if (!isTfliteNluAvailable()) return;
  const embedder = getSharedTfliteEmbedder();
  if (embedder.isReady()) return;
  void embedder.load().catch((err) => {
    console.warn('[preloadTfliteEmbedder] failed:', err);
  });
}
