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

let cachedCoefficients: IntentHeadCoefficients | null = null;

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

/**
 * Load intent head coefficients from JSON asset.
 * Prefer bundled require() first — fetch(file path) can hang in RN.
 */
export async function loadIntentHead(
  _jsonPath?: string,
): Promise<IntentHeadCoefficients> {
  if (cachedCoefficients) return cachedCoefficients;

  // 1) Bundled asset (fast, no network). Paths relative to this file / Metro alias.
  try {
    const data = require('../../assets/models/nlu/intent-head.json') as IntentHeadCoefficients;
    if (isValidIntentHead(data)) {
      cachedCoefficients = data;
      return data;
    }
  } catch {
    // ignore
  }
  try {
    const data = require('@/assets/models/nlu/intent-head.json') as IntentHeadCoefficients;
    if (isValidIntentHead(data)) {
      cachedCoefficients = data;
      return data;
    }
  } catch {
    // ignore
  }

  // 2) Optional short-timeout fetch only if require failed
  if (_jsonPath) {
    try {
      const data = await Promise.race([
        fetch(_jsonPath).then((r) => r.json() as Promise<IntentHeadCoefficients>),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('intent-head fetch timeout')), 800),
        ),
      ]);
      if (isValidIntentHead(data)) {
        cachedCoefficients = data;
        return data;
      }
    } catch {
      // ignore
    }
  }

  throw new Error(
    'Failed to load intent-head.json. Ensure assets/models/nlu/intent-head.json is bundled with trained coefficients',
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
  cachedCoefficients = null;
}
