/**
 * RAG public types.
 */

export type RetrievedChunk = {
  /** Used to render a CITATION in the UI. */
  docId: string;
  /** The actual retrieved text. */
  text: string;
  /** Combined score after RRF + optional re-rank. */
  score: number;
  /** Which corpus it came from. */
  source: 'openevidence' | 'rxnorm' | 'dailymed' | 'openfda' | 'patient-plan';
};

export type McpToolSummary = {
  name: string;
  description: string;
  params: Record<string, { type: 'string' | 'number' | 'boolean'; required?: boolean }>;
};

export type RetrievalQuery = {
  /** The caregiver's intent (free text). */
  intent: string;
  /** Patient conditions — narrows the search. */
  conditions: string[];
  /** Active meds — used to bias the drug corpora. */
  activeMeds: string[];
  /** How many tools to return. Default 3. */
  kTools?: number;
  /** How many clinical chunks to return. Default 8. */
  kChunks?: number;
};

export type RetrievalResult = {
  tools: McpToolSummary[];
  chunks: RetrievedChunk[];
  /** Convenience: chunks.map(c => c.docId). */
  citations: string[];
  /** Latency for the trace. */
  latencyMs: number;
};

export interface FusedRetriever {
  retrieve(q: RetrievalQuery): Promise<RetrievalResult>;
}

export interface Embedder {
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}
