/**
 * Knowledge pack layer catalog (doc 42).
 */

import type { PackLayerId } from './types';

export type PackLayerDef = {
  id: PackLayerId;
  label: string;
  /** Included in recommended/TestFlight install */
  defaultOn: boolean;
  /** Relative weight for overall progress bar */
  weight: number;
  /** Content layer (not computed graph/embeds) */
  isContent: boolean;
  supportsRemoteVersionProbe: boolean;
  estimatedBytes: number;
};

/** Content + post-process layers in install order. */
export const PACK_LAYER_CATALOG: readonly PackLayerDef[] = [
  {
    id: 'spine',
    label: 'Spine · care gaps & emergency cards',
    defaultOn: true,
    weight: 8,
    isContent: true,
    supportsRemoteVersionProbe: false,
    estimatedBytes: 3_000_000,
  },
  {
    id: 'cpg',
    label: 'Guidelines · text digests',
    defaultOn: true,
    weight: 10,
    isContent: true,
    supportsRemoteVersionProbe: false,
    estimatedBytes: 20_000_000,
  },
  {
    id: 'medlineplus',
    label: 'Conditions · MedlinePlus',
    defaultOn: true,
    weight: 14,
    isContent: true,
    supportsRemoteVersionProbe: true,
    estimatedBytes: 25_000_000,
  },
  {
    id: 'orphanet',
    label: 'Rare disease · Orphanet',
    defaultOn: true,
    weight: 8,
    isContent: true,
    supportsRemoteVersionProbe: false,
    estimatedBytes: 5_000_000,
  },
  {
    id: 'public_health',
    label: 'Public health · CDC/NINDS/NHLBI',
    defaultOn: true,
    weight: 8,
    isContent: true,
    supportsRemoteVersionProbe: false,
    estimatedBytes: 4_000_000,
  },
  {
    id: 'meds_base',
    label: 'Medications · patient labels',
    defaultOn: true,
    weight: 12,
    isContent: true,
    supportsRemoteVersionProbe: true,
    estimatedBytes: 20_000_000,
  },
  {
    id: 'ddi',
    label: 'Interactions · practical pairs',
    defaultOn: true,
    weight: 6,
    isContent: true,
    supportsRemoteVersionProbe: true,
    estimatedBytes: 2_000_000,
  },
  {
    id: 'openfda',
    label: 'Drug safety · OpenFDA AE/recalls',
    defaultOn: true,
    weight: 6,
    isContent: true,
    supportsRemoteVersionProbe: true,
    estimatedBytes: 5_000_000,
  },
  {
    id: 'dme',
    label: 'Devices · home complex care',
    defaultOn: true,
    weight: 6,
    isContent: true,
    supportsRemoteVersionProbe: false,
    estimatedBytes: 8_000_000,
  },
  {
    id: 'lit_lite',
    label: 'Literature · PubMed abstracts',
    defaultOn: true,
    weight: 16,
    isContent: true,
    supportsRemoteVersionProbe: true,
    estimatedBytes: 120_000_000,
  },
  {
    id: 'sdoh',
    label: 'Local health context · optional',
    defaultOn: false,
    weight: 4,
    isContent: true,
    supportsRemoteVersionProbe: true,
    estimatedBytes: 2_000_000,
  },
  {
    id: 'graph',
    label: 'Indexing · evidence graph',
    defaultOn: true,
    weight: 4,
    isContent: false,
    supportsRemoteVersionProbe: false,
    estimatedBytes: 10_000_000,
  },
  {
    id: 'embeds',
    label: 'Indexing · dense vectors',
    defaultOn: true,
    weight: 6,
    isContent: false,
    supportsRemoteVersionProbe: false,
    estimatedBytes: 4_000_000,
  },
] as const;

export const PACK_EMBEDDER_ID = 'mdbr-leaf-ir';
export const PACK_VECTOR_DIM = 768;
export const PACK_SIZE_SOFT_CAP_BYTES = 500 * 1024 * 1024;
export const PACK_SIZE_HARD_CAP_BYTES = 1024 * 1024 * 1024;
/**
 * Density targets:
 * - lit: many PubMed abstracts across comorbidity queries (main remaining MB driver)
 * - meds/openfda/ddi: active patient chart only (not global formulary)
 */
/** Abstracts per PubMed query. */
export const LIT_LITE_RETMAX = 200;
/** Distinct condition/comorbidity PubMed queries. */
export const LIT_LITE_MAX_QUERIES = 120;
/** Hard cap on total lit chunks (rate-limit / install-time guard). */
export const LIT_LITE_MAX_CHUNKS = 30_000;
/** Number of top-ranked abstracts to fetch full PMC text for (if available). */
export const LIT_FULLTEXT_TOP_N = 2000;
/**
 * Patient-chart meds only. Cap guards polypharmacy edge cases.
 */
export const MEDS_BASE_MAX_DRUGS = 80;
/** First N chart meds (plus disability priority names) get multi-section SPL. */
export const MEDS_PRIORITY_FULL_SPL = 40;
export const MEDS_MAX_SETIDS_PRIORITY = 5;
/** Remaining chart meds: one combined label (fast path). */
export const MEDS_MAX_SETIDS_STANDARD = 1;
/** Soft wall-clock budget for entire meds_base layer (ms). */
export const MEDS_LAYER_BUDGET_MS = 8 * 60 * 1000;
/** Soft wall-clock for lit_lite PubMed crawl. */
export const LIT_LAYER_BUDGET_MS = 15 * 60 * 1000;
/** Soft wall-clock for openfda layer. */
export const OPENFDA_LAYER_BUDGET_MS = 3 * 60 * 1000;
/** Max interaction chunks from live RxNorm. */
export const DDI_MAX_LIVE = 40;
/** OpenFDA drugs = active chart (hard cap). */
export const OPENFDA_MAX_DRUGS = 80;

/** Content layers that track the active medication list. */
export const MED_SCOPED_PACK_LAYER_IDS = [
  'meds_base',
  'ddi',
  'openfda',
  'medlineplus',
] as const;

/**
 * Layers embedded for dense rerank (curated, caregiver-facing content).
 * lit_lite is excluded: BM25 lexical match is strong on PubMed abstracts and
 * embedding ~7k abstract sections dominated install time for a top-50 rerank.
 * Rerank degrades gracefully for chunks without vectors.
 */
export const PACK_EMBED_LAYER_IDS: readonly PackLayerId[] = [
  'spine',
  'cpg',
  'medlineplus',
  'orphanet',
  'public_health',
  'meds_base',
  'ddi',
  'openfda',
  'dme',
  'sdoh',
] as const;

/** True when a pack layer gets dense vectors in the embed pass. */
export function shouldEmbedPackLayer(id: PackLayerId): boolean {
  return (PACK_EMBED_LAYER_IDS as readonly string[]).includes(id);
}

export function getDefaultContentLayerIds(): PackLayerId[] {
  return PACK_LAYER_CATALOG.filter((l) => l.isContent && l.defaultOn).map((l) => l.id);
}

export function getLayerDef(id: PackLayerId): PackLayerDef | undefined {
  return PACK_LAYER_CATALOG.find((l) => l.id === id);
}

export function layerLabel(id: PackLayerId): string {
  return getLayerDef(id)?.label ?? id;
}
