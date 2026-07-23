/**
 * RAG public types.
 */

export type RetrievedChunkSource =
  | 'synthetic'
  | 'rxnorm'
  | 'dailymed'
  | 'openfda'
  | 'patient-plan'
  | 'pubmed'
  | 'medlineplus'
  | 'clinicaltrials'
  | 'orphanet'
  | 'umls'
  | 'cdc-places'
  | 'semmeddb'
  | 'hedis'
  | 'patient-record'
  // ADCP (planning/39 P4) — Care Concierge sections surfaced verbatim from
  // the active care plan via the indexer.
  | 'adcp_plan';

export type RetrievedChunkDocumentType =
  | 'abstract'
  | 'fulltext'
  | 'guideline'
  | 'systematic_review'
  | 'spl_full'
  | 'synthetic'
  // ADCP (planning/39 P4) — section / rolling decision-log chunks
  | 'care_plan_section'
  | 'care_plan_decision_log';

export type RetrievedChunkLengthTier = 'short' | 'medium' | 'long';

export type RetrievedChunk = {
  /** Used to render a CITATION in the UI. */
  docId: string;
  /** The actual retrieved text. */
  text: string;
  /** Combined score after RRF + optional re-rank. */
  score: number;
  /** Which corpus it came from. */
  source: RetrievedChunkSource;
  /** Optional chunk-depth classification (planning/32 §12.3). */
  documentType?: RetrievedChunkDocumentType;
  /** Optional length tier for budget-aware prompt injection. */
  lengthTier?: RetrievedChunkLengthTier;
  /** For section-chunked full-text docs, the heading that this chunk came from. */
  sectionHeading?: string;
  /** Set when chunk entered the result via graph expansion (not BM25 seed alone). */
  graphRelation?: string;
  /** Seed docId that pulled this neighbor in (for transparency / prompt). */
  graphSeedId?: string;
  sourceId?: string;
  sourceType?: string;
  resourceId?: string;
  patientId?: string;
  effectiveAt?: string;
  createdAt?: string;
  synthetic?: boolean;
  retrievalMethod?: string;
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
  /**
   * When false, skip live network supplement (PubMed/MedlinePlus) on sparse
   * cache hits. Chat Pre-SLM NLU must pass false so empty cache cannot hang
   * the send path. Default true for background/enrichment callers.
   */
  allowLiveSupplement?: boolean;
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
  embed(text: string, opts?: { isQuery?: boolean }): Promise<number[]>;
}
