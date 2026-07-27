/**
 * Care intent classifier — second head on shared leaf-ir embeddings (doc 40 §6.8).
 * Holds its own coefficients instance; does not rely on chat-head module cache semantics.
 */

import {
  loadIntentHead,
  predictIntent,
  type IntentHeadCoefficients,
} from '@/nlu/intent-head';
import { linkEntities } from '@/nlu/entity-linker';
import type { LinkedEntity, NluEmbedder, PatientNluContext } from '@/nlu/types';
import type { CareIntentLabel } from './types';
import { CARE_INTENT_LABELS } from './types';

export type CareClassifyResult = {
  label: CareIntentLabel;
  confidence: number;
  entities: LinkedEntity[];
  alternatives: { id: CareIntentLabel; confidence: number }[];
};

const CARE_HEAD_PATH = 'assets/models/nlu/care-intent-head.json';

function asCareLabel(raw: string): CareIntentLabel {
  return (CARE_INTENT_LABELS as string[]).includes(raw)
    ? (raw as CareIntentLabel)
    : 'out_of_care';
}

export class CareIntentClassifier {
  private head: IntentHeadCoefficients | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(private embedder: NluEmbedder) {}

  async init(): Promise<void> {
    if (this.head) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      this.head = await loadIntentHead(CARE_HEAD_PATH);
    })();
    try {
      await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      this.head = null;
      throw err;
    }
  }

  get ready(): boolean {
    return this.head !== null;
  }

  async classify(text: string, ctx: PatientNluContext): Promise<CareClassifyResult> {
    await this.init();
    if (!this.head) {
      throw new Error('Care intent head unavailable');
    }

    const entities = linkEntities(text, ctx);
    let embedding: number[];
    try {
      embedding = await this.embedder.embed(text, { isQuery: true });
    } catch {
      embedding = await this.embedder.embed(text);
    }

    if (embedding.length !== this.head.dim) {
      throw new Error(
        `Care head dim mismatch: embedder=${embedding.length} head=${this.head.dim}`,
      );
    }

    const prediction = predictIntent(embedding, this.head);
    return {
      label: asCareLabel(prediction.primary),
      confidence: prediction.confidence,
      entities,
      alternatives: prediction.alternatives.map((a) => ({
        id: asCareLabel(a.id),
        confidence: a.confidence,
      })),
    };
  }
}
