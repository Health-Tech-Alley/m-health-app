/**
 * Embedder interface and implementations.
 *
 * Track A uses a deterministic hash-based mock embedder so RAG can be tested
 * end-to-end in Expo Go with zero native dependencies. Track B will swap in
 * a real sub-1B model via react-native-fast-tflite.
 */

import type { Embedder } from './types';

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
 * Deterministic hash-based mock embedder.
 *
 * Not semantically meaningful, but stable and fast. It tokenizes on whitespace,
 * hashes each token into the vector dimensions, and averages. This lets the
 * fused retriever return deterministic results for testing and UI development.
 */
export class HashMockEmbedder implements Embedder {
  readonly dimensions = 128;

  async embed(text: string): Promise<number[]> {
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
    const vec = new Array(this.dimensions).fill(0);
    if (tokens.length === 0) return vec;

    for (const token of tokens) {
      for (let i = 0; i < this.dimensions; i++) {
        // Spread each token's hash across dimensions in a stable way.
        const h = djb2(`${token}:${i}`);
        vec[i] += ((h % 2000) - 1000) / 1000;
      }
    }

    // Average and L2-normalize.
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
 * Placeholder for the Track B real embedder.
 *
 * On a dev build this loads a quantized embedding model (e.g. all-MiniLM-L6-v2
 * or GTE-small) through react-native-fast-tflite and returns dense vectors.
 * It is not implemented here because model conversion and CoreML delegate
 * tuning are Track B concerns.
 */
export class TfliteEmbedder implements Embedder {
  readonly dimensions = 384;

  async embed(_text: string): Promise<number[]> {
    throw new Error(
      'TfliteEmbedder is a Track B placeholder. Implement after converting a quantized embedding model.',
    );
  }
}

export function createDefaultEmbedder(): Embedder {
  // In a future build this can switch on __DEV__ / native module availability.
  return new HashMockEmbedder();
}
