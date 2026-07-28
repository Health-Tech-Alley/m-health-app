/**
 * On-device clinical knowledge pack types (doc 42).
 */

export type PackLayerId =
  | 'spine'
  | 'medlineplus'
  | 'orphanet'
  | 'public_health'
  | 'cpg'
  | 'meds_base'
  | 'ddi'
  | 'dme'
  | 'lit_lite'
  | 'openfda'
  | 'sdoh'
  | 'graph'
  | 'embeds';

export type PackSectionState =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped';

export type PackInstallStatus = 'idle' | 'in_flight' | 'ready' | 'failed';

export type PackSectionProgress = {
  id: PackLayerId;
  label: string;
  state: PackSectionState;
  /** 0–1 when known; null = indeterminate while running */
  progress01: number | null;
  detail?: string;
  error?: string;
};

export type PackInstallUiState = {
  status: PackInstallStatus;
  overall: number;
  sections: PackSectionProgress[];
  lastError: string | null;
  updatedAt: string;
  chunksInstalled: number;
  /** Estimated on-device pack size in bytes (text + vectors + sqlite). */
  sizeBytes: number;
};

export type PackLayerRecord = {
  version: string;
  contentHash: string;
  installedAt: string;
  chunkCount: number;
};

export type PackState = {
  schema: 1;
  layers: Partial<Record<PackLayerId, PackLayerRecord>>;
  embedderId: string | null;
  graphRebuiltAt: string | null;
  ready: boolean;
  lastError: string | null;
  updatedAt: string;
  /**
   * Fingerprint of active chart meds used for med-scoped layers
   * (meds_base / ddi / openfda / medlineplus drug pages).
   */
  medicationsFingerprint?: string | null;
};

export type PackChunkRow = {
  chunkId: string;
  packLayer: PackLayerId;
  packVersion: string;
  source: string;
  text: string;
  conditions?: string;
  documentType?: string;
  lengthTier?: string;
  sectionHeading?: string;
  externalId?: string;
  metadataJson?: string;
  contentHash: string;
  retrievedAt: string;
};

export type PackEdgeRow = {
  fromChunkId: string;
  toChunkId: string;
  type: 'PARENT_OF' | 'SHARES_CONDITION' | 'SHARES_MEDICATION';
  weight: number;
  source?: string;
  metadataJson?: string;
  packLayer?: string;
};

export type PackRunnerOptions = {
  /** Condition names for condition-scoped layers */
  conditions?: string[];
  /** Active medication names for meds/ddi layers */
  medications?: string[];
  /** Optional location for SDOH (off by default) */
  location?: string;
  /** Force reinstall of already-current layers */
  force?: boolean;
  /**
   * When true with layerIds, re-fetch those content layers even if cached,
   * without treating the whole pack install as force (embeds stay incremental).
   */
  forceContentLayers?: boolean;
  /** Only these layers (plus graph/embeds when needed) */
  layerIds?: PackLayerId[];
  /**
   * Partial update (e.g. med-layer refresh): keep non-targeted sections marked
   * done so overall progress does not reset to 0%.
   */
  partialUpdate?: boolean;
  /** Skip graph rebuild */
  skipGraph?: boolean;
  /** Skip embed pass */
  skipEmbeds?: boolean;
  onProgress?: (state: PackInstallUiState) => void;
  signal?: { cancelled: boolean };
};

export type PackRunnerResult = {
  chunksInstalled: number;
  layersUpdated: PackLayerId[];
  errors: string[];
  ready: boolean;
};
