/**
 * Intent head — linear classifier on frozen leaf-ir embeddings.
 *
 * Loads coefficients from intent-head.json and runs pure-TS matmul.
 * No second TFLite model required.
 */

import type { NluIntentLabel } from './types';
import { CONFIDENCE_THRESHOLD, INTENT_TO_SKILL } from './intent-labels';
import type { SkillId } from '@/orchestration/skills/skill-registry';

export type IntentHeadCoefficients = {
  version: string;
  labels: NluIntentLabel[];
  dim: number;
  W: number[][]; // [numLabels][dim]
  b: number[];   // [numLabels]
  trainedAt: string;
  sourceCorpus: string;
  embedder: string;
  trainIds?: string[];
  holdoutIds?: string[];
};

type IntentPrediction = {
  primary: NluIntentLabel;
  confidence: number;
  alternatives: { id: NluIntentLabel; confidence: number }[];
  skillId?: SkillId;
};

/** Path-keyed cache so chat + Care heads can coexist (planning/40 §6.8). */
const cachedByKey = new Map<string, IntentHeadCoefficients>();

function isValidIntentHead(
  data: IntentHeadCoefficients | null | undefined,
): data is IntentHeadCoefficients {
  return Boolean(
    data &&
      Array.isArray(data.labels) &&
      data.labels.length > 0 &&
      data.dim === 768 &&
      Array.isArray(data.W) &&
      data.W.length === data.labels.length &&
      Array.isArray(data.W[0]) &&
      data.W[0].length === 768 &&
      Array.isArray(data.b) &&
      data.b.length === data.labels.length,
  );
}

function cacheKeyForPath(jsonPath?: string): string {
  if (!jsonPath) return 'chat';
  const lower = jsonPath.toLowerCase();
  if (lower.includes('care-intent-head')) return 'care';
  if (lower.includes('intent-head')) return 'chat';
  return lower;
}

function tryRequireBundled(key: 'chat' | 'care'): IntentHeadCoefficients | null {
  // Metro requires static string literals in require().
  if (key === 'care') {
    try {
      const data = require('../../assets/models/nlu/care-intent-head.json') as IntentHeadCoefficients;
      if (isValidIntentHead(data)) return data;
    } catch {
      // ignore
    }
    try {
      const data = require('@/assets/models/nlu/care-intent-head.json') as IntentHeadCoefficients;
      if (isValidIntentHead(data)) return data;
    } catch {
      // ignore
    }
    return null;
  }

  try {
    const data = require('../../assets/models/nlu/intent-head.json') as IntentHeadCoefficients;
    if (isValidIntentHead(data)) return data;
  } catch {
    // ignore
  }
  try {
    const data = require('@/assets/models/nlu/intent-head.json') as IntentHeadCoefficients;
    if (isValidIntentHead(data)) return data;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Load intent head coefficients from JSON asset.
 * Prefer bundled require() first — fetch(file path) can hang in RN.
 * Pass a path containing `care-intent-head` to load the Care second head.
 */
export async function loadIntentHead(
  _jsonPath?: string,
): Promise<IntentHeadCoefficients> {
  const key = cacheKeyForPath(_jsonPath);
  const cached = cachedByKey.get(key);
  if (cached) return cached;

  const bundledKey = key === 'care' ? 'care' : 'chat';
  const bundled = tryRequireBundled(bundledKey);
  if (bundled) {
    cachedByKey.set(key, bundled);
    return bundled;
  }

  // Optional short-timeout fetch only if require failed
  if (_jsonPath) {
    try {
      const data = await Promise.race([
        fetch(_jsonPath).then((r) => r.json() as Promise<IntentHeadCoefficients>),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('intent-head fetch timeout')), 800),
        ),
      ]);
      if (isValidIntentHead(data)) {
        cachedByKey.set(key, data);
        return data;
      }
    } catch {
      // ignore
    }
  }

  throw new Error(
    key === 'care'
      ? 'Failed to load care-intent-head.json. Train with training/nlu/train_care_intent_head.py'
      : 'Failed to load intent-head.json. Ensure assets/models/nlu/intent-head.json is bundled with trained coefficients',
  );
}

/**
 * Softmax over a logit vector.
 */
function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - maxLogit));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sumExps);
}

/**
 * Predict intent from a 768-d embedding vector.
 */
export function predictIntent(
  embedding: number[],
  coefficients: IntentHeadCoefficients,
): IntentPrediction {
  const { W, b, labels } = coefficients;
  const numLabels = labels.length;

  // z = W @ embedding + b
  const logits: number[] = new Array(numLabels);
  for (let i = 0; i < numLabels; i++) {
    let dot = b[i];
    const row = W[i];
    for (let j = 0; j < embedding.length; j++) {
      dot += row[j] * embedding[j];
    }
    logits[i] = dot;
  }

  const probs = softmax(logits);

  // Sort descending
  const indexed = probs.map((p, i) => ({ id: labels[i], confidence: p }));
  indexed.sort((a, b) => b.confidence - a.confidence);

  const primary = indexed[0];
  const confidence = primary.confidence;

  // Apply confidence threshold
  let effectiveLabel = primary.id;
  if (confidence < CONFIDENCE_THRESHOLD) {
    effectiveLabel = primary.id === 'vitals_what_if' || primary.id === 'explain_anomaly'
      ? primary.id // high-safety intents keep their label even at low conf
      : 'knowledge_qa';
  }

  return {
    primary: effectiveLabel,
    confidence,
    alternatives: indexed.slice(1, 4),
    skillId: INTENT_TO_SKILL[effectiveLabel],
  };
}

/**
 * Clear cached coefficients (for testing).
 */
export function clearIntentHeadCache(): void {
  cachedByKey.clear();
}
